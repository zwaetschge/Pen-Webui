import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeDisplayTtsBudget,
  resolveActiveDisplayCapability,
} from "@/lib/cast/display-capability";
import type { DisplayTokenClaims } from "@/lib/cast/display-token";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveAccess } from "@/lib/game/access";
import { eventForClient } from "@/lib/game/events";
import { parseToken } from "@/lib/invite-token";
import {
  readableEventFromLog,
  resolveVoiceForTarget,
  type ResolvedVoice,
} from "./voice-resolution";
import { synthesizeCloneSpeech } from "./vocarium-client";

const bodySchema = z.object({ eventId: z.string().min(1).max(160) });

type CachedRow = {
  id: string;
  status: "ready" | "failed";
  mimeType: string | null;
  byteLength: number;
  voiceId: string;
  error: string | null;
};

type PublicTtsAccess =
  | { kind: "invite"; token: string }
  | { kind: "display"; token: string }
  | null;

type ResolvedTtsAccess = {
  role: "host" | "player";
  displayCapability?: DisplayTokenClaims;
};

type SynthesizedAudio = Awaited<ReturnType<typeof synthesizeCloneSpeech>>;
const ttsSynthesisInFlight = new Map<string, Promise<SynthesizedAudio>>();

class DisplayTtsAdmissionError extends Error {
  constructor(
    public readonly code:
      | "display_tts_unavailable"
      | "display_tts_rate_limited",
    public readonly status: 429 | 503,
    public readonly retryAfter: string,
  ) {
    super(code);
    this.name = "DisplayTtsAdmissionError";
  }
}

export async function handleSessionTts(
  req: Request,
  sessionId: string,
  inviteToken?: string | null,
  displayToken?: string | null,
) {
  const publicAccess = accessPath(inviteToken, displayToken);
  const access = await resolveInviteAwareAccess(
    sessionId,
    inviteToken,
    displayToken,
  );
  if (!access)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );
  }

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      campaignId: true,
      campaign: { select: { host: { select: { username: true } } } },
    },
  });
  if (!session)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const event = await prisma.eventLog.findFirst({
    where: { id: body.data.eventId, sessionId },
    select: { id: true, type: true, payload: true, scope: true, ts: true },
  });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const visible = eventForClient(
    {
      id: event.id,
      type: event.type,
      payload: payloadRecord(event.payload),
      scope: event.scope === "dm" ? "dm" : "all",
      ts: event.ts.getTime(),
    },
    access.role,
  );
  if (!visible)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const readable = readableEventFromLog({
    id: visible.id,
    type: visible.type,
    payload: visible.payload,
  });
  if (!readable) {
    return NextResponse.json({ error: "not_readable" }, { status: 400 });
  }

  const vocariumUser = session.campaign.host.username;
  const assignments = await prisma.voiceAssignment.findMany({
    where: {
      campaignId: session.campaignId,
      vocariumUser,
      OR: [
        {
          targetType: readable.target.targetType,
          targetId: readable.target.targetId,
        },
        { targetType: "narrator", targetId: "narrator" },
      ],
    },
    select: {
      targetType: true,
      targetId: true,
      vocariumUser: true,
      voiceId: true,
      voiceName: true,
      voiceSource: true,
    },
  });
  const voice = resolveVoiceForTarget({
    target: readable.target,
    assignments,
    vocariumUser,
  });
  const textHash = sha256(readable.text);

  const cached = await findCachedTts(
    sessionId,
    readable.eventId,
    voice.voiceId,
    textHash,
  );
  if (cached?.status === "ready") {
    return NextResponse.json(readyBody(sessionId, publicAccess, cached, voice));
  }
  if (cached?.status === "failed") {
    return NextResponse.json(
      { error: "tts_failed", message: cached.error ?? "TTS failed" },
      { status: 502 },
    );
  }

  let audio;
  try {
    audio = await synthesizeOnce(
      JSON.stringify([sessionId, readable.eventId, voice.voiceId, textHash]),
      {
        vocariumUser,
        voiceId: voice.voiceId,
        text: readable.text,
      },
      access.displayCapability,
    );
  } catch (error) {
    if (error instanceof DisplayTtsAdmissionError) {
      return NextResponse.json(
        { error: error.code },
        {
          status: error.status,
          headers: { "retry-after": error.retryAfter },
        },
      );
    }
    const message =
      error instanceof Error ? error.message.slice(0, 240) : "unknown";

    try {
      await prisma.ttsAudioCache.create({
        data: {
          sessionId,
          eventId: readable.eventId,
          voiceId: voice.voiceId,
          textHash,
          status: "failed",
          byteLength: 0,
          error: message,
        },
      });
    } catch (createError) {
      const raced = await recoverFromCreateRace(
        createError,
        sessionId,
        readable.eventId,
        voice.voiceId,
        textHash,
        publicAccess,
        voice,
      );
      if (raced) return raced;
    }

    return NextResponse.json(
      { error: "vocarium_failed", message },
      { status: 502 },
    );
  }

  try {
    const row = await prisma.ttsAudioCache.create({
      data: {
        sessionId,
        eventId: readable.eventId,
        voiceId: voice.voiceId,
        textHash,
        audio: audio.bytes,
        mimeType: audio.mimeType,
        byteLength: audio.bytes.byteLength,
        status: "ready",
      },
      select: {
        id: true,
        status: true,
        mimeType: true,
        byteLength: true,
        voiceId: true,
        error: true,
      },
    });
    return NextResponse.json(readyBody(sessionId, publicAccess, row, voice));
  } catch (error) {
    const raced = await recoverFromCreateRace(
      error,
      sessionId,
      readable.eventId,
      voice.voiceId,
      textHash,
      publicAccess,
      voice,
    );
    if (raced) return raced;

    return NextResponse.json(
      {
        error: "tts_storage_failed",
        message: "Failed to persist synthesized audio",
      },
      { status: 500 },
    );
  }
}

