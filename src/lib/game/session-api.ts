import { NextResponse } from "next/server";
import { z } from "zod";
import { rollDice } from "@/lib/dice";
import { runDmTurn } from "@/lib/dm/orchestrator";
import { prisma } from "@/lib/db";
import { resolveAccess } from "./access";
import { resolveActingIdentity, type ActingIdentity } from "./acting";
import { ensureSessionBootstrap } from "./bootstrap";
import { activeInitiativeName, isActiveTurnForCharacter } from "./combat-turn";
import {
  channel,
  publishEvent,
  recentEvents,
  subClient,
  type GameEvent,
} from "./bus";
import { eventForClient } from "./events";
import {
  acquireDmTurnLock,
  confirmDmTurnLockOwned,
  releaseDmTurnLock,
  type DmTurnLock,
} from "./turn-lock";

const turnBodySchema = z.object({
  text: z.string().min(1).max(2000),
  characterId: z.string().optional(),
});

const rollBodySchema = z.object({
  notation: z.string().min(1).max(40),
  reason: z.string().max(120).optional(),
  characterId: z.string().optional(),
});

const LIVE_REPLAY_BUFFER_LIMIT = 1000;
const DM_FINALIZATION_TIMEOUT_MS = 5_000;

function inviteTokenFrom(req: Request, override?: string | null) {
  if (override !== undefined) return override;
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

export async function handleSessionStream(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const url = new URL(req.url);
  const inviteToken = inviteTokenFrom(req, inviteTokenOverride);
  const sinceMs = Number(url.searchParams.get("since") ?? 0) || undefined;
  const afterEventId =
    normalizedCursor(url.searchParams.get("after")) ??
    normalizedCursor(req.headers.get("last-event-id"));

  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access) {
    return new Response("forbidden", { status: 403 });
  }

  await ensureSessionBootstrap(sessionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let sub: ReturnType<typeof subClient> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const topic = channel(sessionId);

      const send = (ev: { id?: string; event?: string; data: unknown }) => {
        if (closed) return;
        const lines: string[] = [];
        if (ev.id) lines.push(`id: ${ev.id}`);
        if (ev.event) lines.push(`event: ${ev.event}`);
        lines.push(`data: ${JSON.stringify(ev.data)}`);
        try {
          controller.enqueue(enc.encode(lines.join("\n") + "\n\n"));
        } catch {
          void close();
        }
      };

      const close = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (sub) {
          try {
            await sub.unsubscribe(topic);
            await sub.quit();
          } catch {
            /* */
          }
        }
        try {
          controller.close();
        } catch {
          /* */
        }
      };
      req.signal.addEventListener("abort", () => void close());

      const forward = (ev: GameEvent) => {
        const visible = eventForClient(ev, access.role);
        if (visible) send({ id: visible.id, event: visible.type, data: visible });
      };

      send({
        event: "hello",
        data: {
          role: access.role,
          displayName: access.displayName,
          memberId: access.memberId,
          sessionId: access.sessionId,
        },
      });

      const liveBuffer: GameEvent[] = [];
      let replaying = true;
      sub = subClient();
      sub.on("message", (_ch, raw) => {
        const ev = parsePublishedEvent(raw);
        if (!ev) return;
        if (replaying) {
          if (liveBuffer.length >= LIVE_REPLAY_BUFFER_LIMIT) {
            void close();
            return;
          }
          liveBuffer.push(ev);
        } else {
          forward(ev);
        }
      });
      try {
        await sub.subscribe(topic);
        if (closed) return;

        const replay = await recentEvents(sessionId, {
          afterEventId,
          sinceMs,
          limit: 200,
        });
        if (closed) return;
        for (const ev of replay) forward(ev);
        replaying = false;
        for (const ev of liveBuffer) forward(ev);
        if (closed) return;

        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(`: hb ${Date.now()}\n\n`));
          } catch {
            void close();
          }
        }, 15_000);
      } catch {
        await close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function normalizedCursor(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parsePublishedEvent(raw: string): GameEvent | null {
  try {
    const ev = JSON.parse(raw) as {
      id: string;
      type: string;
      payload: unknown;
      ts: number;
      scope?: "all" | "dm";
    };
    if (!ev.id || !ev.type || typeof ev.ts !== "number") return null;
    return {
      id: ev.id,
      type: ev.type,
      payload:
        ev.payload && typeof ev.payload === "object" && !Array.isArray(ev.payload)
          ? (ev.payload as Record<string, unknown>)
          : {},
      ts: ev.ts,
      scope: ev.scope,
    };
  } catch {
    return null;
  }
}

export async function handleSessionTurn(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const inviteToken = inviteTokenFrom(req, inviteTokenOverride);
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const raw = await req.json().catch(() => ({}));
  const body = turnBodySchema.safeParse(raw);
  if (!body.success)
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      campaignId: true,
      endedAt: true,
      campaign: { select: { hostId: true } },
    },
  });
  if (!session || session.endedAt) {
    return NextResponse.json({ error: "session_closed" }, { status: 410 });
  }

  const actor = await resolveActingIdentity({
    access,
    campaignId: session.campaignId,
    requestedCharacterId: body.data.characterId,
  });
  if (!actor) {
    return NextResponse.json({ error: "invalid_character" }, { status: 403 });
  }

  const turnBlock = await blockedByCombatTurn(session.campaignId, actor);
  if (turnBlock) {
    return NextResponse.json(turnBlock, { status: 409 });
  }

  const dmTurnLock = await acquireDmTurnLock(sessionId);
  if (!dmTurnLock) {
    return NextResponse.json({ error: "dm_busy" }, { status: 409 });
  }

  const runnerId = session.campaign.hostId;

  try {
    await publishEvent(
      sessionId,
      "player_input",
      {
        kind: "player_input",
        text: body.data.text,
        actorId: actor.eventActorId,
        displayName: actor.displayName,
        characterId: actor.characterId,
        actorKind: actor.actorKind,
      },
      { actorId: actor.dbActorId },
    );

    await publishDmEvent(sessionId, dmTurnLock, "dm_thinking", {
      active: true,
    });
    await confirmDmTurnLockOwned(dmTurnLock);
  } catch (error) {
    await releaseDmTurnLock(dmTurnLock);
    throw error;
  }

  void runDmTurn({
    sessionId,
    campaignId: session.campaignId,
    userId: runnerId,
    playerInput: {
      text: body.data.text,
      actorId: actor.dbActorId,
      displayName: actor.displayName,
      characterId: actor.characterId,
      actorKind: actor.actorKind,
      alreadyPersisted: true,
    },
    emit: async (ev) => {
      await publishDmEvent(sessionId, dmTurnLock, ev.type, ev.payload);
    },
  })
    .catch(async (e) => {
      await publishDmErrorWhileOwned(sessionId, dmTurnLock, e);
    })
    .finally(async () => {
      await finalizeDmTurn(sessionId, dmTurnLock);
    });

  return NextResponse.json({ ok: true });
}

