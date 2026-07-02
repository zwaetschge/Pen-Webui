"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { useGameStream } from "@/lib/game/useGameStream";
import { useGame } from "@/lib/game/store";
import { cn } from "@/lib/cn";
import { CinematicView } from "./CinematicView";
import { ChatLog } from "./ChatLog";
import { ActionBar } from "./ActionBar";
import { InitiativeTracker } from "./InitiativeTracker";
import { ConnectionBadge } from "./ConnectionBadge";
import { SceneBrief } from "./SceneBrief";
import { IntroDirector } from "./IntroDirector";
import { DiceRollOverlay } from "./DiceRollOverlay";
import { TtsProvider } from "./TtsProvider";
import { VoiceMenu } from "./VoiceMenu";

const TacticalMap = dynamic(
  () => import("./TacticalMap").then((m) => m.TacticalMap),
  { ssr: false },
);

export function GameRoom(props: {
  campaignId: string;
  sessionId: string;
  inviteToken?: string;
  campaignTitle: string;
  campaignTheme: string;
  role: "host" | "player";
  localCharacters?: Array<{ id: string; name: string }>;
}) {
  useGameStream({ sessionId: props.sessionId, inviteToken: props.inviteToken });

  const combat = useGame((s) => s.combat);
  const gameOver = useGame((s) => s.gameOver);
  const sessionEnded = useGame((s) => s.sessionEnded);
  const [forceTactical, setForceTactical] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const voiceMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const tactical = combat.active || forceTactical;
  const roomHeight = props.inviteToken
    ? "h-[100svh] lg:h-dvh"
    : "h-[calc(100svh-64px)] sm:h-[calc(100svh-40px)] lg:h-[calc(100dvh-40px)]";

  return (
    <TtsProvider sessionId={props.sessionId} inviteToken={props.inviteToken}>
      <div
        className={cn("tabletop-room relative flex min-h-0 flex-col", roomHeight)}
      >
        <header className="tabletop-header shrink-0 border-b border-brass-700/45 px-5 py-3 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-3">
            <div>
              <p className="font-display text-[10px] uppercase tracking-[0.26em] text-ink-100">
                Plum Tabletop
              </p>
              <h1 className="font-display text-base uppercase tracking-[0.24em] text-brass-300">
                {props.campaignTitle}
              </h1>
              <p className="font-serif text-xs text-ink-200">
                {props.campaignTheme}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={voiceMenuOpen}
                ref={voiceMenuTriggerRef}
                onClick={() => setVoiceMenuOpen((open) => !open)}
                className={cn(
                  "rounded-md border px-4 py-1.5 text-sm shadow-lg",
                  voiceMenuOpen
                    ? "border-brass-400/70 bg-brass-700/35 text-parchment-100"
                    : "border-brass-700/50 bg-ink-600/70 text-brass-300 hover:border-brass-400/70",
                )}
              >
                Stimmen
              </button>
              <button
                type="button"
                onClick={() => setTableOpen((open) => !open)}
                className={cn(
                  "rounded-md border px-4 py-1.5 text-sm shadow-lg",
                  tableOpen
                    ? "border-brass-400/70 bg-brass-700/35 text-parchment-100"
                    : "border-brass-700/50 bg-ink-600/70 text-brass-300 hover:border-brass-400/70",
                )}
              >
                {tableOpen ? "Tisch" : "Journal"}
              </button>
              {!combat.active ? (
                <button
                  type="button"
                  onClick={() => setForceTactical((v) => !v)}
                  className="rounded-md border border-brass-700/50 bg-ink-600/70 px-4 py-1.5 text-sm text-brass-300 shadow-lg hover:border-brass-400/70"
                >
                  {tactical ? "Szene" : "Karte"}
                </button>
              ) : null}
              <ConnectionBadge />
            </div>
          </div>
        </header>

        {voiceMenuOpen ? (
          <VoiceMenu
            campaignId={props.campaignId}
            sessionId={props.sessionId}
            inviteToken={props.inviteToken}
            role={props.role}
            localCharacters={props.localCharacters ?? []}
            triggerRef={voiceMenuTriggerRef}
            onClose={() => setVoiceMenuOpen(false)}
          />
        ) : null}

        <div className="tabletop-layout relative flex min-h-0 flex-1 flex-col overflow-hidden p-2 lg:p-3">
          <div className="mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col gap-2">
            <div className="play-surface relative min-h-0 flex-1 overflow-hidden">
              <section className="tabletop-stage relative h-full min-h-[240px] overflow-hidden">
                <div className="tabletop-stage-surface h-full overflow-hidden">
                  {tactical ? (
                    <TacticalMap
                      sessionId={props.sessionId}
                      inviteToken={props.inviteToken}
                      role={props.role}
                      localCharacters={props.localCharacters ?? []}
                      selectedTokenId={selectedTokenId}
                      onSelectedTokenChange={setSelectedTokenId}
                    />
                  ) : (
                    <CinematicView />
                  )}
                </div>
              </section>

              {tableOpen ? (
                <button
                  type="button"
                  aria-label="Tischjournal schließen"
                  onClick={() => setTableOpen(false)}
                  className="drawer-scrim absolute inset-0 z-20 bg-ink-600/45 backdrop-blur-[1px] lg:bg-transparent lg:backdrop-blur-0"
                />
              ) : null}

              <aside
                aria-hidden={!tableOpen}
                className={cn(
                  "tabletop-side table-drawer absolute bottom-3 right-3 top-3 z-30 flex w-[min(28rem,calc(100%-1.5rem))] min-h-0 flex-col overflow-hidden border border-brass-700/45 bg-ink-500/88 transition duration-200",
                  tableOpen
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none translate-x-[calc(100%+1rem)] opacity-0",
                )}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-brass-700/45 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-display text-[10px] uppercase tracking-[0.24em] text-brass-400">
                      Tischjournal
                    </p>
                    <p className="truncate text-sm text-ink-100">
                      Lage, Verlauf und Würfe
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTableOpen(false)}
                    className="rounded-md border border-brass-700/45 bg-ink-600/70 px-3 py-1.5 text-xs text-brass-300 hover:border-brass-400/70"
                  >
                    Schließen
                  </button>
                </div>
                {combat.active ? <InitiativeTracker /> : null}
                {combat.active ? null : <SceneBrief />}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ChatLog />
                </div>
              </aside>

              {gameOver || sessionEnded ? <GameOverOverlay /> : null}
              <DiceRollOverlay />
            </div>

            <ActionBar
              sessionId={props.sessionId}
              inviteToken={props.inviteToken}
              role={props.role}
              localCharacters={props.localCharacters ?? []}
              selectedTokenId={selectedTokenId}
              onSelectedTokenChange={setSelectedTokenId}
            />
          </div>
          <IntroDirector sessionId={props.sessionId} enabled={!tactical} />
        </div>
      </div>
    </TtsProvider>
  );
}

