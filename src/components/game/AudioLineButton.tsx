"use client";

import { cn } from "@/lib/cn";
import { useTtsPlayback } from "./TtsProvider";

export function AudioLineButton(props: {
  eventId: string;
  className?: string;
  compact?: boolean;
}) {
  const tts = useTtsPlayback();
  const status = tts.statusByEventId[props.eventId] ?? "idle";
  const active = tts.activeEventId === props.eventId;
  const label =
    active && status === "playing"
      ? "Vorlesen stoppen"
      : status === "loading"
        ? "Audio wird geladen"
        : status === "error"
          ? "Audio erneut versuchen"
          : "Vorlesen";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active && status === "playing"}
      title={label}
      disabled={status === "loading"}
      onClick={() => void tts.toggle(props.eventId)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border shadow-sm transition",
        props.compact ? "h-6 w-6" : "h-7 w-7",
        "border-brass-700/45 bg-ink-600/80 text-brass-300 hover:border-brass-400/70 hover:text-parchment-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass-400/35",
        "disabled:cursor-wait disabled:opacity-70",
        status === "error" &&
          "border-blood-500/60 text-blood-500 hover:border-blood-400/70 hover:text-blood-300",
        props.className,
      )}
    >
      {status === "loading" ? (
        <span aria-hidden="true" className="text-[10px] leading-none">
          ...
        </span>
      ) : active && status === "playing" ? (
        <StopIcon compact={props.compact} />
      ) : (
        <PlayIcon compact={props.compact} />
      )}
    </button>
  );
}

function PlayIcon({ compact }: { compact?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")}
    >
      <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon({ compact }: { compact?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")}
    >
      <rect x="4" y="4" width="8" height="8" fill="currentColor" />
    </svg>
  );
}
