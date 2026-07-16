import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  codexManagedExecutablePath,
  codexManagedInstallRoot,
  resolveCodexExecutable,
  type ResolvedCodexExecutable,
} from "./codex-cli";

const CODEX_PACKAGE = "@openai/codex@latest";
const VERSION_TIMEOUT_MS = 5_000;
const UPDATE_TIMEOUT_MS = 180_000;
const MAX_PROCESS_OUTPUT_CHARS = 16_384;

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type CodexUpdaterDependencies = {
  resolveExecutable: () => ResolvedCodexExecutable;
  managedInstallRoot: () => string;
  managedExecutablePath: () => string;
  npmCommand: string;
  ensureDirectory: (directory: string) => Promise<void>;
  stagingInstallRoot: (installRoot: string) => string;
  activateInstall: (stagingRoot: string, installRoot: string) => Promise<void>;
  cleanupDirectory: (directory: string) => Promise<void>;
  invalidateModelCatalog: () => Promise<void>;
  runProcess: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<ProcessResult>;
};

export type CodexUpdateStatus = {
  available: boolean;
  currentVersion: string | null;
  source: ResolvedCodexExecutable["source"];
  managed: boolean;
  canUpdate: boolean;
  updating: boolean;
};

export type CodexUpdateResult = {
  previousVersion: string | null;
  currentVersion: string;
  changed: boolean;
  status: CodexUpdateStatus;
};

export type CodexUpdateErrorCode =
  | "UPDATE_IN_PROGRESS"
  | "MANAGED_UPDATE_DISABLED"
  | "UPDATE_TIMEOUT"
  | "UPDATE_FAILED";

export class CodexUpdateError extends Error {
  constructor(
    public readonly code: CodexUpdateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodexUpdateError";
  }
}

export function createCodexUpdater(
  dependencies: Partial<CodexUpdaterDependencies> = {},
) {
  const deps: CodexUpdaterDependencies = {
    resolveExecutable: () => resolveCodexExecutable(),
    managedInstallRoot: () => codexManagedInstallRoot(),
    managedExecutablePath: () => codexManagedExecutablePath(),
    npmCommand: resolveNpmCommand(),
    ensureDirectory: async (directory) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    },
    stagingInstallRoot: (installRoot) =>
      `${installRoot}.update-${randomUUID()}`,
    activateInstall: activateManagedInstall,
    cleanupDirectory: async (directory) => {
      await rm(directory, { recursive: true, force: true });
    },
    invalidateModelCatalog: async () => {
      const { invalidateCodexModelCatalog } = await import("./codex-models");
      invalidateCodexModelCatalog();
    },
    runProcess,
    ...dependencies,
  };
  let activeUpdate: Promise<CodexUpdateResult> | null = null;

  async function status(): Promise<CodexUpdateStatus> {
    const executable = deps.resolveExecutable();
    const version = await readCodexVersion(executable.command, deps.runProcess);

    return {
      available: version !== null,
      currentVersion: version,
      source: executable.source,
      managed: executable.source === "managed",
      canUpdate: executable.source !== "configured",
      updating: activeUpdate !== null,
    };
  }

  async function update(): Promise<CodexUpdateResult> {
    if (activeUpdate) {
      throw new CodexUpdateError(
        "UPDATE_IN_PROGRESS",
        "Ein Codex-Update läuft bereits.",
      );
    }

    if (deps.resolveExecutable().source === "configured") {
      throw new CodexUpdateError(
        "MANAGED_UPDATE_DISABLED",
        "Codex wird über CODEX_BIN verwaltet und kann hier nicht aktualisiert werden.",
      );
    }

    const operation = performUpdate(deps, status).catch((error: unknown) => {
      if (error instanceof CodexUpdateError) throw error;
      throw new CodexUpdateError(
        "UPDATE_FAILED",
        "Codex konnte nicht aktualisiert werden. Prüfe Netzwerk und Container-Logs.",
      );
    });
    activeUpdate = operation;
    try {
      return await operation;
    } finally {
      activeUpdate = null;
    }
  }

  return { status, update };
}