export async function handleSessionTtsAudio(
  _req: Request,
  sessionId: string,
  cacheId: string,
  inviteToken?: string | null,
  displayToken?: string | null,
) {
  const access = await resolveInviteAwareAccess(
    sessionId,
    inviteToken,
    displayToken,
  );
  if (!access) return new Response("forbidden", { status: 403 });

  const cached = await prisma.ttsAudioCache.findFirst({
    where: { id: cacheId, sessionId, status: "ready" },
    select: { eventId: true, audio: true, mimeType: true, byteLength: true },
  });
  if (!cached?.audio) return new Response("not found", { status: 404 });

  const event = await prisma.eventLog.findFirst({
    where: { id: cached.eventId, sessionId },
    select: { id: true, type: true, payload: true, scope: true, ts: true },
  });
  if (!event) return new Response("not found", { status: 404 });

  const visible = eventForClient(
    {
      id: event.id,
      type: event.type,
      payload: payloadRecord(event.payload),
      scope: event.scope === "dm" ? "dm" : "all",
      ts: event.ts.getTime(),
    },
    access.role,
  );
  if (!visible) return new Response("forbidden", { status: 403 });

  return new Response(cached.audio, {
    headers: {
      "content-type": cached.mimeType ?? "audio/wav",
      "content-length": String(cached.byteLength),
      "cache-control": "private, max-age=86400",
    },
  });
}

