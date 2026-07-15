"use client";

import { useEffect } from "react";
import { useGame } from "./store";
import { CLIENT_EVENT_TYPES } from "./events";

export function useGameStream(opts: {
  sessionId: string;
  inviteToken?: string;
  displayToken?: string;
}) {
  const ingest = useGame((s) => s.ingest);
  const setConnection = useGame((s) => s.setConnection);
  const setRole = useGame((s) => s.setRole);
  const reset = useGame((s) => s.reset);

  useEffect(() => {
    reset();
    const path = opts.displayToken
      ? `/api/display/sessions/${encodeURIComponent(
          opts.sessionId,
        )}/stream/${encodeURIComponent(opts.displayToken)}`
      : opts.inviteToken
        ? `/api/invite/sessions/${opts.sessionId}/stream/${encodeURIComponent(
            opts.inviteToken,
          )}`
        : `/api/sessions/${opts.sessionId}/stream`;
    const url = new URL(path, window.location.origin);

    const es = new EventSource(url.toString(), { withCredentials: true });

    es.addEventListener("hello", (msg) => {
      try {
        const data = JSON.parse((msg as MessageEvent).data);
        setRole({
          role: data.role,
          displayName: data.displayName,
          sessionId: data.sessionId,
        });
        setConnection({ connected: true });
      } catch {
        /* */
      }
    });

    const onAny = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        ingest(data);
      } catch {
        /* */
      }
    };

    for (const t of CLIENT_EVENT_TYPES) {
      es.addEventListener(t, onAny);
    }

    es.onerror = () => {
      setConnection({ connected: false, error: "Verbindung verloren" });
    };

    return () => {
      es.close();
    };
  }, [
    opts.sessionId,
    opts.inviteToken,
    opts.displayToken,
    ingest,
    setConnection,
    setRole,
    reset,
  ]);
}
