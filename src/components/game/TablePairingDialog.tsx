"use client";

import QRCode from "qrcode";
import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PairingSeat, PairingState } from "@/lib/game/pairing";

type Props = {
  open: boolean;
  sessionId: string;
  campaignTitle: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

export function TablePairingDialog(props: Props) {
  const { open, sessionId, campaignTitle, triggerRef, onClose } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<PairingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reissuing, setReissuing] = useState<string | null>(null);
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});
  const [qrFailures, setQrFailures] = useState<Record<string, true>>({});

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void requestPairing(sessionId, "POST", undefined, controller.signal)
      .then((next) => setState(next as PairingState))
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Die Spielercodes konnten nicht geladen werden.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, sessionId]);

  const readySeats = useMemo(
    () => state?.seats.filter((seat) => seat.invitePath) ?? [],
    [state],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function renderCodes() {
      const nextCodes: Record<string, string> = {};
      const nextFailures: Record<string, true> = {};
      await Promise.all(
        readySeats.map(async (seat) => {
          try {
            const absoluteUrl = new URL(
              seat.invitePath!,
              window.location.origin,
            ).toString();
            nextCodes[seat.characterId] = await QRCode.toDataURL(absoluteUrl, {
              width: 280,
              margin: 1,
              errorCorrectionLevel: "M",
              color: { dark: "#17130f", light: "#f2e5c4" },
            });
          } catch {
            nextFailures[seat.characterId] = true;
          }
        }),
      );
      if (!cancelled) {
        setQrCodes(nextCodes);
        setQrFailures(nextFailures);
      }
    }

    void renderCodes();
    return () => {
      cancelled = true;
    };
  }, [open, readySeats]);

  useEffect(() => {
    if (!open) return;
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
      const focusable = focusableElements(dialog);
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
        if (item.ariaHidden === null) item.element.removeAttribute("aria-hidden");
        else item.element.setAttribute("aria-hidden", item.ariaHidden);
      }
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  async function reissue(seat: PairingSeat) {
    const confirmed = window.confirm(
      `${seat.characterName} neu koppeln? Das bisher verbundene Gerät verliert sofort den Zugriff.`,
    );
    if (!confirmed) return;
    setReissuing(seat.characterId);
    setError(null);
    try {
      const body = (await requestPairing(sessionId, "DELETE", {
        characterId: seat.characterId,
      })) as { seat: PairingSeat };
      setState((current) =>
        current
          ? {
              ...current,
              seats: current.seats.map((entry) =>
                entry.characterId === body.seat.characterId ? body.seat : entry,
              ),
            }
          : current,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Der Spielerplatz konnte nicht erneuert werden.",
      );
    } finally {
      setReissuing(null);
    }
  }

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pairing-title"
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-600/88 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex max-h-[min(92dvh,900px)] w-full max-w-6xl flex-col overflow-hidden border border-brass-500/60 bg-ink-500 shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-6 border-b border-brass-700/55 bg-[linear-gradient(105deg,rgba(122,84,31,0.22),transparent_60%)] px-5 py-4 sm:px-7 sm:py-5">
          <div>
            <p className="font-display text-[10px] uppercase tracking-[0.36em] text-brass-400">
              Gemeinschaftstisch
            </p>
            <h2
              id="pairing-title"
              className="mt-1 font-display text-2xl uppercase tracking-[0.12em] text-parchment-100 sm:text-3xl"
            >
              Spieler verbinden
            </h2>
            <p className="mt-2 max-w-2xl font-serif text-sm leading-6 text-ink-100">
              Jeder Spieler scannt den Code seines Charakters. Der Fernseher
              bleibt die gemeinsame Bühne; Aktionen und Würfe kommen vom Handy.
            </p>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-brass-700/35 pb-4">
            <p className="min-w-0 truncate font-display text-sm uppercase tracking-[0.18em] text-brass-300">
              {campaignTitle}
            </p>
            <p className="shrink-0 text-xs text-ink-200">
              {state?.seats.length ?? 0} Spielerplätze
            </p>
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center">
              <p className="font-serif text-ink-100">Spielercodes werden vorbereitet …</p>
            </div>
          ) : error && !state ? (
            <div className="border border-red-800/55 bg-red-950/25 p-5 text-sm text-red-100">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  setState(null);
                  setError(null);
                  onClose();
                  window.setTimeout(() => triggerRef.current?.click(), 0);
                }}
                className="mt-4 min-h-10 border border-red-700/60 px-4"
              >
                Erneut versuchen
              </button>
            </div>
          ) : state?.seats.length === 0 ? (
            <div className="border border-brass-700/45 bg-ink-600/45 p-6 text-center font-serif text-ink-100">
              Für diese Kampagne sind noch keine Spielercharaktere angelegt.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {state?.seats.map((seat, index) => (
                <article
                  key={seat.characterId}
                  className="relative overflow-hidden border border-brass-700/50 bg-ink-600/55 p-4 shadow-xl"
                >
                  <span
                    aria-hidden="true"
                    className="absolute right-3 top-2 font-display text-5xl text-brass-700/20"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="relative">
                    <p className="font-display text-lg uppercase tracking-[0.1em] text-parchment-100">
                      {seat.characterName}
                    </p>
                    <p
                      className={
                        seat.status === "paired"
                          ? "mt-1 text-xs uppercase tracking-[0.18em] text-emerald-300"
                          : "mt-1 text-xs uppercase tracking-[0.18em] text-brass-400"
                      }
                    >
                      {seat.status === "paired" ? "Verbunden" : "Bereit zum Scannen"}
                    </p>

                    <div className="mt-4 flex aspect-square items-center justify-center border border-brass-700/35 bg-parchment-100 p-2">
                      {seat.status === "paired" ? (
                        <div className="px-3 text-center text-ink-600">
                          <p className="font-display text-xl uppercase tracking-[0.12em]">
                            Platz aktiv
                          </p>
                          <p className="mt-2 font-serif text-xs leading-5">
                            Aktionen dieses Charakters kommen jetzt vom verbundenen Gerät.
                          </p>
                        </div>
                      ) : qrCodes[seat.characterId] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={qrCodes[seat.characterId]}
                          alt={`QR-Code für ${seat.characterName}`}
                          className="h-full w-full object-contain"
                        />
                      ) : qrFailures[seat.characterId] ? (
                        <div className="px-3 text-center text-sm text-red-900">
                          QR-Code konnte nicht erzeugt werden. Bitte neu koppeln.
                        </div>
                      ) : (
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-ink-600 motion-reduce:animate-none" />
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={reissuing === seat.characterId}
                      onClick={() => void reissue(seat)}
                      className="mt-4 min-h-11 w-full border border-brass-700/60 bg-brass-800/25 px-3 text-sm text-brass-300 transition hover:border-brass-400 hover:bg-brass-700/35 hover:text-parchment-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      {reissuing === seat.characterId ? "Wird erneuert …" : "Neu koppeln"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {error && state ? (
            <p role="alert" className="mt-5 border border-red-800/55 bg-red-950/25 p-3 text-sm text-red-100">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

async function requestPairing(
  sessionId: string,
  method: "POST" | "DELETE",
  body?: { characterId: string },
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/pairing`,
    {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Die Spielercodes konnten nicht geladen werden.",
    );
  }
  return payload;
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("inert"));
}
