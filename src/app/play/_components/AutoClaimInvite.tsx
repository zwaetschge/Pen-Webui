"use client";

import { useEffect, useRef, useState } from "react";

type ClaimState = "connecting" | "unavailable";

type ClaimRequest = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function claimInviteRedirect(
  sessionId: string,
  token: string,
  request: ClaimRequest = fetch,
) {
  const response = await request(
    `/api/invite/sessions/${encodeURIComponent(
      sessionId,
    )}/claim/${encodeURIComponent(token)}`,
    { method: "POST", credentials: "same-origin" },
  );
  const body = (await response.json().catch(() => null)) as {
    redirectTo?: unknown;
  } | null;
  return response.ok && typeof body?.redirectTo === "string"
    ? body.redirectTo
    : null;
}

export function AutoClaimInvite(props: { sessionId: string; token: string }) {
  const started = useRef(false);
  const [state, setState] = useState<ClaimState>("connecting");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function claim() {
      try {
        const redirectTo = await claimInviteRedirect(
          props.sessionId,
          props.token,
        );
        if (!redirectTo) {
          setState("unavailable");
          return;
        }
        window.location.replace(redirectTo);
      } catch {
        setState("unavailable");
      }
    }

    void claim();
  }, [props.sessionId, props.token]);

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink-600 px-6 text-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-45 [background-image:radial-gradient(circle_at_50%_22%,rgba(176,137,64,0.24),transparent_42%),linear-gradient(rgba(176,137,64,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(176,137,64,0.05)_1px,transparent_1px)] [background-size:auto,36px_36px,36px_36px]"
      />
      <section
        aria-live="polite"
        className="relative w-full max-w-md border border-brass-700/55 bg-ink-500/90 px-7 py-10 shadow-2xl"
      >
        <p className="font-display text-[10px] uppercase tracking-[0.38em] text-brass-400">
          Plum Tabletop
        </p>
        {state === "connecting" ? (
          <>
            <div
              aria-hidden="true"
              className="mx-auto mt-7 h-10 w-10 animate-spin rounded-full border-2 border-brass-700 border-t-brass-300 motion-reduce:animate-none"
            />
            <h1 className="mt-6 font-display text-2xl uppercase tracking-[0.15em] text-parchment-100">
              Mit dem Spieltisch verbinden
            </h1>
            <p className="mt-3 font-serif text-sm leading-6 text-ink-100">
              Dein Charakterplatz wird vorbereitet. Dieser Vorgang dauert nur
              einen Augenblick.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-6 font-display text-2xl uppercase tracking-[0.12em] text-parchment-100">
              Platz nicht verfügbar
            </h1>
            <p className="mt-3 font-serif text-sm leading-6 text-ink-100">
              Der Code wurde bereits verwendet oder vom Dungeon Master
              erneuert. Bitte lass dir am Spieltisch einen neuen QR-Code zeigen.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
