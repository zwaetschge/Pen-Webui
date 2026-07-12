import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createInvite } from "@/lib/invite";
import { lockPairingSeat } from "./pairing-lock";

export type PairingSeat = {
  characterId: string;
  characterName: string;
  status: "ready" | "paired";
  invitePath: string | null;
  expiresAt: string | null;
};

export type PairingState = {
  sessionId: string;
  seats: PairingSeat[];
};

type OwnedSession = {
  id: string;
  campaignId: string;
  campaign: { hostId: string };
};

type PairingInvite = {
  id: string;
  code: string;
  expiresAt: Date;
};

async function ownedActiveSession(
  sessionId: string,
  hostId: string,
): Promise<OwnedSession | null> {
  return prisma.gameSession.findFirst({
    where: {
      id: sessionId,
      endedAt: null,
      campaign: { hostId },
    },
    select: {
      id: true,
      campaignId: true,
      campaign: { select: { hostId: true } },
    },
  });
}

function seatState(opts: {
  character: { id: string; name: string };
  member: { id: string } | null;
  invite: PairingInvite | null;
}): PairingSeat {
  const paired = Boolean(opts.member);
  return {
    characterId: opts.character.id,
    characterName: opts.character.name,
    status: paired ? "paired" : "ready",
    invitePath: paired || !opts.invite ? null : `/play/invite/${opts.invite.code}`,
    expiresAt:
      paired || !opts.invite ? null : opts.invite.expiresAt.toISOString(),
  };
}

/** Read-only state for GET. This never creates or revokes an invite. */
export async function pairingStateForHost(
  sessionId: string,
  hostId: string,
): Promise<PairingState | null> {
  const session = await ownedActiveSession(sessionId, hostId);
  if (!session) return null;

  const now = new Date();
  const [characters, members, liveInvites] = await Promise.all([
    prisma.character.findMany({
      where: { campaignId: session.campaignId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.sessionMember.findMany({
      where: { sessionId, characterId: { not: null }, leftAt: null },
      select: { id: true, characterId: true },
    }),
    prisma.invite.findMany({
      where: {
        sessionId,
        characterId: { not: null },
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, characterId: true, code: true, expiresAt: true },
    }),
  ]);

  const memberByCharacter = new Map(
    members.flatMap((member) =>
      member.characterId ? [[member.characterId, member] as const] : [],
    ),
  );
  const inviteByCharacter = new Map<string, PairingInvite>();
  for (const invite of liveInvites) {
    if (invite.characterId && !inviteByCharacter.has(invite.characterId)) {
      inviteByCharacter.set(invite.characterId, invite);
    }
  }

  return {
    sessionId,
    seats: characters.map((character) =>
      seatState({
        character,
        member: memberByCharacter.get(character.id) ?? null,
        invite: inviteByCharacter.get(character.id) ?? null,
      }),
    ),
  };
}

/**
 * Ensure one live pairing capability per campaign character.
 * Each seat is independently serialized with the same lock used by claim.
 */
export async function ensurePairingForHost(
  sessionId: string,
  hostId: string,
): Promise<PairingState | null> {
  const session = await ownedActiveSession(sessionId, hostId);
  if (!session) return null;

  const characters = await prisma.character.findMany({
    where: { campaignId: session.campaignId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const seats: PairingSeat[] = [];

  for (const character of characters) {
    const seat = await prisma.$transaction(async (tx) => {
      await lockPairingSeat(tx, sessionId, character.id);

      // This snapshot must happen after the lock. Claim uses the same lock.
      const member = await tx.sessionMember.findFirst({
        where: { sessionId, characterId: character.id, leftAt: null },
        select: { id: true },
      });
      const liveInvites = await tx.invite.findMany({
        where: {
          sessionId,
          characterId: character.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, code: true, expiresAt: true },
      });

      let invite = liveInvites[0] ?? null;
      const duplicateIds = liveInvites.slice(1).map((row) => row.id);
      if (duplicateIds.length > 0) {
        await tx.invite.updateMany({
          where: { id: { in: duplicateIds } },
          data: { revokedAt: new Date() },
        });
      }

      if (!invite) {
        const created = await createInvite(
          {
            campaignId: session.campaignId,
            issuedById: hostId,
            sessionId,
            characterId: character.id,
            displayName: character.name,
            ttlHours: 12,
          },
          tx,
        );
        invite = created.invite;
      }

      return seatState({ character, member, invite });
    });
    seats.push(seat);
  }

  return { sessionId, seats };
}

/** Replace a seat credential and disconnect any device currently occupying it. */
export async function reissuePairingForHost(
  sessionId: string,
  hostId: string,
  characterId: string,
): Promise<PairingSeat | null> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.gameSession.findFirst({
      where: {
        id: sessionId,
        endedAt: null,
        campaign: { hostId },
      },
      select: { id: true, campaignId: true },
    });
    if (!session) return null;

    const character = await tx.character.findFirst({
      where: { id: characterId, campaignId: session.campaignId },
      select: { id: true, name: true },
    });
    if (!character) return null;

    await lockPairingSeat(tx, sessionId, character.id);
    const now = new Date();
    await tx.sessionMember.updateMany({
      where: { sessionId, characterId: character.id, leftAt: null },
      data: { leftAt: now },
    });
    // Includes consumed invites: old cookies resolve through their invite row.
    await tx.invite.updateMany({
      where: { sessionId, characterId: character.id, revokedAt: null },
      data: { revokedAt: now },
    });

    const created = await createInvite(
      {
        campaignId: session.campaignId,
        issuedById: hostId,
        sessionId,
        characterId: character.id,
        displayName: character.name,
        ttlHours: 12,
      },
      tx as Prisma.TransactionClient,
    );

    return seatState({ character, member: null, invite: created.invite });
  });
}
