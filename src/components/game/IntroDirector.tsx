"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  buildIntroDirectorChapters,
  introDirectorStorageKey,
  type IntroDirectorChapter,
} from "@/lib/game/intro-director";
import { useGame } from "@/lib/game/store";

const CHAPTER_DURATION_MS = 5400;
const CHARACTER_DURATION_MS = 6200;

export function IntroDirector({
  sessionId,
  enabled,
}: {
  sessionId: string;
  enabled: boolean;
}) {
  const scene = useGame((s) => s.scene);
  const intro = scene.introSequence;
  const reducedMotion = usePrefersReducedMotion();
  const chapters = useMemo(
    () =>
      intro
        ? buildIntroDirectorChapters({
            intro,
            scene: {
              sceneTitle: scene.sceneTitle,
              locationName: scene.locationName,
            },
          })
        : [],
    [intro, scene.locationName, scene.sceneTitle],
  );
  const storageKey = useMemo(
    () => (intro ? introDirectorStorageKey(sessionId, intro) : null),
    [intro, sessionId],
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [played, setPlayed] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      setActiveKey(null);
      return;
    }
    if (!storageKey || chapters.length === 0) {
      setActiveKey(null);
      setVisible(false);
      setPlayed(false);
      setChapterIndex(0);
      return;
    }
    if (activeKey === storageKey) return;

    const wasPlayed = readSessionFlag(storageKey);
    setActiveKey(storageKey);
    setPlayed(wasPlayed);
    setVisible(!wasPlayed);
    setChapterIndex(0);
  }, [activeKey, chapters.length, enabled, storageKey]);

  useEffect(() => {
    if (!visible || reducedMotion || chapters.length === 0) return;
    const chapter = chapters[chapterIndex];
    const timeout = window.setTimeout(
      () => {
        if (chapterIndex < chapters.length - 1) {
          setChapterIndex((index) => index + 1);
          return;
        }
        markPlayed(storageKey);
        setPlayed(true);
        setVisible(false);
      },
      chapter?.kind === "character"
        ? CHARACTER_DURATION_MS
        : CHAPTER_DURATION_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [chapterIndex, chapters, reducedMotion, storageKey, visible]);

  if (!enabled || !intro || chapters.length === 0) return null;

  const chapter = chapters[Math.min(chapterIndex, chapters.length - 1)];

  function close() {
    markPlayed(storageKey);
    setPlayed(true);
    setVisible(false);
  }

  function replay() {
    setChapterIndex(0);
    setVisible(true);
  }

  function next() {
    if (chapterIndex < chapters.length - 1) {
      setChapterIndex((index) => index + 1);
      return;
    }
    close();
  }

  return (
    <AnimatePresence>
      {visible && chapter ? (
        <motion.div
          key="intro-director"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.45 }}
          className="absolute inset-0 z-20 overflow-hidden bg-ink-600 text-parchment-100"
        >
          <IntroBackdrop backgroundUrl={scene.backgroundUrl} />
          <div className="cinematic-grain absolute inset-0" />
          <div className="cinematic-sweep absolute inset-0" />
          <div className="absolute inset-x-0 top-0 h-8 bg-ink-600 sm:h-10" />
          <div className="absolute inset-x-0 bottom-0 h-8 bg-ink-600 sm:h-10" />

          <div className="relative z-10 mx-auto grid h-full w-full max-w-[96rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:px-10 lg:py-8">
            <header className="flex items-start justify-between gap-4 pt-7 sm:pt-8">
              <div className="min-w-0">
                <p className="font-display text-[10px] uppercase tracking-[0.32em] text-brass-300">
                  Prolog
                </p>
                <h2 className="mt-1 break-words font-display text-2xl uppercase leading-none text-parchment-50 sm:text-4xl lg:text-5xl">
                  {intro.title ?? scene.sceneTitle ?? "Auftakt"}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-md border border-brass-400/35 bg-ink-600/60 px-3 py-2 font-display text-[10px] uppercase tracking-[0.2em] text-brass-300 shadow-brass backdrop-blur hover:border-brass-300/70 focus:outline-none focus:ring-2 focus:ring-brass-300/50"
              >
                Überspringen
              </button>
            </header>

            <main
              aria-live="polite"
              className="grid min-h-0 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
            >
              <motion.div
                key={chapter.id}
                initial={
                  reducedMotion ? false : { opacity: 0, y: 22, scale: 0.985 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: reducedMotion ? 0 : 0.55 }}
                className="min-w-0"
              >
                <p
                  className={cn(
                    "font-display text-[11px] uppercase tracking-[0.3em]",
                    chapter.accent === "blood"
                      ? "text-blood-500"
                      : chapter.accent === "arcane"
                        ? "text-arcane-400"
                        : "text-brass-300",
                  )}
                >
                  {chapter.label}
                </p>
                <h3 className="mt-2 max-w-[18ch] break-words font-display text-4xl uppercase leading-[0.95] text-parchment-50 drop-shadow-[0_3px_12px_rgba(0,0,0,0.65)] sm:text-5xl xl:text-6xl">
                  {chapter.title}
                </h3>
                <div className="mt-4 max-h-[28dvh] max-w-3xl overflow-y-auto border-l-2 border-brass-400/55 bg-ink-600/45 px-4 py-3 shadow-2xl backdrop-blur-sm sm:mt-5 sm:px-5 lg:max-h-[42dvh]">
                  {paragraphs(chapter.body).map((paragraph) => (
                    <p
                      key={paragraph}
                      className="font-serif text-lg leading-relaxed text-parchment-100 sm:text-xl"
                    >
                      {paragraph}
                    </p>
                  ))}
                  {chapter.meta ? (
                    <p className="mt-3 font-display text-[10px] uppercase tracking-[0.22em] text-ink-100">
                      {chapter.meta}
                    </p>
                  ) : null}
                </div>
              </motion.div>

              <ChapterSpotlight chapter={chapter} />
            </main>

            <footer className="grid gap-3 pb-7 sm:pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <ChapterRail
                chapters={chapters}
                currentIndex={chapterIndex}
                onSelect={setChapterIndex}
              />
              <div className="flex items-center justify-between gap-2 lg:justify-end">
                <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-100">
                  {chapterIndex + 1}/{chapters.length}
                </p>
                <button
                  type="button"
                  onClick={next}
                  className="rounded-md border border-brass-400/50 bg-brass-700/35 px-4 py-2 font-display text-xs uppercase tracking-[0.22em] text-parchment-50 shadow-brass hover:border-brass-300/80 focus:outline-none focus:ring-2 focus:ring-brass-300/50"
                >
                  {chapterIndex < chapters.length - 1
                    ? "Weiter"
                    : "Zur Szene"}
                </button>
              </div>
            </footer>
          </div>
        </motion.div>
      ) : played ? (
        <motion.div
          key="intro-replay"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-x-0 top-4 z-20 mx-auto hidden w-full max-w-[1760px] px-4 sm:block"
        >
          <button
            type="button"
            onClick={replay}
            className="pointer-events-auto rounded-md border border-brass-700/45 bg-ink-600/72 px-3 py-2 font-display text-[10px] uppercase tracking-[0.22em] text-brass-300 shadow-brass backdrop-blur hover:border-brass-400/70 focus:outline-none focus:ring-2 focus:ring-brass-300/50"
          >
            Vorspann
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function IntroBackdrop({ backgroundUrl }: { backgroundUrl?: string | null }) {
  if (!backgroundUrl) {
    return (
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#0e0d0a_0%,#191814_45%,#2a2115_100%)]" />
    );
  }

  return (
    <>
      <motion.div
        initial={{ scale: 1.06 }}
        animate={{ scale: 1.02 }}
        transition={{ duration: 12, ease: "easeOut" }}
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${backgroundUrl})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(14,13,10,0.92)_0%,rgba(14,13,10,0.5)_46%,rgba(14,13,10,0.82)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(14,13,10,0.9)_0%,rgba(14,13,10,0.2)_35%,rgba(14,13,10,0.85)_100%)]" />
    </>
  );
}

