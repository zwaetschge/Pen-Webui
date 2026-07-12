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
import { isTtsExperienceEnabled, TtsProvider } from "./TtsProvider";
import { VoiceMenu } from "./VoiceMenu";
import { CompanionOverview } from "./CompanionOverview";
import type { GameRoomCharacter } from "./types";

const TacticalMap = dynamic(
  () => import("./TacticalMap").then((m) => m.TacticalMap),
  { ssr: false },
);

const TablePairingDialog = dynamic(
  () =>
    import("./TablePairingDialog").then((module) => module.TablePairingDialog),
  { ssr: false },
);

export function GameRoom(props: {
  campaignId: string;
  sessionId: string;
  inviteToken?: string;
  campaignTitle: string;
  campaignTheme: string;
  role: "host" | "player";
  localCharacters?: GameRoomCharacter[];
  experience: "table" | "companion";
}) {
  useGameStream({ sessionId: props.sessionId, inviteToken: props.inviteToken });

  const combat = useGame((s) => s.combat);
  const gameOver = useGame((s) => s.gameOver);
  const sessionEnded = useGame((s) => s.sessionEnded);
  const [forceTactical, setForceTactical] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [companionSceneOpen, setCompanionSceneOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const voiceMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pairingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const isTable = props.experience === "table";
  const ttsEnabled = isTtsExperienceEnabled(props.experience);
  const tactical = combat.active || forceTactical;
  const showStage = isTable || combat.active || companionSceneOpen;
  const primaryCharacter = props.localCharacters?.[0] ?? null;
  const roomHeight = isTable
    ? "fixed inset-0 z-[60] h-dvh"
    : props.inviteToken
      ? "h-[100svh] lg:h-dvh"
      : "h-[calc(100svh-64px)] sm:h-[calc(100svh-40px)] lg:h-[calc(100dvh-40px)]";

  async function enterDisplayMode() {
    const target = roomRef.current;
    const wakeLockNavigator = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<unknown> };
    };
    const requests: Promise<unknown>[] = [];
    if (target?.requestFullscreen && !document.fullscreenElement) {
      requests.push(target.requestFullscreen());
    }
    if (wakeLockNavigator.wakeLock) {
      requests.push(wakeLockNavigator.wakeLock.request("screen"));
    }
    await Promise.allSettled(requests);
  }

  return (
    <TtsProvider
      sessionId={props.sessionId}
      inviteToken={props.inviteToken}
      enabled={ttsEnabled}
    >
      <div
        ref={roomRef}
        className={cn("tabletop-room relative flex min-h-0 flex-col", roomHeight)}
      >
        <header
          className={cn(
            "tabletop-header shrink-0 border-b border-brass-700/45 backdrop-blur",
            isTable ? "px-5 py-3" : "px-3 py-2",
          )}
        >
          <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[10px] uppercase tracking-[0.26em] text-ink-100">
                {isTable ? "Plum Tabletop · Gemeinschaftstisch" : "Companion"}
              </p>
              <h1 className="truncate font-display text-base uppercase tracking-[0.18em] text-brass-300 sm:tracking-[0.24em]">
                {isTable
                  ? props.campaignTitle
                  : (primaryCharacter?.name ?? props.campaignTitle)}
              </h1>
              <p className="hidden truncate font-serif text-xs text-ink-200 sm:block">
                {props.campaignTheme}
              </p>
            </div>
            {isTable ? (
              <div className="flex items-center gap-2 xl:gap-3">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={pairingOpen}
                  ref={pairingTriggerRef}
                  onClick={() => setPairingOpen(true)}
                  className="min-h-10 rounded-md border border-brass-400/65 bg-brass-700/35 px-4 py-1.5 text-sm text-parchment-100 shadow-brass hover:bg-brass-600/45"
                >
                  Spieler verbinden
                </button>
                <button
                  type="button"
                  onClick={() => void enterDisplayMode()}
                  className="hidden min-h-10 rounded-md border border-brass-700/50 bg-ink-600/70 px-3 py-1.5 text-sm text-brass-300 hover:border-brass-400/70 lg:block"
                >
                  Vollbild
                </button>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={voiceMenuOpen}
                  ref={voiceMenuTriggerRef}
                  onClick={() => setVoiceMenuOpen((open) => !open)}
                  className={cn(
                    "hidden min-h-10 rounded-md border px-3 py-1.5 text-sm shadow-lg xl:block",
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
                    "min-h-10 rounded-md border px-3 py-1.5 text-sm shadow-lg",
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
                    onClick={() => setForceTactical((value) => !value)}
                    className="min-h-10 rounded-md border border-brass-700/50 bg-ink-600/70 px-3 py-1.5 text-sm text-brass-300 shadow-lg hover:border-brass-400/70"
                  >
                    {tactical ? "Szene" : "Karte"}
                  </button>
                ) : null}
                <ConnectionBadge />
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                {!combat.active ? (
                  <button
                    type="button"
                    aria-pressed={companionSceneOpen}
                    onClick={() => setCompanionSceneOpen((open) => !open)}
                    className="min-h-11 rounded-md border border-brass-700/50 bg-ink-600/70 px-3 py-2 text-xs text-brass-300"
                  >
                    {companionSceneOpen ? "Aktionen" : "Szene"}
                  </button>
                ) : null}
                <ConnectionBadge />
              </div>
            )}
          </div>
        </header>

        {isTable && voiceMenuOpen ? (
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

        {isTable ? (
          <TablePairingDialog
            open={pairingOpen}
            sessionId={props.sessionId}
            campaignTitle={props.campaignTitle}
            triggerRef={pairingTriggerRef}
            onClose={() => setPairingOpen(false)}
          />
        ) : null}

        <div
          className={cn(
            "tabletop-layout relative flex min-h-0 flex-1 flex-col overflow-hidden",
            isTable ? "p-2 lg:p-3" : "p-1.5 sm:p-2",
          )}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col gap-2">
            <div className="play-surface relative min-h-0 flex-1 overflow-hidden">
              {showStage ? (
                <section className="tabletop-stage relative h-full min-h-[200px] overflow-hidden sm:min-h-[240px]">
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
                      <CinematicView audioEnabled={ttsEnabled} />
                    )}
                  </div>
                </section>
              ) : (
                <CompanionOverview character={primaryCharacter} />
              )}

              {isTable && tableOpen ? (
                <button
                  type="button"
                  aria-label="Tischjournal schließen"
                  onClick={() => setTableOpen(false)}
                  className="drawer-scrim absolute inset-0 z-20 bg-ink-600/45 backdrop-blur-[1px] lg:bg-transparent lg:backdrop-blur-0"
                />
              ) : null}

              {isTable ? (
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
                      className="min-h-10 rounded-md border border-brass-700/45 bg-ink-600/70 px-3 py-1.5 text-xs text-brass-300 hover:border-brass-400/70"
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
              ) : null}

              {gameOver || sessionEnded ? <GameOverOverlay /> : null}
              <DiceRollOverlay />
            </div>

            {!isTable ? (
              <ActionBar
                sessionId={props.sessionId}
                inviteToken={props.inviteToken}
                role={props.role}
                localCharacters={props.localCharacters ?? []}
                selectedTokenId={selectedTokenId}
                onSelectedTokenChange={setSelectedTokenId}
              />
            ) : null}
          </div>
          <IntroDirector
            sessionId={props.sessionId}
            enabled={showStage && !tactical}
          />
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
