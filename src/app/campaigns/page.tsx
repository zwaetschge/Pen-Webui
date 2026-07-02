import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { DeleteCampaignButton } from "./_components/DeleteCampaignButton";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "border-ink-200/40 bg-ink-500/60 text-ink-100",
  generating: "border-arcane-500/40 bg-arcane-600/30 text-arcane-400",
  ready: "border-brass-400/60 bg-brass-700/30 text-brass-300",
  playing: "border-blood-500/60 bg-blood-600/30 text-parchment-200",
  archived: "border-ink-200/40 bg-ink-500/40 text-ink-200",
};

export default async function CampaignsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");

  const where = user.isDM
    ? { hostId: user.id }
    : {
        characters: { some: { ownerId: user.id } },
      };

  const campaigns = await prisma.campaign.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { npcs: true, locations: true, sessions: true } },
    },
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="font-display text-xs uppercase tracking-[0.4em] text-brass-400">
            {user.isDM ? "Your tables" : "Where you play"}
          </p>
          <h1 className="font-display text-4xl text-parchment-100">
            Campaigns
          </h1>
        </div>
        {user.isDM ? (
          <Link
            href="/dm/new"
            className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-4 py-2 text-sm text-parchment-100 transition hover:bg-arcane-500/40"
          >
            New campaign →
          </Link>
        ) : null}
      </header>

      {campaigns.length === 0 ? (
        <div className="panel p-10 text-center font-serif text-ink-100">
          {user.isDM
            ? "No campaigns yet. Forge your first table."
            : "You haven't been invited to any campaigns yet."}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {campaigns.map((c) => (
            <li key={c.id} className="panel p-5">
              <div className="flex items-start justify-between">
                <Link href={`/campaigns/${c.id}`} className="block flex-1">
                  <h3 className="font-display text-xl text-parchment-100 hover:text-parchment-50">
                    {c.title}
                  </h3>
                </Link>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                    STATUS_COLORS[c.status] ?? STATUS_COLORS.draft
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <p className="mt-1 font-serif text-sm italic text-brass-300">
                {c.theme}
              </p>
              <div className="mt-3 flex gap-4 text-xs text-ink-200">
                <span>{c._count.npcs} NPCs</span>
                <span>{c._count.locations} locations</span>
                <span>{c._count.sessions} sessions</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Link
                  href={`/campaigns/${c.id}`}
                  className="rounded-md border border-brass-700/40 bg-ink-600/60 px-3 py-1 text-xs text-brass-300 transition hover:border-brass-400/60"
                >
                  Open
                </Link>
                {user.isDM ? (
                  <>
                    <Link
                      href={`/campaigns/${c.id}/assets`}
                      className="rounded-md border border-brass-700/40 bg-ink-600/60 px-3 py-1 text-xs text-brass-300 transition hover:border-brass-400/60"
                    >
                      Assets
                    </Link>
                    <DeleteCampaignButton
                      campaignId={c.id}
                      title={c.title}
                      compact
                    />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