function ChapterSpotlight({ chapter }: { chapter: IntroDirectorChapter }) {
  if (chapter.kind === "character") {
    return (
      <div className="hidden min-h-0 lg:block">
        <div className="relative ml-auto aspect-[3/4] max-h-[56dvh] w-full max-w-[20rem] overflow-hidden rounded-md border border-brass-400/45 bg-ink-500/55 shadow-2xl">
          {chapter.portraitUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={chapter.portraitUrl}
              alt={chapter.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,rgba(195,154,78,0.18),rgba(156,123,214,0.18))]">
              <span className="font-display text-7xl uppercase text-brass-300/70">
                {chapter.title.slice(0, 1)}
              </span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-600 via-ink-600/82 to-transparent px-4 pb-4 pt-14">
            <p className="font-display text-[10px] uppercase tracking-[0.24em] text-brass-300">
              Charakter
            </p>
            <p className="truncate font-display text-xl text-parchment-50">
              {chapter.title}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden lg:block">
      <div className="ml-auto w-full max-w-[20rem] border border-brass-700/45 bg-ink-600/45 p-4 shadow-2xl backdrop-blur-sm">
        <p className="font-display text-[10px] uppercase tracking-[0.26em] text-brass-400">
          Regie
        </p>
        <div className="mt-4 space-y-3">
          <SignalLine label="Kamera" active={chapter.kind === "establishing"} />
          <SignalLine label="Spannung" active={chapter.kind === "beat"} />
          <SignalLine label="Entscheidung" active={chapter.kind === "mission"} />
        </div>
      </div>
    </div>
  );
}

function SignalLine({ label, active }: { label: string; active: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">
          {label}
        </span>
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            active ? "bg-brass-300 shadow-[0_0_18px_rgba(216,184,120,0.9)]" : "bg-ink-200/40",
          )}
        />
      </div>
      <div className="mt-1 h-px overflow-hidden bg-ink-200/20">
        <motion.div
          initial={{ width: active ? "12%" : "0%" }}
          animate={{ width: active ? "100%" : "20%" }}
          transition={{ duration: active ? 4.8 : 0.4, ease: "easeOut" }}
          className={cn(
            "h-full",
            active ? "bg-brass-300" : "bg-ink-200/30",
          )}
        />
      </div>
    </div>
  );
}

function ChapterRail({
  chapters,
  currentIndex,
  onSelect,
}: {
  chapters: IntroDirectorChapter[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(2rem,1fr))] gap-1.5">
      {chapters.map((chapter, index) => (
        <button
          key={chapter.id}
          type="button"
          onClick={() => onSelect(index)}
          className={cn(
            "h-2 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-brass-300/50",
            index <= currentIndex
              ? "border-brass-300/70 bg-brass-300"
              : "border-brass-700/50 bg-ink-600/70 hover:border-brass-400/70",
          )}
        >
          <span className="sr-only">{chapter.label}</span>
        </button>
      ))}
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}

function paragraphs(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readSessionFlag(key: string) {
  try {
    return window.sessionStorage.getItem(key) === "played";
  } catch {
    return false;
  }
}

function markPlayed(key: string | null) {
  if (!key) return;
  try {
    window.sessionStorage.setItem(key, "played");
  } catch {
    // Session storage can be disabled; the intro still remains skippable.
  }
}
