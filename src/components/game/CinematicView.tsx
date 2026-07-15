"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGame } from "@/lib/game/store";
import { latestDialoguePresentation } from "@/lib/game/dialogue-presentation";
import { cn } from "@/lib/cn";
import { AudioLineButton } from "./AudioLineButton";
import { useTtsPlayback } from "./TtsProvider";

export function CinematicView({
  audioEnabled = true,
  displayMode = false,
}: {
  audioEnabled?: boolean;
  displayMode?: boolean;
}) {
  const scene = useGame((s) => s.scene);
  const chat = useGame((s) => s.chat);
  const dialogue = latestDialoguePresentation(chat, scene);
  const dialogueId = dialogue?.id ?? null;
  const dialogueKind = dialogue?.kind ?? null;
  const lastAutoplayDialogueIdRef = useRef<string | null>(null);
  const { autoplay, play, setAutoplay } = useTtsPlayback();
  const audioControls = showCinematicAudioControls(audioEnabled, displayMode);
  const portraitUrl =
    dialogue?.portraitUrl ??
    (dialogue?.kind === "npc" ? scene.activeNpc?.portraitUrl : null);
  const portraitName =
    dialogue?.speakerLabel ??
    scene.activeNpc?.name ??
    scene.locationName ??
    "Szene";

  useEffect(() => {
    if (!dialogueId) {
      lastAutoplayDialogueIdRef.current = null;
      return;
    }

    const isNewDialogue = lastAutoplayDialogueIdRef.current !== dialogueId;
    lastAutoplayDialogueIdRef.current = dialogueId;

    if (
      !audioEnabled ||
      !isNewDialogue ||
      !autoplay ||
      dialogueKind === "player"
    ) {
      return;
    }

    void play(dialogueId);
  }, [audioEnabled, autoplay, dialogueId, dialogueKind, play]);

  return (
    <div
      className={cn(
        "scene-stage relative h-full w-full overflow-hidden bg-ink-600",
        displayMode && "scene-stage-display",
      )}
    >
      <AnimatePresence>
        {scene.backgroundUrl ? (
          <motion.div
            key={scene.backgroundUrl}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${scene.backgroundUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : (
          <div className={cinematicFallbackClassName(displayMode)} />
        )}
      </AnimatePresence>

      <div className="absolute inset-0 bg-gradient-to-t from-ink-600 via-ink-600/40 to-transparent" />
      <div className="cinematic-grain absolute inset-0" />
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-ink-600/70 to-transparent" />

      {scene.locationName ? (
        <div className={cinematicLocationClassName(displayMode)}>
          <p className="font-display text-[10px] uppercase tracking-[0.34em] text-brass-300/80">
            Ort
          </p>
          <h2 className="mt-1 font-display text-2xl leading-none text-parchment-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] sm:text-3xl">
            {scene.locationName}
          </h2>
        </div>
      ) : null}

      <AnimatePresence>
        {portraitUrl ? (
          <motion.div
            key={`${dialogue?.id ?? "scene"}-${portraitUrl}`}
            initial={{
              opacity: 0,
              x: dialogue?.kind === "player" ? -54 : 54,
              scale: 0.98,
            }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{
              opacity: 0,
              x: dialogue?.kind === "player" ? -54 : 54,
              scale: 0.98,
            }}
            transition={{ duration: 0.38 }}
            className={cn(
              "pointer-events-none absolute bottom-[8.5rem] z-10 w-40 max-w-[38%] sm:bottom-[7.5rem] sm:w-64 lg:bottom-[8rem] lg:w-72",
              dialogue?.kind === "player"
                ? "left-3 sm:left-8"
                : "right-3 sm:right-8",
            )}
          >
            <div className="portrait-standee aspect-[3/4] overflow-hidden rounded-t-md border-x border-t border-brass-400/45 shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={portraitUrl}
                alt={portraitName}
                className="h-full w-full object-cover"
              />
            </div>
            <p className="portrait-nameplate mx-auto mt-1 w-fit max-w-full truncate px-3 py-1 text-center font-display text-xs uppercase tracking-[0.18em] text-parchment-100 sm:text-sm">
              {portraitName}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {dialogue ? (
          <motion.div
            key={dialogue.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32 }}
            className="absolute inset-x-3 bottom-3 top-3 z-20 flex items-end sm:inset-x-6 sm:bottom-5 sm:top-5"
          >
            <div className={cinematicDialogueBoxClassName(displayMode)}>
              <div className="renpy-nameplate absolute -top-3 left-4 right-4 flex items-center gap-2 px-2 py-1.5 sm:left-6 sm:right-6">
                {audioControls ? (
                  <AudioLineButton eventId={dialogue.id} compact />
                ) : null}
                <div className="flex min-w-0 items-baseline gap-2 overflow-hidden">
                  <span className="truncate font-display text-xs uppercase tracking-[0.22em] text-parchment-50">
                    {dialogue.speakerLabel}
                  </span>
                  {dialogue.mood ? (
                    <span className="truncate font-serif text-xs italic text-brass-300">
                      {dialogue.mood}
                    </span>
                  ) : null}
                </div>
                {audioControls && dialogue.kind !== "player" ? (
                  <button
                    type="button"
                    aria-pressed={autoplay}
                    aria-label={
                      autoplay ? "Autoplay aktiviert" : "Autoplay deaktiviert"
                    }
                    title={
                      autoplay ? "Autoplay aktiviert" : "Autoplay deaktiviert"
                    }
                    onClick={() => setAutoplay(!autoplay)}
                    className={cn(
                      "ml-auto shrink-0 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                      autoplay
                        ? "border-brass-400/70 bg-brass-700/35 text-parchment-100"
                        : "border-brass-700/45 bg-ink-600/80 text-brass-300",
                    )}
                  >
                    Auto
                  </button>
                ) : null}
              </div>
              <p
                className={cinematicDialogueTextClassName(
                  displayMode,
                  dialogue.kind,
                )}
              >
                {dialogue.text}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function showCinematicAudioControls(
  audioEnabled: boolean,
  displayMode: boolean,
) {
  return audioEnabled && !displayMode;
}

export function cinematicLocationClassName(displayMode: boolean) {
  return cn(
    "scene-location-card absolute",
    displayMode
      ? "display-location-card"
      : "left-4 top-4 max-w-[calc(100%-2rem)] sm:left-6 sm:top-6 sm:max-w-md",
  );
}

export function cinematicFallbackClassName(displayMode: boolean) {
  return cn(
    "scene-felt absolute inset-0 bg-gradient-to-b from-ink-500 via-ink-600 to-ink-500",
    displayMode && "display-scene-fallback",
  );
}

export function cinematicDialogueBoxClassName(displayMode: boolean) {
  return cn(
    "renpy-dialogue-box mx-auto max-h-full overflow-y-auto shadow-2xl backdrop-blur lg:max-h-[42vh]",
    displayMode
      ? "display-dialogue-box"
      : "max-w-[82rem] px-4 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6",
  );
}

export function cinematicDialogueTextClassName(
  displayMode: boolean,
  dialogueKind?: string,
) {
  return cn(
    "font-serif text-parchment-100",
    displayMode
      ? "display-dialogue-text"
      : "text-lg leading-relaxed sm:text-xl",
    dialogueKind === "narrator" && "italic text-ink-50",
  );
}