export async function handleSessionRoll(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const inviteToken = inviteTokenFrom(req, inviteTokenOverride);
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = rollBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success)
    return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      campaignId: true,
      endedAt: true,
      campaign: { select: { hostId: true } },
    },
  });
  if (!session || session.endedAt) {
    return NextResponse.json({ error: "session_closed" }, { status: 410 });
  }

  const actor = await resolveActingIdentity({
    access,
    campaignId: session.campaignId,
    requestedCharacterId: body.data.characterId,
  });
  if (!actor) {
    return NextResponse.json({ error: "invalid_character" }, { status: 403 });
  }

  const dmTurnLock: DmTurnLock | null =
    actor.actorKind === "player" ? await acquireDmTurnLock(sessionId) : null;
  if (actor.actorKind === "player" && !dmTurnLock) {
    return NextResponse.json({ error: "dm_busy" }, { status: 409 });
  }

  let result;
  try {
    result = rollDice(body.data.notation);
  } catch (e) {
    if (dmTurnLock) await releaseDmTurnLock(dmTurnLock);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad_notation" },
      { status: 400 },
    );
  }

  try {
    await publishEvent(
      sessionId,
      "dice_roll",
      {
        notation: body.data.notation,
        total: result.total,
        breakdown: result.breakdown,
        rolls: result.rolls,
        reason: body.data.reason,
        actorId: actor.eventActorId,
        actor: actor.actorKind,
        displayName: actor.displayName,
        characterId: actor.characterId,
      },
      { actorId: actor.dbActorId },
    );
  } catch (error) {
    if (dmTurnLock) await releaseDmTurnLock(dmTurnLock);
    throw error;
  }

  if (actor.actorKind === "player") {
    try {
      await publishDmEvent(sessionId, dmTurnLock!, "dm_thinking", {
        active: true,
      });
      await confirmDmTurnLockOwned(dmTurnLock!);
    } catch (error) {
      if (dmTurnLock) await releaseDmTurnLock(dmTurnLock);
      throw error;
    }
    void runDmTurn({
      sessionId,
      campaignId: session.campaignId,
      userId: session.campaign.hostId,
      playerInput: {
        text: buildRollInput({
          displayName: actor.displayName,
          notation: body.data.notation,
          total: result.total,
          breakdown: result.breakdown,
          reason: body.data.reason,
        }),
        actorId: actor.dbActorId,
        displayName: actor.displayName,
        characterId: actor.characterId,
        actorKind: actor.actorKind,
        alreadyPersisted: true,
      },
      emit: async (ev) => {
        await publishDmEvent(sessionId, dmTurnLock!, ev.type, ev.payload);
      },
    })
      .catch(async (e) => {
        await publishDmErrorWhileOwned(sessionId, dmTurnLock!, e);
      })
      .finally(async () => {
        if (dmTurnLock) await finalizeDmTurn(sessionId, dmTurnLock);
      });
  }

  return NextResponse.json({
    total: result.total,
    breakdown: result.breakdown,
  });
}