async function resolveInviteAwareAccess(
  sessionId: string,
  inviteToken?: string | null,
  displayToken?: string | null,
): Promise<ResolvedTtsAccess | null> {
  if (displayToken) {
    const claims = await resolveActiveDisplayCapability(
      displayToken,
      sessionId,
      env().INVITE_HMAC_SECRET,
    );
    return claims ? { role: "player", displayCapability: claims } : null;
  }
  const access = await resolveAccess({ sessionId });
  if (!access) return null;
  if (!inviteToken) return access;

  const parsed = parseToken(inviteToken);
  if (!parsed || parsed.expiryUnix < Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (
    access.role !== "player" ||
    access.userId !== null ||
    access.inviteId !== parsed.inviteId
  ) {
    return null;
  }

  return access;
}

function synthesizeOnce(
  key: string,
  input: Parameters<typeof synthesizeCloneSpeech>[0],
  displayCapability?: DisplayTokenClaims,
) {
  const existing = ttsSynthesisInFlight.get(key);
  if (existing) return existing;

  const synthesis = (async () => {
    if (displayCapability) {
      let allowed = false;
      try {
        allowed = await consumeDisplayTtsBudget(displayCapability);
      } catch {
        throw new DisplayTtsAdmissionError("display_tts_unavailable", 503, "5");
      }
      if (!allowed) {
        throw new DisplayTtsAdmissionError(
          "display_tts_rate_limited",
          429,
          "60",
        );
      }
    }
    return synthesizeCloneSpeech(input);
  })().finally(() => {
    if (ttsSynthesisInFlight.get(key) === synthesis) {
      ttsSynthesisInFlight.delete(key);
    }
  });
  ttsSynthesisInFlight.set(key, synthesis);
  return synthesis;
}

async function findCachedTts(
  sessionId: string,
  eventId: string,
  voiceId: string,
  textHash: string,
) {
  return prisma.ttsAudioCache.findFirst({
    where: {
      sessionId,
      eventId,
      voiceId,
      textHash,
    },
    select: {
      id: true,
      status: true,
      mimeType: true,
      byteLength: true,
      voiceId: true,
      error: true,
    },
  }) as Promise<CachedRow | null>;
}

async function recoverFromCreateRace(
  error: unknown,
  sessionId: string,
  eventId: string,
  voiceId: string,
  textHash: string,
  publicAccess: PublicTtsAccess,
  voice: ResolvedVoice,
) {
  if (!isUniqueConstraintError(error)) return null;

  const cached = await findCachedTts(sessionId, eventId, voiceId, textHash);
  if (cached?.status === "ready") {
    return NextResponse.json(readyBody(sessionId, publicAccess, cached, voice));
  }
  if (cached?.status === "failed") {
    return NextResponse.json(
      { error: "tts_failed", message: cached.error ?? "TTS failed" },
      { status: 502 },
    );
  }
  return null;
}

function readyBody(
  sessionId: string,
  publicAccess: PublicTtsAccess,
  cached: { id: string; mimeType: string | null; byteLength: number },
  voice: ResolvedVoice,
) {
  const encodedSession = encodeURIComponent(sessionId);
  const encodedCache = encodeURIComponent(cached.id);
  const audioUrl =
    publicAccess?.kind === "invite"
      ? `/api/invite/sessions/${encodedSession}/tts/audio/${encodedCache}/${encodeURIComponent(
          publicAccess.token,
        )}`
      : publicAccess?.kind === "display"
        ? `/api/display/sessions/${encodedSession}/tts/audio/${encodedCache}/${encodeURIComponent(
            publicAccess.token,
          )}`
        : `/api/sessions/${encodedSession}/tts/${encodedCache}`;
  return {
    status: "ready" as const,
    cacheId: cached.id,
    audioUrl,
    mimeType: cached.mimeType,
    byteLength: cached.byteLength,
    voice: {
      voiceId: voice.voiceId,
      voiceName: voice.voiceName,
      voiceSource: voice.voiceSource,
      ...(voice.fallback ? { fallback: voice.fallback } : {}),
    },
  };
}

function accessPath(
  inviteToken?: string | null,
  displayToken?: string | null,
): PublicTtsAccess {
  if (displayToken) return { kind: "display", token: displayToken };
  if (inviteToken) return { kind: "invite", token: inviteToken };
  return null;
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002",
  );
}

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