async function performUpdate(
  deps: CodexUpdaterDependencies,
  getStatus: () => Promise<CodexUpdateStatus>,
): Promise<CodexUpdateResult> {
  const before = await getStatus();
  const installRoot = deps.managedInstallRoot();
  const stagingRoot = deps.stagingInstallRoot(installRoot);
  await deps.ensureDirectory(path.dirname(stagingRoot));

  try {
    const result = await deps.runProcess(
      deps.npmCommand,
      [
        "install",
        "--prefix",
        stagingRoot,
        "--no-save",
        "--no-package-lock",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        CODEX_PACKAGE,
      ],
      UPDATE_TIMEOUT_MS,
    );

    if (result.timedOut) {
      throw new CodexUpdateError(
        "UPDATE_TIMEOUT",
        "Das Codex-Update hat das Zeitlimit überschritten.",
      );
    }
    if (result.code !== 0) {
      throw new CodexUpdateError(
        "UPDATE_FAILED",
        "Codex konnte nicht aktualisiert werden. Prüfe Netzwerk und Container-Logs.",
      );
    }

    const stagingExecutable = path.join(
      stagingRoot,
      "node_modules",
      ".bin",
      "codex",
    );
    const currentVersion = await readCodexVersion(
      stagingExecutable,
      deps.runProcess,
    );
    if (!currentVersion) {
      throw new CodexUpdateError(
        "UPDATE_FAILED",
        "Das Update wurde installiert, aber die neue Codex CLI ist nicht ausführbar.",
      );
    }

    await deps.activateInstall(stagingRoot, installRoot);
    await deps.invalidateModelCatalog().catch(() => undefined);

    const after = await getStatus();
    if (!after.available || after.source !== "managed") {
      throw new CodexUpdateError(
        "UPDATE_FAILED",
        "Die aktualisierte Codex CLI konnte nicht aktiviert werden.",
      );
    }

    return {
      previousVersion: before.currentVersion,
      currentVersion,
      changed: before.currentVersion !== currentVersion,
      status: { ...after, updating: false },
    };
  } finally {
    await deps.cleanupDirectory(stagingRoot).catch(() => undefined);
  }
}

async function readCodexVersion(
  command: string,
  runner: CodexUpdaterDependencies["runProcess"],
) {
  try {
    const result = await runner(command, ["--version"], VERSION_TIMEOUT_MS);
    if (result.timedOut || result.code !== 0) return null;
    return parseCodexVersion(`${result.stdout}\n${result.stderr}`);
  } catch {
    return null;
  }
}

export function parseCodexVersion(output: string) {
  return output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] ?? null;
}

function resolveNpmCommand() {
  const candidates = ["/usr/local/bin/npm", "/usr/bin/npm"];
  return candidates.find((candidate) => existsSync(candidate)) ?? "npm";
}

async function activateManagedInstall(
  stagingRoot: string,
  installRoot: string,
) {
  const backupRoot = `${installRoot}.backup-${randomUUID()}`;
  const hadPreviousInstall = existsSync(installRoot);
  let previousMoved = false;

  try {
    if (hadPreviousInstall) {
      await rename(installRoot, backupRoot);
      previousMoved = true;
    }
    await rename(stagingRoot, installRoot);
    if (previousMoved) {
      await rm(backupRoot, { recursive: true, force: true });
    }
  } catch (error) {
    if (previousMoved && !existsSync(installRoot)) {
      await rename(backupRoot, installRoot).catch(() => undefined);
    }
    throw error;
  }
}

function updaterEnvironment() {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CI: "1",
    NO_COLOR: "1",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.OPENAI_BASE_URL;
  return childEnv;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: updaterEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-MAX_PROCESS_OUTPUT_CHARS);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_PROCESS_OUTPUT_CHARS);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

const updater = createCodexUpdater();

export function codexUpdateStatus() {
  return updater.status();
}

export function updateCodexCli() {
  return updater.update();
}
