"use client";

import { useEffect, useRef } from "react";
import { useGame, type ChatLine, type SceneState } from "@/lib/game/store";
import { speakerForNarration } from "@/lib/game/dialogue-presentation";
import { cn } from "@/lib/cn";
import { AudioLineButton } from "./AudioLineButton";

export function ChatLog() {
  const chat = useGame((s) => s.chat);
  const scene = useGame((s) => s.scene);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  return (
    <div
      ref={ref}
      className="conversation-scroll h-full min-h-0 overflow-y-auto px-3 py-4 font-serif text-base leading-relaxed text-ink-50 sm:px-4"
    >
      {chat.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center text-ink-200">
          <p className="max-w-xs">
            Der Tisch wartet. Beschreibe, was deine Figur tut.
          </p>
        </div>
      ) : (
        <ul className="space-y-3.5">
          {chat.map((line) => (
            <li key={line.id}>
              <LineView line={line} scene={scene} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineView({
  line,
  scene,
}: {
  line: ChatLine;
  scene: SceneState;
}) {
  switch (line.kind) {
    case "narrate": {
      const speaker = speakerForNarration(line, scene);
      return (
        <div
          className={cn(
            "renpy-log-entry relative border border-brass-700/35 bg-ink-600/55 px-4 pb-3 pt-5 shadow-lg",
            line.speakerNpcId
              ? "border-brass-400/45"
              : "border-ink-200/20 bg-ink-600/35",
          )}
        >
          <div className="renpy-log-nameplate absolute -top-2 left-3 right-3 flex items-center gap-1.5 px-2.5 py-0.5">
            <AudioLineButton eventId={line.id} compact />
            <span className="min-w-0 truncate font-display text-[10px] uppercase tracking-[0.22em] text-parchment-50">
              {speaker.label}
            </span>
            {speaker.mood ? (
              <span className="min-w-0 truncate font-serif text-[11px] italic text-brass-300">
                {speaker.mood}
              </span>
            ) : null}
          </div>
          <p
            className={cn(
              "text-parchment-100",
              !line.speakerNpcId && "italic text-ink-50",
            )}
          >
            {line.text}
          </p>
        </div>
      );
    }
    case "player":
      return (
        <div className="renpy-log-entry renpy-log-entry-player relative ml-4 border border-arcane-500/35 bg-arcane-600/15 px-4 pb-3 pt-5 shadow-lg">
          <div className="renpy-log-nameplate absolute -top-2 left-3 right-3 flex items-center gap-1.5 px-2.5 py-0.5">
            <AudioLineButton eventId={line.id} compact />
            <span className="min-w-0 truncate font-display text-[10px] uppercase tracking-[0.22em] text-arcane-400">
              {line.displayName}
            </span>
          </div>
          <p className="text-ink-50">{line.text}</p>
        </div>
      );
    case "roll":
      return (
        <div className="dice-card flex items-center justify-between gap-3 border border-brass-700/45 bg-ink-600/60 px-4 py-2 text-sm shadow-lg">
          <span className="text-ink-100">
            <span className="font-display text-brass-400">
              {line.displayName ?? (line.actor === "dm" ? "DM" : "Spieler")}
            </span>{" "}
            würfelt <code className="text-parchment-200">{line.notation}</code>
            {line.reason ? (
              <span className="ml-2 italic text-ink-200">({line.reason})</span>
            ) : null}
          </span>
          <span
            className={cn(
              "dice-total border px-2 py-0.5 font-display text-base",
              line.total >= 20
                ? "border-brass-400/60 bg-brass-700/40 text-parchment-50"
                : line.total <= 1
                  ? "border-blood-500/60 bg-blood-600/20 text-blood-500"
                  : "border-brass-700/40 bg-ink-500/60 text-parchment-200",
            )}
            title={line.breakdown}
          >
            {line.total}
          </span>
        </div>
      );
    case "skill_check_request":
      return (
        <div className="table-note border border-arcane-500/50 bg-arcane-600/15 px-4 py-3 text-base shadow-lg">
          <p className="font-display text-xs uppercase tracking-wider text-arcane-400">
            Probe gefordert
          </p>
          <p className="text-parchment-100">
            <strong>{line.skill}</strong> SG {line.dc}
            {line.reason ? (
              <span className="ml-2 italic text-ink-100">— {line.reason}</span>
            ) : null}
          </p>
        </div>
      );
    case "system":
      return (
        <div
          className={cn(
            "table-note px-4 py-2 text-sm uppercase tracking-wider shadow-lg",
            line.tone === "warn"
              ? "border border-brass-400/40 bg-brass-700/20 text-brass-300"
              : line.tone === "danger"
                ? "border border-blood-500/50 bg-blood-600/20 text-blood-500"
                : "border border-ink-200/40 bg-ink-500/40 text-ink-100",
          )}
        >
          {line.text}
        </div>
      );
  }
}