function GameOverOverlay() {
  const gameOver = useGame((s) => s.gameOver);
  const summary =
    gameOver?.summary ??
    (gameOver?.outcome === "victory"
      ? "Die Session ist beendet."
      : "Die Gruppe wurde besiegt.");
  const defeatedNames = gameOver?.defeatedNames ?? [];

  return (
    <div className="bg-ink-600/86 absolute inset-0 z-30 flex items-center justify-center px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-md border border-blood-500/55 bg-ink-500/95 p-6 text-center shadow-2xl">
        <p className="font-display text-[11px] uppercase tracking-[0.32em] text-blood-500">
          Session beendet
        </p>
        <h2 className="mt-2 font-display text-4xl uppercase tracking-[0.08em] text-parchment-100 sm:text-5xl">
          {gameOver?.title ?? "Game Over"}
        </h2>
        <p className="mx-auto mt-4 max-w-md font-serif text-base leading-relaxed text-ink-100">
          {summary}
        </p>
        {defeatedNames.length > 0 ? (
          <div className="mt-5 border-t border-brass-700/30 pt-4">
            <p className="font-display text-[10px] uppercase tracking-[0.22em] text-brass-400">
              Gefallene Figuren
            </p>
            <p className="mt-1 text-sm text-parchment-100">
              {defeatedNames.join(", ")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
