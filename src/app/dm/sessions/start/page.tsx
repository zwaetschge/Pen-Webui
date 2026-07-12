import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { StartSessionTrigger } from "./_components/StartSessionTrigger";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ campaign?: string }> };

export default async function StartSessionPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user || !user.isDM) redirect("/");

  const { campaign: campaignId } = await searchParams;
  if (!campaignId) redirect("/campaigns");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, hostId: user.id },
    select: {
      id: true,
      title: true,
      status: true,
      characters: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, sheet: true },
      },
    },
  });
  if (!campaign) redirect("/campaigns");

  return (
    <main className="mx-auto max-w-xl px-6 py-12 text-center">
      <p className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
        Open the table
      </p>
      <h1 className="mt-2 font-display text-3xl text-parchment-100">
        {campaign.title}
      </h1>
      <p className="mt-4 font-serif text-ink-100">
        Starting a session will mark the campaign as <em>playing</em> and
        broadcast a new room. Existing sessions for this campaign will be closed.
      </p>
      {campaign.characters.length > 0 ? (
        <section className="mt-6 rounded-md border border-brass-700/40 bg-ink-600/60 p-4 text-left">
          <p className="font-display text-xs uppercase tracking-[0.24em] text-brass-400">
            {campaign.characters.length} {campaign.characters.length === 1 ? "Figur" : "Figuren"} am Tisch
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {campaign.characters.map((character) => {
              const sheet = character.sheet as Record<string, unknown>;
              return (
                <li key={character.id} className="rounded border border-brass-700/30 bg-ink-700/45 px-3 py-2">
                  <span className="block font-display text-parchment-100">{character.name}</span>
                  <span className="text-xs text-ink-200">
                    Stufe {String(sheet.level ?? 1)} · {String(sheet.class ?? "Figur")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="mt-4 rounded-md border border-brass-700/40 bg-ink-600/60 px-4 py-3 text-sm text-brass-300">
          Wähle zuerst eine spielbare Figur aus den Kampagnenfiguren.
        </p>
      )}
      <StartSessionTrigger
        campaignId={campaign.id}
        canStart={campaign.characters.length > 0}
      />
    </main>
  );
}
