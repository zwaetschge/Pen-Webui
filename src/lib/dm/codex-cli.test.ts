import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexManagedExecutablePath,
  resolveCodexExecutable,
} from "./codex-cli";

describe("Codex executable resolution", () => {
  it("prefers the persistent managed CLI over the bundled image CLI", () => {
    const env = { HOME: "/home/nextjs", NODE_ENV: "test" } as NodeJS.ProcessEnv;
    const managed = codexManagedExecutablePath(env);
    const existing = new Set([managed, "/app/node_modules/.bin/codex"]);

    expect(
      resolveCodexExecutable({
        env,
        cwd: "/app",
        exists: (candidate) => existing.has(candidate),
      }),
    ).toEqual({ command: managed, source: "managed" });
  });

  it("keeps an explicit administrator CODEX_BIN override authoritative", () => {
    expect(
      resolveCodexExecutable({
        env: {
          HOME: "/home/nextjs",
          NODE_ENV: "test",
          CODEX_BIN: "/opt/codex/bin/codex",
        } as NodeJS.ProcessEnv,
        exists: () => true,
      }),
    ).toEqual({
      command: "/opt/codex/bin/codex",
      source: "configured",
    });
  });

  it("falls back to the workspace binary and finally PATH", () => {
    const workspace = path.join("/workspace", "node_modules", ".bin", "codex");

    expect(
      resolveCodexExecutable({
        env: { HOME: "/home/test", NODE_ENV: "test" } as NodeJS.ProcessEnv,
        cwd: "/workspace",
        exists: (candidate) => candidate === workspace,
      }),
    ).toEqual({ command: workspace, source: "workspace" });
    expect(
      resolveCodexExecutable({
        env: { HOME: "/home/test", NODE_ENV: "test" } as NodeJS.ProcessEnv,
        cwd: "/workspace",
        exists: () => false,
      }),
    ).toEqual({ command: "codex", source: "path" });
  });
});
