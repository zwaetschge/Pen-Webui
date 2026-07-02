"use client";

import { useGame } from "@/lib/game/store";
import { isActiveTurnForToken } from "@/lib/game/combat-turn";
import { cn } from "@/lib/cn";

export function InitiativeTracker() {
  const combat = useGame((s) => s.combat);
  const tokens = useGame((s) => s.tokens);
  if (!combat.active || !combat.initiative) return null;

  return (
    <div className="gm-screen border-b border-brass-700/45 bg-ink-600/50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-display text-[11px] uppercase tracking-[0.3em] text-brass-400">
          Initiative · Runde {combat.round ?? 1}
        </p>
        <span className="font-display text-xs text-ink-200">
          {combat.name}
        </span>
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {combat.initiative.map((p, i) => {
          const token = Object.values(tokens).find((candidate) =>
            isActiveTurnForToken({
              initiative: combat.initiative,
              turnIndex: i,
              token: candidate,
            }),
          );
          const hp = token ? Math.max(0, Math.floor(token.hp ?? 0)) : null;
          const maxHp = token ? Math.max(0, Math.floor(token.maxHp ?? 0)) : null;
          const defeated = hp !== null && hp <= 0;
          return (
            <li
              key={`${p.name}-${i}`}
              className={cn(
                "table-chip border px-2.5 py-1 text-sm",
                i === (combat.turnIndex ?? 0)
                  ? "border-brass-400/70 bg-brass-700/40 text-parchment-100"
                  : "border-brass-700/30 bg-ink-500/40 text-ink-100",
                defeated && "opacity-45",
              )}
            >
              <span className="text-xs text-ink-200">{p.roll}</span> {p.name}
              {hp !== null && maxHp !== null ? (
                <span className="ml-1 text-xs text-ink-200">
                  {hp}/{maxHp}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
