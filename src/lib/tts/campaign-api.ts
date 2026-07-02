import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listCloneVoices } from "./vocarium-client";
import {
  campaignIdForInviteSession,
  resolveCampaignVoiceAccess,
} from "./campaign-access";
import { voiceAssignmentsPutSchema } from "./types";

export async function handleCampaignVoices(
  req: Request,
  campaignId: string,
  opts: { sessionId?: string | null; inviteToken?: string | null } = {},
) {
  const access = await resolveCampaignVoiceAccess({ campaignId, req, ...opts });
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const voices = await listCloneVoices(access.hostUsername);
  return NextResponse.json({ voices: voices.map(toPublicVoice) });
}

export async function handleGetVoiceAssignments(
  req: Request,
  campaignId: string,
  opts: { sessionId?: string | null; inviteToken?: string | null } = {},
) {
  const access = await resolveCampaignVoiceAccess({ campaignId, req, ...opts });
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (access.role === "player" && !access.characterId) {
    return NextResponse.json({ assignments: [] });
  }

  const rows = await prisma.voiceAssignment.findMany({
    where: {
      campaignId,
      vocariumUser: access.hostUsername,
      ...(access.role === "host"
        ? {}
        : {
            targetType: "character",
            targetId: access.characterId!,
          }),
    },
    orderBy: [{ targetType: "asc" }, { targetId: "asc" }],
    select: {
      id: true,
      targetType: true,
      targetId: true,
      voiceId: true,
      voiceName: true,
      voiceSource: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ assignments: rows });
}

export async function handlePutVoiceAssignments(
  req: Request,
  campaignId: string,
  opts: { sessionId?: string | null; inviteToken?: string | null } = {},
) {
  const access = await resolveCampaignVoiceAccess({ campaignId, req, ...opts });
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = voiceAssignmentsPutSchema.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );
  }

  for (const assignment of body.data.assignments) {
    if (!canWriteAssignment(access, assignment)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const voices = await listCloneVoices(access.hostUsername);
  const voiceById = new Map(voices.map((voice) => [voice.voiceId, voice]));

  const saved = [];
  for (const assignment of body.data.assignments) {
    const voice = voiceById.get(assignment.voiceId);
    if (!voice) {
      return NextResponse.json(
        { error: "unknown_voice", voiceId: assignment.voiceId },
        { status: 400 },
      );
    }
    saved.push(
      await prisma.voiceAssignment.upsert({
        where: {
          campaignId_targetType_targetId: {
            campaignId,
            targetType: assignment.targetType,
            targetId: assignment.targetId,
          },
        },
        create: {
          campaignId,
          targetType: assignment.targetType,
          targetId: assignment.targetId,
          vocariumUser: access.hostUsername,
          voiceId: voice.voiceId,
          voiceName: voice.name,
          voiceSource: voice.source,
        },
        update: {
          vocariumUser: access.hostUsername,
          voiceId: voice.voiceId,
          voiceName: voice.name,
          voiceSource: voice.source,
        },
      }),
    );
  }

  return NextResponse.json({ assignments: saved.map(toPublicAssignment) });
}

export async function handleInviteSessionVoices(
  req: Request,
  sessionId: string,
  inviteToken: string,
) {
  const resolved = await campaignIdForInviteSession(sessionId, inviteToken);
  if (!resolved) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return handleCampaignVoices(req, resolved.campaignId, { sessionId, inviteToken });
}

export async function handleInviteSessionVoiceAssignments(
  req: Request,
  sessionId: string,
  inviteToken: string,
) {
  const resolved = await campaignIdForInviteSession(sessionId, inviteToken);
  if (!resolved) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return req.method === "PUT"
    ? handlePutVoiceAssignments(req, resolved.campaignId, {
        sessionId,
        inviteToken,
      })
    : handleGetVoiceAssignments(req, resolved.campaignId, {
        sessionId,
        inviteToken,
      });
}

function canWriteAssignment(
  access: { role: "host" | "player"; characterId: string | null },
  assignment: { targetType: string; targetId: string },
) {
  if (access.role === "host") return true;
  return (
    assignment.targetType === "character" &&
    Boolean(access.characterId) &&
    assignment.targetId === access.characterId
  );
}

function toPublicVoice(voice: {
  vocariumUser: string;
  voiceId: string;
  name: string;
  language: string | null;
  source: string;
}) {
  const publicVoice = { ...voice };
  delete (publicVoice as { vocariumUser?: string }).vocariumUser;
  return publicVoice;
}

function toPublicAssignment(assignment: {
  vocariumUser: string;
  id: string;
  targetType: string;
  targetId: string;
  voiceId: string;
  voiceName: string;
  voiceSource: string;
  updatedAt?: Date;
}) {
  const publicAssignment = { ...assignment };
  delete (publicAssignment as { vocariumUser?: string }).vocariumUser;
  return publicAssignment;
}
