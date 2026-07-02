"use client";

import { useGame } from "@/lib/game/store";
import { cn } from "@/lib/cn";

export function ConnectionBadge() {
  const connected = useGame((s) => s.connected);
  const error = useGame((s) => s.error);
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
        connected
          ? "border-brass-400/60 bg-brass-700/30 text-brass-300"
          : "border-blood-500/60 bg-blood-600/20 text-blood-500",
      )}
      title={error ?? undefined}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          connected ? "bg-brass-300" : "animate-pulse bg-blood-500",
        )}
      />
      {connected ? "online" : "offline"}
    </span>
  );
}
