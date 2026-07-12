"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

type CastPlatform = "desktop" | "android" | "ios";

export type CastGuide = {
  platform: CastPlatform;
  eyebrow: string;
  summary: string;
  steps: string[];
};

export function castGuideForUserAgent(userAgent: string): CastGuide {
  if (/iPad|iPhone|iPod/i.test(userAgent)) {
    return {
      platform: "ios",
      eyebrow: "iPhone & iPad",
      summary:
        "Chrome unter iOS kann Browser-Tabs nicht direkt an Chromecast spiegeln.",
      steps: [
        "Öffne diesen Gemeinschaftstisch in Desktop-Chrome auf einem Laptop oder Computer.",
        "Öffne dort das Chrome-Menü und wähle Streamen, speichern und teilen → Streamen…",
        "Wähle Tab streamen und danach deinen Chromecast.",
      ],
    };
  }

  if (/Android/i.test(userAgent)) {
    return {
      platform: "android",
      eyebrow: "Android",
      summary:
        "Spiegle den ganzen Android-Bildschirm über Google Home auf deinen Chromecast.",
      steps: [
        "Öffne die Google Home App und wähle deinen Chromecast.",
        "Tippe auf Bildschirm streamen und bestätige die Bildschirmfreigabe.",
        "Kehre zu Plum Tabletop zurück, drehe das Handy quer und starte unten den Vollbildmodus.",
      ],
    };
  }

  return {
    platform: "desktop",
    eyebrow: "Chrome am Computer",
    summary:
      "Chrome spiegelt diesen Tisch samt Animationen und Stimmen direkt auf den Fernseher.",
    steps: [
      "Öffne rechts oben das Chrome-Menü ⋮ und wähle Streamen, speichern und teilen.",
      "Wähle Streamen… und als Quelle Tab streamen.",
      "Wähle deinen Chromecast. Kehre danach hierher zurück und starte unten den Vollbildmodus.",
    ],
  };
}

type Props = {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onEnterDisplayMode: () => Promise<void>;
};

export function CastGuideDialog(props: Props) {
  const { open, triggerRef, onClose, onEnterDisplayMode } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [copied, setCopied] = useState(false);
  const guide = useMemo(
    () =>
      castGuideForUserAgent(
        typeof navigator === "undefined" ? "" : navigator.userAgent,
      ),
    [],
  );

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    const parent = dialog?.parentElement;
    const siblings = parent
      ? Array.from(parent.children).filter(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node !== dialog,
        )
      : [];
    const previous = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const { element } of previous) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = oldOverflow;
      for (const item of previous) {
        item.element.inert = item.inert;
        if (item.ariaHidden === null)
          item.element.removeAttribute("aria-hidden");
        else item.element.setAttribute("aria-hidden", item.ariaHidden);
      }
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  async function copyTableLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cast-guide-title"
      tabIndex={-1}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-ink-600/90 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="w-full max-w-3xl overflow-hidden border border-brass-500/65 bg-ink-500 shadow-2xl">
        <header className="flex items-start justify-between gap-5 border-b border-brass-700/55 bg-[radial-gradient(circle_at_18%_0%,rgba(170,119,43,0.24),transparent_48%)] px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex min-w-0 gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-brass-500/50 bg-ink-600/70 text-brass-300 shadow-brass">
              <CastGlyph className="size-7" />
            </div>
            <div>
              <p className="font-display text-[10px] uppercase tracking-[0.34em] text-brass-400">
                {guide.eyebrow}
              </p>
              <h2
                id="cast-guide-title"
                className="mt-1 font-display text-2xl uppercase tracking-[0.1em] text-parchment-100 sm:text-3xl"
              >
                Auf Chromecast anzeigen
              </h2>
              <p className="mt-2 max-w-xl font-serif text-sm leading-6 text-ink-100">
                {guide.summary}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 border border-brass-700/60 bg-ink-600/70 px-4 text-sm text-brass-300 transition hover:border-brass-400 hover:text-parchment-100"
          >
            Schließen
          </button>
        </header>

        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <ol className="grid gap-3">
            {guide.steps.map((step, index) => (
              <li
                key={step}
                className="bg-ink-600/48 grid grid-cols-[2.5rem_1fr] items-start gap-3 border border-brass-700/40 p-4"
              >
                <span className="flex size-10 items-center justify-center rounded-full border border-brass-600/60 font-display text-sm text-brass-300">
                  {index + 1}
                </span>
                <p className="pt-2 font-serif text-sm leading-6 text-parchment-100 sm:text-base">
                  {step}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-col gap-3 border-t border-brass-700/35 pt-5 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void onEnterDisplayMode()}
              className="min-h-12 border border-brass-400/70 bg-brass-700/35 px-5 font-display text-xs uppercase tracking-[0.16em] text-parchment-100 shadow-brass transition hover:bg-brass-600/45"
            >
              Vollbild starten
            </button>
            <button
              type="button"
              onClick={() => void copyTableLink()}
              className="min-h-12 border border-brass-700/55 bg-ink-600/65 px-5 font-display text-xs uppercase tracking-[0.16em] text-brass-300 transition hover:border-brass-400/70"
            >
              {copied ? "Tisch-Link kopiert" : "Tisch-Link kopieren"}
            </button>
            <p className="text-xs leading-5 text-ink-200 sm:ml-auto sm:max-w-[15rem] sm:text-right">
              Beide Geräte müssen im selben WLAN sein. Die Seite muss per HTTPS
              erreichbar sein.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export function CastGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M4 18.5a1.5 1.5 0 0 1 1.5 1.5M4 14a6 6 0 0 1 6 6M4 9.5A10.5 10.5 0 0 1 14.5 20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7 4h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
