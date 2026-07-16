import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export type CodexExecutableSource =
  | "configured"
  | "managed"
  | "bundled"
  | "workspace"
  | "path";

export type ResolvedCodexExecutable = {
  command: string;
  source: CodexExecutableSource;
};

type ResolverOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  exists?: (candidate: string) => boolean;
};

export function codexHome(env: NodeJS.ProcessEnv = process.env) {
  if (env.CODEX_HOME?.trim()) return path.resolve(env.CODEX_HOME.trim());
  if (env.HOME?.trim())
    return path.join(path.resolve(env.HOME.trim()), ".codex");

  const home = homedir();
  return home && home !== "/"
    ? path.join(home, ".codex")
    : path.join(tmpdir(), ".codex");
}

export function codexManagedInstallRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.join(codexHome(env), "cli");
}

export function codexManagedExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
) {
  return path.join(
    codexManagedInstallRoot(env),
    "node_modules",
    ".bin",
    "codex",
  );
}

/**
 * Resolve the Codex CLI used by both the DM loop and the asset worker.
 *
 * CODEX_BIN is an explicit administrator override. Otherwise the writable,
 * persistent managed install is preferred over the immutable image copy.
 */
export function resolveCodexExecutable(
  options: ResolverOptions = {},
): ResolvedCodexExecutable {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const configured = env.CODEX_BIN?.trim();

  if (configured) {
    return { command: configured, source: "configured" };
  }

  const candidates: ResolvedCodexExecutable[] = [
    {
      command: codexManagedExecutablePath(env),
      source: "managed",
    },
    { command: "/app/node_modules/.bin/codex", source: "bundled" },
    {
      command: path.join(cwd, "node_modules", ".bin", "codex"),
      source: "workspace",
    },
  ];

  return (
    candidates.find((candidate) => exists(candidate.command)) ?? {
      command: "codex",
      source: "path",
    }
  );
}
