import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameRoom } from "@/components/game/GameRoom";
import { companionSummary } from "@/lib/character/summary";
import { resolveActiveDisplayCapability } from "@/lib/cast/display-capability";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "TV-Ausgabe · Plum Tabletop",
  robots: { index: false, follow: false },
};

export default async function DisplaySessionPage({
  params,
}: {
  params: Promise<{ id: string; token: string }>;
}) {
  const { id, token } = await params;
  if (
    !(await resolveActiveDisplayCapability(token, id, env().INVITE_HMAC_SECRET))
  ) {
    notFound();
  }

  const session = await prisma.gameSession.findUnique({
    where: { id },
    select: {
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

  const localCharacters = session.campaign.characters.map((character) => ({
    id: character.id,
    name: character.name,
    portraitUrl: character.portraitAsset?.url ?? null,
    ...companionSummary(character.sheet),
  }));

  return (
    <GameRoom
      campaignId={session.campaign.id}
      sessionId={id}
      displayToken={token}
      campaignTitle={session.campaign.title}
      campaignTheme={session.campaign.theme}
      role="player"
      localCharacters={localCharacters}
      experience="display"
    />
  );
}
