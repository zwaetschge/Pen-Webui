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
import { CastGlyph, CastGuideDialog } from "./CastGuideDialog";
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
  displayToken?: string;
  campaignTitle: string;
  campaignTheme: string;
  role: "host" | "player";
  localCharacters?: GameRoomCharacter[];
  experience: "table" | "companion" | "display";
}) {
  useGameStream({
    sessionId: props.sessionId,
    inviteToken: props.inviteToken,
    displayToken: props.displayToken,
  });

  const combat = useGame((s) => s.combat);
  const gameOver = useGame((s) => s.gameOver);
  const sessionEnded = useGame((s) => s.sessionEnded);
  const [forceTactical, setForceTactical] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [castGuideOpen, setCastGuideOpen] = useState(false);
  const [castActive, setCastActive] = useState(false);
  const [companionSceneOpen, setCompanionSceneOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const voiceMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pairingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const castTriggerRef = useRef<HTMLButtonElement | null>(null);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const isTable = props.experience === "table";
  const isDisplay = props.experience === "display";
  const isSharedScreen = isTable || isDisplay;
  const ttsEnabled =
    isTtsExperienceEnabled(props.experience) && !(isTable && castActive);
  const tactical = combat.active || forceTactical;
  const showStage = isSharedScreen || combat.active || companionSceneOpen;
  const primaryCharacter = props.localCharacters?.[0] ?? null;
  const roomHeight = isSharedScreen
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
      displayToken={props.displayToken}
      enabled={ttsEnabled}
      defaultAutoplay={isDisplay}
    >
      <div
        ref={roomRef}
        className={cn(
          "tabletop-room relative flex min-h-0 flex-col",
          isDisplay && "display-room",
          roomHeight,
        )}
      >
        {isDisplay ? (
          <DisplayHud campaignTitle={props.campaignTitle} />
        ) : (
          <header
            className={cn(
              "tabletop-header shrink-0 border-b border-brass-700/45 backdrop-blur",
              isTable ? "px-4 py-3 lg:px-6" : "px-3 py-2",
            )}
          >
            {isTable ? (
              <div className="mx-auto grid w-full max-w-[1760px] gap-3 xl:grid-cols-[minmax(16rem,1fr)_auto] xl:items-end">
                <div className="flex min-w-0 items-center justify-between gap-4 xl:block">
                  <div className="min-w-0">
                    <p className="font-display text-[10px] uppercase tracking-[0.3em] text-brass-400">
                      Host-Konsole · Session live
                    </p>
                    <h1 className="truncate font-display text-xl uppercase tracking-[0.12em] text-parchment-100 sm:text-2xl">
                      {props.campaignTitle}
                    </h1>
                    <p className="hidden truncate font-serif text-xs text-ink-200 sm:block">
                      {props.campaignTheme}
                    </p>
                  </div>
                  <div className="xl:mt-2 xl:w-fit">
                    <ConnectionBadge />
                  </div>
                </div>

                <nav
                  aria-label="Host-Konsole"
                  className="console-command-rail flex min-w-0 items-stretch gap-2 overflow-x-auto pb-1 xl:justify-end"
                >
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={castGuideOpen}
                    ref={castTriggerRef}
                    onClick={() => setCastGuideOpen(true)}
                    className={cn(
                      "console-command console-command-primary group",
                      castActive && "console-command-active",
                    )}
                  >
                    <CastGlyph className="size-6 shrink-0" />
                    <span className="text-left">
                      <strong>TV-Ausgabe</strong>
                      <small>
                        {castActive ? "Wohnzimmer aktiv" : "Verbinden"}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={pairingOpen}
                    ref={pairingTriggerRef}
                    onClick={() => setPairingOpen(true)}
                    className="console-command console-command-primary group"
                  >
                    <PlayersGlyph className="size-6 shrink-0" />
                    <span className="text-left">
                      <strong>Spieler</strong>
                      <small>QR-Lobby öffnen</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTableOpen((open) => !open)}
                    className={cn(
                      "console-command group",
                      tableOpen && "console-command-active",
                    )}
                  >
                    <JournalGlyph className="size-5 shrink-0" />
                    <span className="text-left">
                      <strong>Journal</strong>
                      <small>{tableOpen ? "Geöffnet" : "Verlauf & Lage"}</small>
                    </span>
                  </button>
                  {!combat.active ? (
                    <button
                      type="button"
                      onClick={() => setForceTactical((value) => !value)}
                      className={cn(
                        "console-command console-command-compact group",
                        forceTactical && "console-command-active",
                      )}
                    >
                      <ViewGlyph className="size-5" />
                      <span>{tactical ? "Szene" : "Karte"}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={voiceMenuOpen}
                    ref={voiceMenuTriggerRef}
                    onClick={() => setVoiceMenuOpen((open) => !open)}
                    className={cn(
                      "console-command console-command-compact group",
                      voiceMenuOpen && "console-command-active",
                    )}
                  >
                    <VoiceGlyph className="size-5" />
                    <span>Stimmen</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void enterDisplayMode()}
                    className="console-command console-command-compact group"
                  >
                    <FullscreenGlyph className="size-5" />
                    <span>Vollbild</span>
                  </button>
                </nav>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[9px] uppercase tracking-[0.28em] text-brass-400">
                    Persönlicher Controller
                  </p>
                  <h1 className="truncate font-display text-lg uppercase tracking-[0.12em] text-parchment-100">
                    {primaryCharacter?.name ?? props.campaignTitle}
                  </h1>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!combat.active ? (
                    <button
                      type="button"
                      aria-pressed={companionSceneOpen}
                      onClick={() => setCompanionSceneOpen((open) => !open)}
                      className="min-h-11 rounded-md border border-brass-700/50 bg-ink-600/70 px-3 py-2 text-xs text-brass-300"
                    >
                      {companionSceneOpen ? "Controller" : "TV-Szene"}
                    </button>
                  ) : null}
                  <ConnectionBadge />
                </div>
              </div>
            )}
          </header>
        )}

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
          <>
            <CastGuideDialog
              open={castGuideOpen}
              sessionId={props.sessionId}
              triggerRef={castTriggerRef}
              onClose={() => setCastGuideOpen(false)}
              onEnterDisplayMode={enterDisplayMode}
              onCastingChange={setCastActive}
            />
            <TablePairingDialog
              open={pairingOpen}
              sessionId={props.sessionId}
              campaignTitle={props.campaignTitle}
              triggerRef={pairingTriggerRef}
              onClose={() => setPairingOpen(false)}
            />
          </>
        ) : null}

        <div
          className={cn(
            "tabletop-layout relative flex min-h-0 flex-1 flex-col overflow-hidden",
            isDisplay ? "p-0" : isTable ? "p-2 lg:p-3" : "p-1.5 sm:p-2",
          )}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-[1760px] flex-1 flex-col gap-2">
            <div className="play-surface relative min-h-0 flex-1 overflow-hidden">
              {showStage ? (
                <section
                  className={cn(
                    "tabletop-stage relative h-full min-h-[200px] overflow-hidden sm:min-h-[240px]",
                    isDisplay && "display-stage",
                  )}
                >
                  <div className="tabletop-stage-surface h-full overflow-hidden">
                    {tactical ? (
                      <TacticalMap
                        sessionId={props.sessionId}
                        inviteToken={props.inviteToken}
                        role={props.role}
                        localCharacters={props.localCharacters ?? []}
                        readOnly={isDisplay}
                        selectedTokenId={selectedTokenId}
                        onSelectedTokenChange={setSelectedTokenId}
                      />
                    ) : (
                      <CinematicView
                        audioEnabled={ttsEnabled}
                        displayMode={isDisplay}
                      />
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
                    "tabletop-side table-drawer bg-ink-500/88 absolute bottom-3 right-3 top-3 z-30 flex min-h-0 w-[min(28rem,calc(100%-1.5rem))] flex-col overflow-hidden border border-brass-700/45 transition duration-200",
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

            {!isSharedScreen ? (
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
            displayMode={isDisplay}
          />
        </div>
      </div>
    </TtsProvider>
  );
}

function DisplayHud({ campaignTitle }: { campaignTitle: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-[4vw] pt-[3vh]">
      <div className="bg-ink-600/52 min-w-0 rounded-md border border-brass-700/30 px-4 py-2 shadow-2xl backdrop-blur-sm">
        <p className="font-display text-[10px] uppercase tracking-[0.3em] text-brass-400">
          Plum Tabletop
        </p>
        <p className="max-w-[52vw] truncate font-display text-lg uppercase tracking-[0.14em] text-parchment-100">
          {campaignTitle}
        </p>
      </div>
      <ConnectionBadge />
    </div>
  );
}

function PlayersGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="8" r="3" />
      <path d="M3.8 18.5c.6-3 2.3-4.5 5.2-4.5s4.6 1.5 5.2 4.5" />
      <path d="M15 5.5a3 3 0 0 1 0 5.6M16.2 14c2.2.4 3.5 1.9 4 4.5" />
    </svg>
  );
}

function JournalGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 4.5h11a3 3 0 0 1 3 3v12h-11a3 3 0 0 1-3-3z" />
      <path d="M7.5 4.5v12a3 3 0 0 0 3 3M10 8h5M10 11.5h5" />
    </svg>
  );
}

function ViewGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20z" />
      <path d="M8.5 4v13.5M15.5 6.5V20" />
    </svg>
  );
}

function VoiceGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="8.5" y="3" width="7" height="11" rx="3.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </svg>
  );
}

function FullscreenGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 4H4v4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" />
    </svg>
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
