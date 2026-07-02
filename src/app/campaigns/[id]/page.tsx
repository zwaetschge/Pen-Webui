/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { DeleteCampaignButton } from "../_components/DeleteCampaignButton";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function CampaignDetail({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      OR: [{ hostId: user.id }, { characters: { some: { ownerId: user.id } } }],
    },
    include: {
      world: true,
      npcs: { include: { portraitAsset: true } },
      locations: { include: { backgroundAsset: true } },
      items: { include: { iconAsset: true } },
      characters: { include: { portraitAsset: true } },
      sessions: { orderBy: { startedAt: "desc" }, take: 5 },
      invites: { where: { revokedAt: null, usedAt: null }, take: 10 },
    },
  });
  if (!campaign) notFound();

  const isHost = campaign.hostId === user.id;
  const myCharacter = campaign.characters.find((c) => c.ownerId === user.id);
  const activeSession = campaign.sessions.find((s) => !s.endedAt);
  const visibleLocations = isHost ? campaign.locations : [];
  const visibleNpcs = isHost
    ? campaign.npcs
    : campaign.npcs.filter((npc) => npc.visibility === "revealed");
  const visibleCharacters = isHost
    ? campaign.characters
    : campaign.characters.filter((character) => character.ownerId === user.id);
  const visibleItems = isHost ? campaign.items : [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link
        href="/campaigns"
        className="font-display text-xs uppercase tracking-[0.3em] text-brass-400 hover:text-brass-300"
      >
        ← all campaigns
      </Link>

      <header className="mb-8 mt-3">
        <span className="rounded-full border border-brass-400/40 bg-brass-700/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass-300">
          {campaign.status}
        </span>
        <h1 className="mt-2 font-display text-4xl text-parchment-100">
          {campaign.title}
        </h1>
        <p className="mt-1 font-serif text-brass-300">{campaign.theme}</p>
        {campaign.tone ? (
          <p className="font-serif text-sm italic text-ink-100">
            {campaign.tone}
          </p>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <section>
          <SectionHeading title="Locations" count={visibleLocations.length} />
          {visibleLocations.length === 0 ? (
            <EmptyState
              text={
                isHost
                  ? "No locations have been drafted yet."
                  : "No locations have been revealed yet."
              }
            />
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {visibleLocations.map((loc) => (
                <article key={loc.id} className="panel overflow-hidden">
                  {loc.backgroundAsset?.url ? (
                    <div className="relative aspect-video w-full">
                      <img
                        src={loc.backgroundAsset.url}
                        alt={loc.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-ink-600 text-xs text-ink-200">
                      asset pending
                    </div>
                  )}
                  <div className="p-3">
                    <h4 className="font-display text-lg text-parchment-100">
                      {loc.name}
                    </h4>
                    <p className="mt-1 line-clamp-2 font-serif text-xs text-ink-100">
                      {loc.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}

          <SectionHeading
            title="NPCs"
            count={visibleNpcs.length}
            className="mt-8"
          />
          {visibleNpcs.length === 0 ? (
            <EmptyState text="No NPCs have been revealed yet." />
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {visibleNpcs.map((npc) => (
                <article key={npc.id} className="panel overflow-hidden">
                  {npc.portraitAsset?.url ? (
                    <div className="relative aspect-[3/4] w-full">
                      <img
                        src={npc.portraitAsset.url}
                        alt={npc.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[3/4] w-full items-center justify-center bg-ink-600 text-xs text-ink-200">
                      portrait pending
                    </div>
                  )}
                  <div className="p-3">
                    <h4 className="font-display text-sm text-parchment-100">
                      {npc.name}
                    </h4>
                    <p className="font-serif text-[11px] uppercase tracking-wider text-brass-400">
                      {npc.role}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}

          <SectionHeading
            title="Characters"
            count={visibleCharacters.length}
            className="mt-8"
          />
          {visibleCharacters.length === 0 ? (
            <EmptyState text="No player characters have joined this campaign." />
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {visibleCharacters.map((character) => {
                const sheet = character.sheet as Record<string, unknown>;
                return (
                  <Link
                    key={character.id}
                    href={`/campaigns/${campaign.id}/characters/${character.id}`}
                    className="panel flex gap-3 p-3 transition hover:border-brass-400/60"
                  >
                    {character.portraitAsset?.url ? (
                      <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-md border border-brass-700/40">
                        <img
                          src={character.portraitAsset.url}
                          alt={character.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-brass-700/40 bg-ink-600 text-[10px] text-ink-200">
                        portrait
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="truncate font-display text-parchment-100">
                        {character.name}
                      </h4>
                      <p className="mt-1 text-xs text-brass-300">
                        Level {String(sheet.level ?? 1)}{" "}
                        {String(sheet.race ?? "")} {String(sheet.class ?? "")}
                      </p>
                      <p className="mt-1 text-xs text-ink-200">
                        AC {String(sheet.ac ?? 10)} / HP{" "}
                        {String(sheet.hpCurrent ?? sheet.hpMax ?? 10)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <SectionHeading
            title="Items"
            count={visibleItems.length}
            className="mt-8"
          />
          {visibleItems.length === 0 ? (
            <EmptyState
              text={
                isHost
                  ? "No notable items have been added yet."
                  : "No notable items have been revealed yet."
              }
            />
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {visibleItems.map((item) => (
                <article key={item.id} className="panel flex gap-3 p-3">
                  {item.iconAsset?.url ? (
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-brass-700/40">
                      <img
                        src={item.iconAsset.url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-md border border-brass-700/40 bg-ink-600" />
                  )}
                  <div>
                    <h4 className="font-display text-sm text-parchment-100">
                      {item.name}
                    </h4>
                    <p className="mt-1 line-clamp-2 font-serif text-xs text-ink-100">
                      {item.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="panel p-5">
            <h3 className="font-display text-sm uppercase tracking-[0.3em] text-brass-400">
              Play
            </h3>
            {isHost ? (
              <div className="mt-3 flex flex-col gap-2">
                <Link
                  href={
                    activeSession
                      ? `/table/sessions/${activeSession.id}`
                      : `/dm/sessions/start?campaign=${campaign.id}`
                  }
                  className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-4 py-2 text-center text-sm text-parchment-100 transition hover:bg-arcane-500/40"
                >
                  {activeSession ? "Resume table" : "Start session"}
                </Link>
                {activeSession ? (
                  <Link
                    href={`/dm/sessions/start?campaign=${campaign.id}`}
                    className="rounded-md border border-brass-700/40 bg-ink-600/60 px-4 py-2 text-center text-sm text-brass-300 transition hover:border-brass-400/60"
                  >
                    Open new session
                  </Link>
                ) : null}
                <Link
                  href={`/campaigns/${campaign.id}/invites`}
                  className="rounded-md border border-brass-400/60 bg-brass-700/30 px-4 py-2 text-center text-sm text-parchment-100 transition hover:bg-brass-600/40"
                >
                  Invite players
                </Link>
                <Link
                  href={`/campaigns/${campaign.id}/characters/new`}
                  className="rounded-md border border-brass-700/40 bg-ink-600/60 px-4 py-2 text-center text-sm text-brass-300 transition hover:border-brass-400/60"
                >
                  Create local character
                </Link>
                <Link
                  href={`/campaigns/${campaign.id}/assets`}
                  className="rounded-md border border-brass-700/40 bg-ink-600/60 px-4 py-2 text-center text-sm text-brass-300 transition hover:border-brass-400/60"
                >
                  Asset dashboard
                </Link>
                <DeleteCampaignButton
                  campaignId={campaign.id}
                  title={campaign.title}
                  redirectAfterDelete
                />
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {activeSession && myCharacter ? (
                  <Link
                    href={`/table/sessions/${activeSession.id}`}
                    className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-4 py-2 text-center text-sm text-parchment-100 transition hover:bg-arcane-500/40"
                  >
                    Join table
                  </Link>
                ) : null}
                {myCharacter ? (
                  <Link
                    href={`/campaigns/${campaign.id}/characters/${myCharacter.id}`}
                    className="rounded-md border border-brass-400/60 bg-brass-700/30 px-4 py-2 text-center text-sm text-parchment-100 transition hover:bg-brass-600/40"
                  >
                    Edit my character
                  </Link>
                ) : (
                  <Link
                    href={`/campaigns/${campaign.id}/characters/new`}
                    className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-4 py-2 text-center text-sm text-parchment-100 transition hover:bg-arcane-500/40"
                  >
                    Create my character
                  </Link>
                )}
                <p className="text-xs text-ink-200">
                  The DM will open the table when ready.
                </p>
              </div>
            )}
          </div>

          {isHost && campaign.invites.length > 0 ? (
            <div className="panel p-5">
              <h3 className="font-display text-sm uppercase tracking-[0.3em] text-brass-400">
                Pending invites
              </h3>
              <ul className="mt-3 space-y-2 text-xs">
                {campaign.invites.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex justify-between text-ink-100"
                  >
                    <span>{inv.displayName ?? "guest"}</span>
                    <span className="text-ink-200">
                      exp&nbsp;{inv.expiresAt.toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {campaign.sessions.length > 0 ? (
            <div className="panel p-5">
              <h3 className="font-display text-sm uppercase tracking-[0.3em] text-brass-400">
                Recent sessions
              </h3>
              <ul className="mt-3 space-y-2 text-xs">
                {campaign.sessions.map((s) => (
                  <li key={s.id} className="flex justify-between text-ink-100">
                    <Link
                      href={`/table/sessions/${s.id}`}
                      className="hover:text-parchment-200"
                    >
                      {s.startedAt.toLocaleDateString()}
                    </Link>
                    <span className="text-ink-200">
                      {s.endedAt ? "ended" : "active"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-md border border-brass-700/30 bg-ink-500/35 px-4 py-6 text-center font-serif text-sm text-ink-100">
      {text}
    </div>
  );
}

function SectionHeading({
  title,
  count,
  className,
}: {
  title: string;
  count: number;
  className?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between border-b border-brass-700/30 pb-2 ${className ?? ""}`}
    >
      <h2 className="font-display text-lg text-parchment-200">{title}</h2>
      <span className="text-xs text-ink-200">{count}</span>
    </div>
  );
}
