"use client";

import { useGame } from "@/lib/game/store";

export function SceneBrief() {
  const scene = useGame((s) => s.scene);
  const intro = scene.introSequence;
  const nextActions = scene.nextActions ?? [];
  const introBeats = intro?.setupBeats.map((beat) => beat.text) ?? [];
  const characterIntros = intro?.characterIntros ?? [];
  const hasBrief =
    intro ||
    scene.whyHere ||
    scene.objective ||
    scene.stakes ||
    scene.locationDescription ||
    nextActions.length > 0;

  if (!hasBrief) return null;

  return (
    <section className="gm-screen max-h-[12dvh] shrink-0 overflow-y-auto border-b border-brass-700/45 bg-ink-600/35 px-4 py-3 sm:max-h-[18dvh] sm:py-4 lg:max-h-[26vh]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[11px] uppercase tracking-[0.26em] text-brass-400">
            Spielleiterschirm
          </p>
          <h2 className="mt-1 font-display text-xl text-parchment-100">
            {scene.sceneTitle ?? scene.locationName ?? "Auftakt"}
          </h2>
        </div>
        {scene.locationName ? (
          <span className="shrink-0 rounded-md border border-brass-700/40 bg-ink-500/60 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-brass-300">
            {scene.locationName}
          </span>
        ) : null}
      </div>

      <div className="mt-3 hidden space-y-3 font-serif text-base leading-relaxed sm:block">
        {scene.whyHere ? (
          <BriefBlock label="Warum du hier bist" text={scene.whyHere} />
        ) : null}
        {scene.objective ? (
          <BriefBlock label="Ziel" text={scene.objective} strong />
        ) : null}
        {scene.stakes ? (
          <BriefBlock label="Einsatz" text={scene.stakes} />
        ) : null}
      </div>

      {scene.presentNpcs?.length ? (
        <div className="mt-3 hidden sm:block">
          <p className="font-display text-[10px] uppercase tracking-[0.22em] text-brass-400">
            Figuren am Tisch
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {scene.presentNpcs.slice(0, 6).map((npc) => (
              <span
                key={npc.id}
                className="table-chip border border-brass-700/40 bg-ink-500/55 px-2.5 py-1.5 text-sm text-ink-50"
              >
                {npc.name}
                {npc.role ? (
                  <span className="ml-1 text-ink-200">({npc.role})</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {intro ? (
        <div className="mt-3 hidden gap-3 sm:grid lg:grid-cols-2">
          {intro.establishingShot || introBeats.length > 0 ? (
            <div>
              <p className="font-display text-[10px] uppercase tracking-[0.22em] text-brass-400">
                Auftaktbeats
              </p>
              <ol className="mt-1 space-y-1.5 font-serif text-sm leading-relaxed text-ink-50">
                {[intro.establishingShot, ...introBeats]
                  .filter((beat): beat is string => Boolean(beat))
                  .slice(0, 5)
                  .map((beat, index) => (
                    <li key={`${index}-${beat}`} className="flex gap-2">
                      <span className="mt-0.5 font-display text-[10px] text-brass-400">
                        {index + 1}
                      </span>
                      <span>{beat}</span>
                    </li>
                  ))}
              </ol>
            </div>
          ) : null}

          {characterIntros.length > 0 ? (
            <div>
              <p className="font-display text-[10px] uppercase tracking-[0.22em] text-brass-400">
                Charakterauftritte
              </p>
              <ul className="mt-1 space-y-1.5 font-serif text-sm leading-relaxed text-ink-50">
                {characterIntros.map((charIntro) => (
                  <li key={charIntro.characterId}>
                    <span className="text-parchment-100">
                      {charIntro.name}
                    </span>
                    {charIntro.summary ? (
                      <span className="text-ink-200">
                        {" "}
                        · {charIntro.summary}
                      </span>
                    ) : null}
                    {charIntro.prompt ? (
                      <span className="block text-ink-100">
                        {charIntro.prompt}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {nextActions.length > 0 ? (
        <div className="mt-3 hidden lg:block">
          <p className="font-display text-[10px] uppercase tracking-[0.22em] text-brass-400">
            Naheliegende Züge
          </p>
          <ol className="mt-1 space-y-1.5 font-serif text-base text-parchment-100">
            {nextActions.slice(0, 3).map((action, index) => (
              <li key={action} className="flex gap-2">
                <span className="mt-0.5 font-display text-xs text-brass-400">
                  {index + 1}
                </span>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function BriefBlock({
  label,
  text,
  strong = false,
}: {
  label: string;
  text: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="font-display text-[11px] uppercase tracking-[0.22em] text-brass-400">
        {label}
      </p>
      <p className={strong ? "text-parchment-50" : "text-ink-50"}>{text}</p>
    </div>
  );
}
