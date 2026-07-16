"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";

export type CastDevice = {
  id: string;
  name: string;
  model: string;
  online: boolean;
  active: boolean;
  busy: boolean;
};

type Props = {
  open: boolean;
  sessionId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onEnterDisplayMode: () => Promise<void>;
  onCastingChange?: (active: boolean) => void;
};

export type CastServiceStatus = "checking" | "online" | "offline";

export function castServicePresentation(status: CastServiceStatus) {
  switch (status) {
    case "online":
      return { label: "Dienst online", liveStatus: "Cast-Dienst online." };
    case "offline":
      return { label: "Dienst offline", liveStatus: "Cast-Dienst offline." };
    default:
      return {
        label: "Dienst wird geprüft",
        liveStatus: "Cast-Dienst wird geprüft.",
      };
  }
}

export function castPendingActionLabel(active: boolean) {
  return active ? "Wird beendet…" : "Wird verbunden…";
}

export function castDialogPanelClassName() {
  return "cast-console flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-brass-500/65 bg-ink-500 shadow-[0_32px_100px_rgba(0,0,0,0.72)] sm:max-h-[calc(100dvh-3rem)]";
}

export function castDialogBodyClassName() {
  return "min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6";
}

export function castDevicePresentation(
  device: Pick<CastDevice, "active" | "busy" | "online">,
) {
  if (!device.online) {
    return { status: "Offline", action: "Nicht erreichbar", disabled: true };
  }
  if (device.active) {
    return { status: "Dieser Tisch läuft", action: "Beenden", disabled: false };
  }
  if (device.busy) {
    return {
      status: "Anderer Tisch aktiv",
      action: "Derzeit belegt",
      disabled: true,
    };
  }
  return {
    status: "Bereit",
    action: "Auf diesem TV starten",
    disabled: false,
  };
}

export function castErrorMessage(code: string) {
  switch (code) {
    case "cast_agent_unavailable":
      return "Der Cast-Dienst ist nicht erreichbar. Prüfe den cast-agent im Docker-Stack.";
    case "cast_agent_timeout":
      return "Die Gerätesuche dauert zu lange. Prüfe WLAN, mDNS oder eine feste Chromecast-IP.";
    case "device_not_found":
      return "Dieser Chromecast ist nicht mehr in der Geräteliste. Suche erneut.";
    case "device_busy":
      return "Auf diesem Chromecast läuft bereits ein anderer Tisch.";
    case "session_closed":
      return "Die Session ist bereits beendet.";
    default:
      return "Die TV-Ausgabe konnte nicht aktualisiert werden.";
  }
}