async function publishDmErrorWhileOwned(
  sessionId: string,
  lock: DmTurnLock,
  error: unknown,
) {
  try {
    await publishDmEvent(sessionId, lock, "dm_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
  } catch {
    // A stale runner must not emit an error into its successor's event stream.
  }
}

async function publishDmEvent(
  sessionId: string,
  lock: DmTurnLock,
  type: string,
  payload: Record<string, unknown>,
) {
  await confirmDmTurnLockOwned(lock);
  await publishEvent(sessionId, type, {
    ...payload,
    _dmTurnFence: lock.fence,
  });
}

async function finalizeDmTurn(sessionId: string, lock: DmTurnLock) {
  try {
    await withTimeout(
      publishDmEvent(sessionId, lock, "dm_thinking", { active: false }),
      DM_FINALIZATION_TIMEOUT_MS,
    );
  } catch {
    // Lease loss or a stuck event bus must not retain the admission lock.
  } finally {
    await releaseDmTurnLock(lock);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("DM finalization timed out"));
    }, timeoutMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function blockedByCombatTurn(
  campaignId: string,
  actor: ActingIdentity,
): Promise<{ error: "not_your_turn"; active: string | null } | null> {
  if (actor.actorKind !== "player" || !actor.characterId) return null;
  const encounter = await prisma.encounter.findFirst({
    where: { campaignId, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: { initiative: true, activeTurn: true },
  });
  if (!encounter) return null;
  const allowed = isActiveTurnForCharacter({
    initiative: encounter.initiative,
    turnIndex: encounter.activeTurn,
    characterId: actor.characterId,
    characterName: actor.displayName,
  });
  return allowed
    ? null
    : {
        error: "not_your_turn",
        active: activeInitiativeName(encounter.initiative, encounter.activeTurn),
      };
}

function buildRollInput(input: {
  displayName: string;
  notation: string;
  total: number;
  breakdown: string;
  reason?: string;
}) {
  return [
    `${input.displayName} hat ${input.notation} gewürfelt: ${input.total}.`,
    input.reason ? `Anlass: ${input.reason}.` : "",
    `Details: ${input.breakdown}.`,
    "Werte das Ergebnis als DM aus.",
  ]
    .filter(Boolean)
    .join(" ");
}
