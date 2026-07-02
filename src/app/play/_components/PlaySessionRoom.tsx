import { notFound, redirect } from "next/navigation";
import { GameRoom } from "@/components/game/GameRoom";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveAccess } from "@/lib/game/access";

export async function PlaySessionRoom({
  sessionId,
  inviteToken,
}: {
  sessionId: string;
  inviteToken?: string | null;
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
            select: { id: true, name: true },
          },
        },
      },
    },
  });
  if (!session) notFound();
  const localCharacters =
    access.role === "player"
      ? session.campaign.characters.filter(
          (character) => character.id === access.characterId,
        )
      : session.campaign.characters;

  return (
    <GameRoom
      campaignId={session.campaign.id}
      sessionId={sessionId}
      inviteToken={inviteToken ?? undefined}
      campaignTitle={session.campaign.title}
      campaignTheme={session.campaign.theme}
      role={access.role}
      localCharacters={localCharacters}
    />
  );
}