export function CastGuideDialog(props: Props) {
  const {
    onCastingChange,
    onClose,
    onEnterDisplayMode,
    open,
    sessionId,
    triggerRef,
  } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] =
    useState<CastServiceStatus>("checking");

  const loadDevices = useCallback(
    async (showChecking = false) => {
      if (showChecking) {
        setServiceStatus("checking");
        setError(null);
      }
      setLoading(true);
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/cast`,
          { cache: "no-store" },
        );
        const body = (await response.json().catch(() => null)) as {
          devices?: unknown;
          error?: unknown;
        } | null;
        if (!response.ok) {
          throw new Error(
            typeof body?.error === "string" ? body.error : "cast_failed",
          );
        }
        const next = Array.isArray(body?.devices)
          ? body.devices.filter(isCastDevice)
          : [];
        setDevices(next);
        setError(null);
        setServiceStatus("online");
        onCastingChange?.(next.some((device) => device.active));
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "cast_failed",
        );
        setServiceStatus("offline");
      } finally {
        setLoading(false);
      }
    },
    [sessionId, onCastingChange],
  );

  useEffect(() => {
    if (!open) return;
    void loadDevices(true);
    const interval = window.setInterval(() => void loadDevices(), 7000);
    return () => window.clearInterval(interval);
  }, [loadDevices, open]);

  useDialogFocus({
    open,
    dialogRef,
    closeRef,
    triggerRef,
    onClose,
  });

  async function changeCast(device: CastDevice) {
    setBusyDeviceId(device.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/cast`,
        {
          method: device.active ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceId: device.id }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "cast_failed",
        );
      }
      await loadDevices();
    } catch (castError) {
      setError(castError instanceof Error ? castError.message : "cast_failed");
    } finally {
      setBusyDeviceId(null);
    }
  }

  if (!open) return null;
  const service = castServicePresentation(serviceStatus);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cast-console-title"
      tabIndex={-1}
      className="bg-ink-700/92 fixed inset-0 z-[110] flex items-center justify-center p-3 backdrop-blur-md sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={castDialogPanelClassName()}>
        <header className="border-b border-brass-700/50 bg-[radial-gradient(circle_at_18%_0%,rgba(195,154,78,0.2),transparent_52%)] px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-brass-500/50 bg-ink-600/75 text-brass-300 shadow-brass">
                <CastGlyph className="size-7" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-[10px] uppercase tracking-[0.32em] text-brass-400">
                    TV-Ausgabe · Server Cast
                  </p>
                  <span
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.16em]",
                      serviceStatus === "online"
                        ? "border-emerald-500/40 text-emerald-300"
                        : serviceStatus === "offline"
                          ? "border-blood-500/50 text-blood-500"
                          : "border-brass-500/45 text-brass-300",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        serviceStatus === "online"
                          ? "bg-emerald-400"
                          : serviceStatus === "offline"
                            ? "bg-blood-500"
                            : "animate-pulse bg-brass-300 motion-reduce:animate-none",
                      )}
                    />
                    <span aria-hidden="true">{service.label}</span>
                    <span className="sr-only">{service.liveStatus}</span>
                  </span>
                </div>
                <h2
                  id="cast-console-title"
                  className="mt-1 font-display text-2xl uppercase tracking-[0.08em] text-parchment-100 sm:text-4xl"
                >
                  Wohnzimmer verbinden
                </h2>
                <p className="mt-2 max-w-2xl font-serif text-sm leading-6 text-ink-100 sm:text-base">
                  Firefox gibt den Auftrag an den Server. Der Chromecast öffnet
                  danach selbstständig die sichere TV-Bühne — ohne
                  Tab-Spiegelung.
                </p>
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="min-h-11 shrink-0 rounded-md border border-brass-700/55 bg-ink-600/75 px-4 text-sm text-brass-300 transition hover:border-brass-400 hover:text-parchment-100"
            >
              Schließen
            </button>
          </div>
        </header>

        <div className={castDialogBodyClassName()}>
          {error ? (
            <div
              role="alert"
              className="mb-4 flex flex-col gap-3 rounded-lg border border-blood-500/45 bg-blood-600/10 px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="font-display text-xs uppercase tracking-[0.18em] text-blood-500">
                  TV-Zentrale nicht bereit
                </p>
                <p className="mt-1 text-sm leading-5 text-parchment-100">
                  {castErrorMessage(error)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadDevices(true)}
                className="min-h-11 rounded-md border border-blood-500/45 px-4 text-sm text-parchment-100 hover:bg-blood-600/15"
              >
                Erneut suchen
              </button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-display text-[10px] uppercase tracking-[0.28em] text-brass-400">
                Ausgabegeräte
              </p>
              <p className="mt-1 text-sm text-ink-100">
                {loading
                  ? "Chromecasts werden gesucht…"
                  : `${devices.length} ${devices.length === 1 ? "Gerät" : "Geräte"} im Heimnetz`}
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadDevices(true)}
              className="flex min-h-11 items-center gap-2 rounded-md border border-brass-700/55 bg-ink-600/60 px-3 text-sm text-brass-300 hover:border-brass-400/70 disabled:opacity-50"
            >
              <RefreshGlyph
                className={cn("size-4", loading && "animate-spin")}
              />
              Suchen
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {devices.map((device) => {
              const presentation = castDevicePresentation(device);
              const busy = busyDeviceId === device.id;
              return (
                <article
                  key={device.id}
                  className={cn(
                    "rounded-lg border p-4 transition",
                    device.active
                      ? "border-brass-400/75 bg-brass-700/20 shadow-brass"
                      : "border-brass-700/40 bg-ink-600/45",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-md border",
                        device.active
                          ? "text-brass-200 border-brass-400/65 bg-brass-700/30"
                          : "border-brass-700/50 bg-ink-700/55 text-brass-400",
                      )}
                    >
                      <CastGlyph className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-display text-lg text-parchment-100">
                        {device.name}
                      </h3>
                      <p className="truncate text-xs text-ink-200">
                        {device.model}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-1 font-display text-[9px] uppercase tracking-[0.15em]",
                        device.active
                          ? "text-brass-200 border-brass-400/60"
                          : device.busy
                            ? "border-blood-500/40 text-blood-500"
                            : "border-emerald-500/35 text-emerald-300",
                      )}
                    >
                      {presentation.status}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={presentation.disabled || busy}
                    onClick={() => void changeCast(device)}
                    className={cn(
                      "mt-4 min-h-12 w-full rounded-md border px-4 font-display text-xs uppercase tracking-[0.15em] transition",
                      device.active
                        ? "border-blood-500/55 bg-blood-600/10 text-blood-500 hover:bg-blood-600/20"
                        : "border-brass-400/65 bg-brass-700/30 text-parchment-100 hover:bg-brass-600/40",
                      (presentation.disabled || busy) &&
                        "cursor-not-allowed opacity-50",
                    )}
                  >
                    {busy
                      ? castPendingActionLabel(device.active)
                      : presentation.action}
                  </button>
                </article>
              );
            })}
          </div>

          {serviceStatus === "online" &&
          !loading &&
          !error &&
          devices.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-brass-700/50 bg-ink-600/30 px-5 py-8 text-center">
              <p className="font-display text-lg uppercase tracking-[0.12em] text-parchment-100">
                Kein Chromecast gefunden
              </p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-100">
                Prüfe, ob dein Chromecast eingeschaltet ist und mit demselben
                Heimnetz wie Plum Tabletop verbunden ist. Suche danach erneut.
              </p>
              <details className="mx-auto mt-4 max-w-xl text-left text-xs leading-5 text-ink-100">
                <summary className="min-h-10 cursor-pointer py-2 text-center text-brass-300">
                  Hilfe bei getrennten Netzen
                </summary>
                <p className="mt-1 border-t border-brass-700/35 pt-3">
                  Falls dein WLAN die automatische Suche blockiert, kann der
                  Server-Admin die feste Geräte-IP über
                  <code className="mx-1 text-brass-300">CHROMECAST_HOSTS</code>
                  hinterlegen.
                </p>
              </details>
            </div>
          ) : null}

          <footer className="mt-5 flex flex-col gap-3 border-t border-brass-700/35 pt-5 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void onEnterDisplayMode()}
              className="min-h-11 rounded-md border border-brass-700/55 bg-ink-600/60 px-4 font-display text-xs uppercase tracking-[0.15em] text-brass-300 hover:border-brass-400/70"
            >
              Dieses Gerät als Bildschirm
            </button>
            <p className="text-xs leading-5 text-ink-200 sm:ml-auto sm:max-w-md sm:text-right">
              Die TV-Seite ist nur lesbar. Aktionen und Würfe bleiben auf den
              verbundenen Handys und in dieser Host-Konsole.
            </p>
          </footer>
        </div>
      </section>
    </div>
  );
}

function useDialogFocus(input: {
  open: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { open, dialogRef, closeRef, triggerRef, onClose } = input;
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
  }, [closeRef, dialogRef, onClose, open, triggerRef]);
}

function isCastDevice(value: unknown): value is CastDevice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const device = value as Partial<CastDevice>;
  return (
    typeof device.id === "string" &&
    typeof device.name === "string" &&
    typeof device.model === "string" &&
    typeof device.online === "boolean" &&
    typeof device.active === "boolean" &&
    typeof device.busy === "boolean"
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
        d="M4 18.5A1.5 1.5 0 0 1 5.5 20M4 14a6 6 0 0 1 6 6M4 9.5A10.5 10.5 0 0 1 14.5 20"
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

function RefreshGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M20 7v5h-5M4 17v-5h5M6.1 8.7A7 7 0 0 1 18.6 7M5.4 17A7 7 0 0 0 17.9 15.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
