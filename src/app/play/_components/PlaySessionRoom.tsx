import { notFound, redirect } from "next/navigation";
import { GameRoom } from "@/components/game/GameRoom";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveAccess } from "@/lib/game/access";
import { companionSummary } from "@/lib/character/summary";

export async function PlaySessionRoom({
  sessionId,
  inviteToken,
  experience = "companion",
}: {
  sessionId: string;
  inviteToken?: string | null;
  experience?: "table" | "companion";
}) {
  const access = await resolveAccess({
    sessionId,
    inviteToken: inviteToken ?? null,
  });

  if (!access) {
    if (inviteToken)
      redirect(`/play/invite/${encodeURIComponent(inviteToken)}`);
    const user = await getSessionUser();
    if (!user) redirect("/");
    notFound();
  }
  if (experience === "table" && access.role !== "host") {
    redirect(`/play/sessions/${encodeURIComponent(sessionId)}`);
  }

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: {
      campaign: {
        select: {
          id: true,
          title: true,
          theme: true,
          characters: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              sheet: true,
              portraitAsset: { select: { url: true } },
            },
          },
        },
      },
    },
  });
  if (!session) notFound();
  const visibleCharacters =
    access.role === "player"
      ? session.campaign.characters.filter(
          (character) => character.id === access.characterId,
        )
      : session.campaign.characters;
  const localCharacters = visibleCharacters.map((character) => ({
    id: character.id,
    name: character.name,
    portraitUrl: character.portraitAsset?.url ?? null,
    ...companionSummary(character.sheet),
  }));

  return (
    <GameRoom
      campaignId={session.campaign.id}
      sessionId={sessionId}
      inviteToken={inviteToken ?? undefined}
      campaignTitle={session.campaign.title}
      campaignTheme={session.campaign.theme}
      role={access.role}
      localCharacters={localCharacters}
      experience={experience}
    />
  );
}
