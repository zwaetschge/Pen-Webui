"use client";

import { useGame } from "@/lib/game/store";
import { latestDialoguePresentation } from "@/lib/game/dialogue-presentation";
import type { GameRoomCharacter } from "./types";

export function CompanionOverview(props: {
  character: GameRoomCharacter | null;
}) {
  const scene = useGame((state) => state.scene);
  const chat = useGame((state) => state.chat);
  const tokens = useGame((state) => state.tokens);
  const combatActive = useGame((state) => state.combat.active);
  const awaiting = useGame((state) => state.awaitingSkillCheck);
  const dmThinking = useGame((state) => state.dmThinking);
  const dialogue = latestDialoguePresentation(chat, scene);
  const characterToken = props.character ? tokens[props.character.id] : null;
  const hitPoints = companionHitPoints({
    combatActive,
    sheet: {
      current: props.character?.hpCurrent ?? 0,
      max: props.character?.hpMax ?? 1,
    },
    token: characterToken
      ? { current: characterToken.hp, max: characterToken.maxHp }
      : null,
  });

  if (!props.character) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-5 py-8">
        <div className="table-note max-w-md border border-brass-700/45 p-5 text-center">
          <p className="font-display text-sm uppercase tracking-[0.22em] text-brass-300">
            Noch keine Figur
          </p>
          <p className="mt-2 font-serif text-base leading-relaxed text-ink-100">
            Öffne am Fernseher „Spieler verbinden“ und scanne den QR-Code deiner
            Figur.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="companion-overview h-full min-h-0 overflow-y-auto px-3 py-3 pb-6 sm:px-4">
      <section className="panel overflow-hidden">
        <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-3 p-3">
          <div className="overflow-hidden rounded-md border border-brass-700/45 bg-ink-600">
            {props.character.portraitUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.character.portraitUrl}
                alt={props.character.name}
                className="aspect-[3/4] h-full w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[3/4] h-full items-center justify-center px-2 text-center font-display text-[10px] uppercase tracking-wider text-ink-200">
                Porträt folgt
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-display text-[10px] uppercase tracking-[0.24em] text-brass-400">
              Deine Figur
            </p>
            <h2 className="truncate font-display text-2xl text-parchment-100">
              {props.character.name}
            </h2>
            <p className="truncate font-serif text-sm text-ink-100">
              Stufe {props.character.level} · {props.character.race} ·{" "}
              {props.character.className}
            </p>
            <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
              <Stat label="TP" value={`${hitPoints.current}/${hitPoints.max}`} />
              <Stat label="RK" value={props.character.ac} />
              <Stat label="Tempo" value={props.character.speed} />
              <Stat label="Passiv" value={props.character.passivePerception} />
            </div>
          </div>
        </div>
      </section>

      <section
        aria-live="polite"
        className="renpy-dialogue-box relative mt-3 px-4 pb-4 pt-5"
      >
        <p className="renpy-nameplate absolute -top-2.5 left-3 px-2 py-1 font-display text-[10px] uppercase tracking-[0.2em] text-parchment-100">
          {dialogue?.speakerLabel ?? scene.locationName ?? "Am Tisch"}
        </p>
        <p className="line-clamp-5 font-serif text-base leading-relaxed text-parchment-100">
          {dialogue?.text ??
            scene.summary ??
            "Die Szene wird vorbereitet. Du kannst deine nächste Aktion unten beschreiben."}
        </p>
      </section>

      {awaiting ? (
        <section className="table-note mt-3 border border-arcane-500/55 px-3 py-2">
          <p className="font-display text-[10px] uppercase tracking-[0.2em] text-arcane-400">
            Probe bereit
          </p>
          <p className="mt-1 text-sm text-parchment-100">
            {awaiting.skill} gegen SG {awaiting.dc}. Unten kannst du direkt
            würfeln.
          </p>
        </section>
      ) : dmThinking ? (
        <p className="mt-3 text-center font-display text-[10px] uppercase tracking-[0.24em] text-brass-300">
          Codex-DM wertet eure Aktion aus
        </p>
      ) : null}
    </div>
  );
}

export function companionHitPoints(input: {
  combatActive: boolean;
  sheet: { current: number; max: number };
  token: { current?: number | null; max?: number | null } | null;
}) {
  const source = input.combatActive && input.token ? input.token : input.sheet;
  return {
    current: Math.max(
      0,
      Math.floor(source.current ?? input.sheet.current),
    ),
    max: Math.max(1, Math.floor(source.max ?? input.sheet.max)),
  };
}

function Stat(props: { label: string; value: string | number }) {
  return (
    <div className="table-chip border border-brass-700/35 bg-ink-600/65 px-1 py-1.5">
      <p className="font-display text-[8px] uppercase tracking-wider text-ink-200">
        {props.label}
      </p>
      <p className="mt-0.5 font-display text-sm text-brass-300">
        {props.value}
      </p>
    </div>
  );
}
