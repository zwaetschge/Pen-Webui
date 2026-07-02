import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { CharacterSheetEditor } from "./_components/CharacterSheetEditor";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string; charId: string }> };

export default async function CharacterPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id, charId } = await params;

  const character = await prisma.character.findFirst({
    where: {
      id: charId,
      campaignId: id,
      OR: [{ ownerId: user.id }, { campaign: { hostId: user.id } }],
    },
    include: { portraitAsset: true },
  });
  if (!character) notFound();

  const editable = character.ownerId === user.id || user.isDM;
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <CharacterSheetEditor
        characterId={character.id}
        initialName={character.name}
        initialSheet={character.sheet as Record<string, unknown>}
        portraitUrl={character.portraitAsset?.url ?? null}
        editable={editable}
      />
    </main>
  );
}
