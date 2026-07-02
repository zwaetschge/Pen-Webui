import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveAccess } from "@/lib/game/access";
import { parseToken } from "@/lib/invite-token";

export type VoiceAccess =
  | {
      role: "host";
      campaignId: string;
      userId: string;
      characterId: null;
      hostUsername: string;
    }
  | {
      role: "player";
      campaignId: string;
      userId: string | null;
      characterId: string | null;
      hostUsername: string;
    };

export async function resolveCampaignVoiceAccess(input: {
  campaignId: string;
  req: Request;
  sessionId?: string | null;
  inviteToken?: string | null;
}): Promise<VoiceAccess | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      hostId: true,
      host: { select: { username: true } },
    },
  });
  if (!campaign) return null;

  const sessionId =
    input.sessionId ?? new URL(input.req.url).searchParams.get("sessionId");
  if (sessionId) {
    const access = await resolveAccess({
      sessionId,
      inviteToken: input.inviteToken,
    });
    if (access?.campaignId === campaign.id) {
      return access.role === "host"
        ? {
            role: "host",
            campaignId: campaign.id,
            userId: access.userId,
            characterId: null,
            hostUsername: campaign.host.username,
          }
        : {
            role: "player",
            campaignId: campaign.id,
            userId: access.userId,
            characterId: access.characterId,
            hostUsername: campaign.host.username,
          };
    }
  }

  const user = await getSessionUser();
  if (!user) return null;
  if (campaign.hostId === user.id) {
    return {
      role: "host",
      campaignId: campaign.id,
      userId: user.id,
      characterId: null,
      hostUsername: campaign.host.username,
    };
  }

  const character = await prisma.character.findFirst({
    where: { campaignId: campaign.id, ownerId: user.id },
    select: { id: true },
  });
  if (!character) return null;
  return {
    role: "player",
    campaignId: campaign.id,
    userId: user.id,
    characterId: character.id,
    hostUsername: campaign.host.username,
  };
}

export async function campaignIdForInviteSession(
  sessionId: string,
  inviteToken: string,
) {
  const parsed = parseToken(inviteToken);
  if (!parsed || parsed.expiryUnix < Math.floor(Date.now() / 1000)) {
    return null;
  }

  // The invite URL token proves the path was signed. Guest admission itself
  // comes from the already-claimed invite cookie resolved below.
  const access = await resolveAccess({ sessionId });
  if (
    access?.role !== "player" ||
    access.userId !== null ||
    access.inviteId !== parsed.inviteId
  ) {
    return null;
  }

  return { campaignId: access.campaignId, access };
}
