/**
 * Unified session-access resolution.
 *
 * A session can be observed by:
 *   - the host (Authelia + isDM + campaign.hostId match)
 *   - an Authelia user with a Character in the campaign
 *   - a guest holding a valid HMAC invite token
 *
 * Callers obtain a `Member` record (or null) describing who they are and
 * what their role is for this particular session.
 */

import { cookies } from "next/headers";
import type { GameSession, SessionMember } from "@prisma/client";
import { getSessionUser } from "../auth";
import { prisma } from "../db";
import {
  buildGuestCredential,
  guestCookieName,
  parseGuestCredential,
} from "../guest-credential";
import { verifyToken } from "../invite";
import { parseToken } from "../invite-token";
import { lockPairingSeat } from "./pairing-lock";

export type SessionAccess =
  | {
      role: "host";
      sessionId: string;
      campaignId: string;
      userId: string;
      displayName: string;
      memberId: string;
    }
  | {
      role: "player";
      sessionId: string;
      campaignId: string;
      userId: string | null;
      displayName: string;
      memberId: string;
      characterId: string | null;
      inviteId: string | null;
    }
  | null;

/** Resolve based on Authelia session OR ?token=<invite> query param. */
export async function resolveAccess(opts: {
  sessionId: string;
  inviteToken?: string | null;
}): Promise<SessionAccess> {
  const session = await prisma.gameSession.findUnique({
    where: { id: opts.sessionId },
    include: { campaign: { select: { id: true, hostId: true } } },
  });
  if (!session) return null;

  if (opts.inviteToken) {
    const parsed = parseToken(opts.inviteToken);
    if (parsed && parsed.expiryUnix >= Math.floor(Date.now() / 1000)) {
      const guest = await resolveGuestCredential(session, parsed.inviteId);
      if (guest) return guest;
    }
  }

  const user = await getSessionUser();
  if (user) {
    // host
    if (session.campaign.hostId === user.id) {
      const member = await ensureMember({
        session,
        userId: user.id,
        displayName: user.name ?? user.username,
        characterId: null,
      });
      if (!member) return null;
      return {
        role: "host",
        sessionId: session.id,
        campaignId: session.campaignId,
        userId: user.id,
        displayName: user.name ?? user.username,
        memberId: member.id,
      };
    }
    // authenticated player
    const character = await prisma.character.findFirst({
      where: {
        campaignId: session.campaignId,
        ownerId: user.id,
      },
    });
    if (character) {
      const member = await ensureMember({
        session,
        userId: user.id,
        displayName: user.name ?? user.username,
        characterId: character.id,
      });
      if (!member) return null;
      return {
        role: "player",
        sessionId: session.id,
        campaignId: session.campaignId,
        userId: user.id,
        displayName: user.name ?? user.username,
        memberId: member.id,
        characterId: character.id,
        inviteId: null,
      };
    }
  }

  if (!opts.inviteToken) {
    const guest = await resolveGuestCredential(session);
    if (guest) return guest;
  }

  return null;
}

export async function claimInviteForSession(
  sessionId: string,
  inviteToken: string,
): Promise<{ credential: string; maxAgeSeconds: number } | null> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: { campaign: { select: { id: true, hostId: true } } },
  });
  if (!session || session.endedAt) return null;

  const invite = await verifyToken(inviteToken);
  if (!invite || invite.campaignId !== session.campaignId) return null;
  if (invite.sessionId && invite.sessionId !== session.id) return null;

  const now = new Date();
  let member: SessionMember | null;
  try {
    member = await prisma.$transaction(async (tx) => {
      if (invite.characterId) {
        await lockPairingSeat(tx, session.id, invite.characterId);
        const occupied = await tx.sessionMember.findFirst({
          where: {
            sessionId: session.id,
            characterId: invite.characterId,
            leftAt: null,
          },
          select: { id: true },
        });
        if (occupied) return null;
      }

      const consumed = await tx.invite.updateMany({
        where: {
          id: invite.id,
          campaignId: session.campaignId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) return null;

      return tx.sessionMember.create({
        data: {
          sessionId: session.id,
          userId: null,
          inviteId: invite.id,
          displayName: invite.displayName ?? "Guest",
          characterId: invite.characterId,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return null;
    throw error;
  }
  if (!member) return null;

  return {
    credential: buildGuestCredential({
      sessionId: session.id,
      memberId: member.id,
      inviteId: invite.id,
      expiresAt: invite.expiresAt,
    }),
    maxAgeSeconds: Math.max(
      60,
      Math.floor((invite.expiresAt.getTime() - now.getTime()) / 1000),
    ),
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function resolveGuestCredential(
  session: GameSession & { campaign: { id: string; hostId: string } },
  expectedInviteId?: string,
): Promise<Exclude<SessionAccess, { role: "host" }> | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(guestCookieName(session.id))?.value;
  if (!raw) return null;
  const credential = parseGuestCredential(raw);
  if (!credential || credential.sessionId !== session.id) return null;
  if (expectedInviteId && credential.inviteId !== expectedInviteId) return null;

  const member = await prisma.sessionMember.findFirst({
    where: {
      id: credential.memberId,
      sessionId: session.id,
      inviteId: credential.inviteId,
      leftAt: null,
    },
    select: {
      id: true,
      displayName: true,
      characterId: true,
      inviteId: true,
    },
  });
  if (!member?.inviteId) return null;

  const invite = await prisma.invite.findUnique({
    where: { id: member.inviteId },
    select: {
      id: true,
      campaignId: true,
      sessionId: true,
      characterId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (
    !invite ||
    invite.campaignId !== session.campaignId ||
    (invite.sessionId !== null && invite.sessionId !== session.id) ||
    (invite.characterId !== null &&
      invite.characterId !== member.characterId) ||
    invite.revokedAt ||
    invite.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }

  return {
    role: "player",
    sessionId: session.id,
    campaignId: session.campaignId,
    userId: null,
    displayName: member.displayName,
    memberId: member.id,
    characterId: member.characterId,
    inviteId: invite.id,
  };
}

async function ensureMember(opts: {
  session: GameSession;
  userId: string | null;
  inviteId?: string | null;
  displayName: string;
  characterId: string | null;
}): Promise<SessionMember | null> {
  const existing = await prisma.sessionMember.findFirst({
    where: {
      sessionId: opts.session.id,
      ...(opts.userId ? { userId: opts.userId } : { inviteId: opts.inviteId }),
    },
  });
  if (
    opts.characterId &&
    (!existing ||
      existing.leftAt ||
      existing.characterId !== opts.characterId)
  ) {
    const occupied = await prisma.sessionMember.findFirst({
      where: {
        sessionId: opts.session.id,
        characterId: opts.characterId,
        leftAt: null,
        ...(existing ? { id: { not: existing.id } } : {}),
      },
      select: { id: true },
    });
    if (occupied) return null;
  }
  if (existing) {
    if (
      existing.characterId !== opts.characterId ||
      existing.displayName !== opts.displayName ||
      existing.leftAt
    ) {
      return prisma.sessionMember.update({
        where: { id: existing.id },
        data: {
          characterId: opts.characterId,
          displayName: opts.displayName,
          leftAt: null,
        },
      });
    }
    return existing;
  }
  try {
    return await prisma.sessionMember.create({
      data: {
        sessionId: opts.session.id,
        userId: opts.userId,
        inviteId: opts.inviteId,
        displayName: opts.displayName,
        characterId: opts.characterId,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return null;
    throw error;
  }
}
