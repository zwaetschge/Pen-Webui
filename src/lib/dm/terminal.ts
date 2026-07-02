import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const MAX_BUFFER_CHARS = 120_000;
const MAX_INPUT_CHARS = 8_192;

export type TerminalEvent =
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null };

type TerminalSession = {
  id: string;
  ownerUserId: string;
  proc: ChildProcessWithoutNullStreams;
  output: string;
  createdAt: number;
  lastSeenAt: number;
  exited: boolean;
  subscribers: Set<(event: TerminalEvent) => void>;
};

const sessions = new Map<string, TerminalSession>();

function isEnabled() {
  return env().SETTINGS_TERMINAL_ENABLED;
}

export function terminalSettings() {
  const e = env();
  return {
    enabled: e.SETTINGS_TERMINAL_ENABLED,
    idleMinutes: e.SETTINGS_TERMINAL_IDLE_MINUTES,
  };
}

function assertEnabled() {
  if (!isEnabled()) throw new Error("settings terminal is disabled");
}

export function terminalShellPath(shell = process.env.SHELL) {
  const value = shell?.trim();
  if (!value || !value.startsWith("/") || /\s/.test(value)) return "/bin/sh";
  return value;
}

export function terminalShellCommand(shell = process.env.SHELL) {
  return `${terminalShellPath(shell)} -i`;
}

function shellEnv(shell: string) {
  const home = process.env.HOME || "/home/nextjs";
  const path = ["/app/node_modules/.bin", process.env.PATH]
    .filter(Boolean)
    .join(":");

  return {
    ...process.env,
    HOME: home,
    PATH: path,
    SHELL: shell,
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
  };
}

function spawnTerminalProcess() {
  const shell = terminalShellPath();
  const env = shellEnv(shell);
  const cwd = existsSync("/app") ? "/app" : process.cwd();

  if (existsSync("/usr/bin/script")) {
    return spawn(
      "script",
      ["-qfec", terminalShellCommand(shell), "/dev/null"],
      {
        cwd,
        env,
        stdio: "pipe",
      },
    );
  }

  return spawn(shell, ["-i"], {
    cwd,
    env,
    stdio: "pipe",
  });
}

function publish(session: TerminalSession, event: TerminalEvent) {
  session.lastSeenAt = Date.now();
  if (event.type === "output") {
    session.output = (session.output + event.data).slice(-MAX_BUFFER_CHARS);
  }
  for (const subscriber of session.subscribers) subscriber(event);
}

function getOwnedSession(id: string, ownerUserId: string) {
  const session = sessions.get(id);
  if (!session || session.ownerUserId !== ownerUserId) return null;
  session.lastSeenAt = Date.now();
  return session;
}

export function cleanupTerminalSessions() {
  const maxIdleMs = env().SETTINGS_TERMINAL_IDLE_MINUTES * 60_000;
  const now = Date.now();

  for (const [id, session] of sessions) {
    if (!session.exited && now - session.lastSeenAt < maxIdleMs) continue;
    destroySession(id, session, "idle_cleanup");
  }
}

export function createTerminalSession(ownerUserId: string) {
  assertEnabled();
  cleanupTerminalSessions();
  closeTerminalSessionsForOwner(ownerUserId, "superseded");

  const id = randomUUID();
  const proc = spawnTerminalProcess();
  const session: TerminalSession = {
    id,
    ownerUserId,
    proc,
    output:
      "Plum container terminal. Try `codex login --device-auth` for Codex CLI auth, or `codex --help`.\r\n",
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    exited: false,
    subscribers: new Set(),
  };

  proc.stdout.on("data", (chunk: Buffer) => {
    publish(session, { type: "output", data: chunk.toString("utf8") });
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    publish(session, { type: "output", data: chunk.toString("utf8") });
  });
  proc.on("exit", (code, signal) => {
    session.exited = true;
    publish(session, { type: "exit", code, signal });
  });
  proc.on("error", (error) => {
    session.exited = true;
    publish(session, {
      type: "output",
      data: `terminal failed to start: ${error.message}\r\n`,
    });
    publish(session, { type: "exit", code: null, signal: null });
  });

  sessions.set(id, session);
  logger.info({ ownerUserId, sessionId: id }, "DM terminal session opened");
  return { id, createdAt: session.createdAt };
}

export function writeTerminalInput(
  id: string,
  ownerUserId: string,
  data: string,
) {
  assertEnabled();
  const session = getOwnedSession(id, ownerUserId);
  if (!session || session.exited) return false;
  session.proc.stdin.write(data.slice(0, MAX_INPUT_CHARS));
  return true;
}

export function closeTerminalSession(id: string, ownerUserId: string) {
  assertEnabled();
  const session = getOwnedSession(id, ownerUserId);
  if (!session) return false;
  destroySession(id, session, "user_closed");
  return true;
}

export function subscribeTerminalSession(
  id: string,
  ownerUserId: string,
  subscriber: (event: TerminalEvent) => void,
) {
  assertEnabled();
  const session = getOwnedSession(id, ownerUserId);
  if (!session) return null;

  subscriber({ type: "output", data: session.output });
  if (session.exited) subscriber({ type: "exit", code: null, signal: null });

  session.subscribers.add(subscriber);
  return () => {
    session.subscribers.delete(subscriber);
    session.lastSeenAt = Date.now();
  };
}

function closeTerminalSessionsForOwner(ownerUserId: string, reason: string) {
  for (const [id, session] of sessions) {
    if (session.ownerUserId !== ownerUserId) continue;
    destroySession(id, session, reason);
  }
}

function destroySession(id: string, session: TerminalSession, reason: string) {
  session.proc.kill("SIGHUP");
  sessions.delete(id);
  logger.info(
    { ownerUserId: session.ownerUserId, sessionId: id, reason },
    "DM terminal session closed",
  );
}
