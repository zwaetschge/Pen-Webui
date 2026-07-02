import { prisma } from "../db";
import type { SessionAccess } from "./access";

type Access = NonNullable<SessionAccess>;

export type ActingIdentity = {
  displayName: string;
  dbActorId: string | null;
  eventActorId: string | null;
  characterId: string | null;
  actorKind: "dm" | "player";
};

export async function resolveActingIdentity(opts: {
  access: Access;
  campaignId: string;
  requestedCharacterId?: string | null;
}): Promise<ActingIdentity | null> {
  const requestedCharacterId = opts.requestedCharacterId?.trim();

  if (requestedCharacterId) {
    const character = await prisma.character.findFirst({
      where: { id: requestedCharacterId, campaignId: opts.campaignId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!character) return null;

    if (opts.access.role === "host") {
      return {
        displayName: character.name,
        dbActorId: opts.access.userId,
        eventActorId: opts.access.memberId,
        characterId: character.id,
        actorKind: "player",
      };
    }

    if (
      opts.access.characterId === character.id ||
      (opts.access.userId && character.ownerId === opts.access.userId)
    ) {
      return {
        displayName: character.name,
        dbActorId: opts.access.userId,
        eventActorId: opts.access.memberId,
        characterId: character.id,
        actorKind: "player",
      };
    }

    return null;
  }

  if (opts.access.role === "player" && opts.access.characterId) {
    const character = await prisma.character.findFirst({
      where: { id: opts.access.characterId, campaignId: opts.campaignId },
      select: { id: true, name: true },
    });
    if (character) {
      return {
        displayName: character.name,
        dbActorId: opts.access.userId,
        eventActorId: opts.access.memberId,
        characterId: character.id,
        actorKind: "player",
      };
    }
  }

  return {
    displayName: opts.access.displayName,
    dbActorId: opts.access.userId,
    eventActorId: opts.access.role === "host" ? null : opts.access.memberId,
    characterId: null,
    actorKind: opts.access.role === "host" ? "dm" : "player",
  };
}
