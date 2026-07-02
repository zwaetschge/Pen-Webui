"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";

type TerminalPanelProps = {
  enabled: boolean;
  idleMinutes: number;
};

export function TerminalPanel({ enabled, idleMinutes }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitRafRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const inputBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const [starting, setStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const flushInput = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const sessionId = sessionIdRef.current;
    const data = inputBufferRef.current;
    inputBufferRef.current = "";
    if (!sessionId || !data) return;

    const response = await fetch(`/api/dm/terminal/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });

    if (!response.ok) {
      setErr("Terminal input failed.");
      return;
    }

    if (inputBufferRef.current) {
      flushTimerRef.current = setTimeout(() => void flushInput(), 16);
    }
  }, []);

  const queueInput = useCallback(
    (data: string) => {
      inputBufferRef.current += data;
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => void flushInput(), 16);
      }
    },
    [flushInput],
  );

  const fitTerminal = useCallback(() => {
    if (fitRafRef.current !== null) return;
    fitRafRef.current = window.requestAnimationFrame(() => {
      fitRafRef.current = null;
      const container = containerRef.current;
      if (!container || !terminalRef.current || !fitRef.current) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fitRef.current.fit();
    });
  }, []);

  const closeLocal = useCallback(() => {
    closingRef.current = true;
    sourceRef.current?.close();
    sourceRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (fitRafRef.current !== null) {
      window.cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = null;
    }
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitRef.current = null;
    setConnected(false);
    closingRef.current = false;
  }, []);

  const closeSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    closeLocal();
    sessionIdRef.current = null;
    if (!sessionId) return;
    await fetch(`/api/dm/terminal/${sessionId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }, [closeLocal]);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      resizeObserverRef.current?.disconnect();
      if (fitRafRef.current !== null)
        window.cancelAnimationFrame(fitRafRef.current);
      terminalRef.current?.dispose();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  async function startSession() {
    if (!enabled || starting) return;
    setStarting(true);
    setErr(null);

    try {
      await closeSession();
      const response = await fetch("/api/dm/terminal", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "failed");

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        lineHeight: 1.18,
        scrollback: 5000,
        theme: {
          background: "#0e0d0a",
          foreground: "#e8dcc0",
          cursor: "#c39a4e",
          selectionBackground: "#4b3a24",
          black: "#0e0d0a",
          red: "#b85042",
          green: "#8ba56b",
          yellow: "#c39a4e",
          blue: "#7e6aa8",
          magenta: "#9c7bd6",
          cyan: "#7aa5a3",
          white: "#e8dcc0",
          brightBlack: "#5f5a4d",
          brightRed: "#dc6b5a",
          brightGreen: "#adc987",
          brightYellow: "#e0b765",
          brightBlue: "#9b87c8",
          brightMagenta: "#b998ef",
          brightCyan: "#99c6c4",
          brightWhite: "#fff7e4",
        },
      });
      const fit = new FitAddon();

      terminal.loadAddon(fit);
      terminal.open(containerRef.current!);
      terminal.focus();
      terminal.onData(queueInput);

      terminalRef.current = terminal;
      fitRef.current = fit;
      sessionIdRef.current = body.id;
      fitTerminal();

      const source = new EventSource(`/api/dm/terminal/${body.id}/stream`);
      source.onopen = () => {
        setErr(null);
        setConnected(true);
      };
      source.addEventListener("output", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          data: string;
        };
        terminal.write(payload.data);
      });
      source.addEventListener("exit", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          code: number | null;
          signal: string | null;
        };
        terminal.writeln("");
        terminal.writeln(
          `[terminal exited: ${payload.signal ?? payload.code ?? "closed"}]`,
        );
        setConnected(false);
        source.close();
      });
      source.onerror = () => {
        if (closingRef.current) return;
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
        setErr("Terminal stream disconnected. Reopen the terminal.");
        setConnected(false);
      };
      sourceRef.current = source;
      setConnected(true);

      const observer = new ResizeObserver(() => {
        fitTerminal();
      });
      if (containerRef.current) observer.observe(containerRef.current);
      resizeObserverRef.current = observer;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed";
      setErr(msg);
      closeLocal();
    } finally {
      setStarting(false);
    }
  }

  function runCodexLogin() {
    queueInput("codex login --device-auth\r");
    terminalRef.current?.focus();
  }

  return (
    <section className="panel space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-parchment-100">
            Container terminal
          </h2>
          <p className="mt-1 max-w-2xl font-serif text-sm text-ink-100">
            DM-only shell in the web container. Idle sessions close after{" "}
            {idleMinutes} minutes.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!enabled || starting || connected}
            onClick={startSession}
            className="rounded-md border border-arcane-500/60 bg-arcane-600/30 px-3 py-2 text-sm text-parchment-100 hover:bg-arcane-500/40 disabled:opacity-50"
          >
            {starting ? "Starting" : connected ? "Running" : "Open"}
          </button>
          <button
            type="button"
            disabled={!connected}
            onClick={runCodexLogin}
            className="rounded-md border border-brass-500/60 bg-brass-700/30 px-3 py-2 text-sm text-parchment-100 hover:bg-brass-600/30 disabled:opacity-50"
          >
            Codex device login
          </button>
          <button
            type="button"
            disabled={!sessionIdRef.current}
            onClick={() => void closeSession()}
            className="rounded-md border border-blood-500/40 bg-blood-600/20 px-3 py-2 text-sm text-blood-500 hover:bg-blood-600/30 disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>

      {!enabled ? (
        <p className="rounded-md border border-brass-700/40 bg-ink-600/70 px-3 py-2 text-xs text-ink-100">
          Disabled. Set SETTINGS_TERMINAL_ENABLED=true and redeploy the web
          container.
        </p>
      ) : null}

      <div
        ref={containerRef}
        className="h-[clamp(320px,52vh,460px)] overflow-hidden rounded-md border border-brass-700/40 bg-[#0e0d0a] p-2"
      />

      {err ? <p className="text-xs text-blood-500">{err}</p> : null}
    </section>
  );
}
