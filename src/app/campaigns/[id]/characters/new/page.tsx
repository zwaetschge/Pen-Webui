import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { CharacterCreateForm } from "./_components/CharacterCreateForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function NewCharacterPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      OR: [{ hostId: user.id }, { characters: { some: { ownerId: user.id } } }],
    },
    select: { id: true, title: true, theme: true, hostId: true },
  });
  if (!campaign) notFound();

  const isHost = campaign.hostId === user.id;
  if (!isHost) {
    // Regular players get one character. The campaign host can create several
    // local characters for same-device play.
    const existing = await prisma.character.findFirst({
      where: { campaignId: id, ownerId: user.id },
      select: { id: true },
    });
    if (existing) redirect(`/campaigns/${id}/characters/${existing.id}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
        New character
      </p>
      <h1 className="font-display text-3xl text-parchment-100">
        {campaign.title}
      </h1>
      <p className="mt-1 font-serif text-sm italic text-brass-300">
        {campaign.theme}
      </p>
      <div className="brass-divider my-6" />

      <CharacterCreateForm campaignId={campaign.id} localMode={isHost} />
    </main>
  );
}
