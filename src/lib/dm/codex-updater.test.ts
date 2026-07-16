import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CodexUpdateError,
  createCodexUpdater,
  parseCodexVersion,
} from "./codex-updater";

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function result(values: Partial<RunResult> = {}): RunResult {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...values,
  };
}

describe("Codex CLI updater", () => {
  let managed = false;
  const runProcess = vi.fn();

  beforeEach(() => {
    managed = false;
    runProcess.mockReset();
  });

  function updater() {
    return createCodexUpdater({
      resolveExecutable: () =>
        managed
          ? { command: "/codex/cli/node_modules/.bin/codex", source: "managed" }
          : { command: "/app/node_modules/.bin/codex", source: "bundled" },
      managedInstallRoot: () => "/codex/cli",
      managedExecutablePath: () => "/codex/cli/node_modules/.bin/codex",
      npmCommand: "/usr/local/bin/npm",
      ensureDirectory: vi.fn().mockResolvedValue(undefined),
      stagingInstallRoot: () => "/codex/cli.update",
      activateInstall: vi.fn().mockImplementation(async () => {
        managed = true;
      }),
      cleanupDirectory: vi.fn().mockResolvedValue(undefined),
      invalidateModelCatalog: vi.fn().mockResolvedValue(undefined),
      runProcess,
    });
  }

  it("reports the active CLI version and source", async () => {
    runProcess.mockResolvedValue(result({ stdout: "codex-cli 0.134.0\n" }));

    await expect(updater().status()).resolves.toEqual({
      available: true,
      currentVersion: "0.134.0",
      source: "bundled",
      managed: false,
      canUpdate: true,
      updating: false,
    });
  });

  it("runs only the fixed allowlisted npm install and activates its version", async () => {
    runProcess.mockImplementation(
      async (command: string): Promise<RunResult> => {
        if (command === "/usr/local/bin/npm") {
          return result();
        }
        const isStaging =
          command === "/codex/cli.update/node_modules/.bin/codex";
        return result({
          stdout:
            isStaging || managed ? "codex-cli 0.144.0" : "codex-cli 0.134.0",
        });
      },
    );

    const updateResult = await updater().update();

    expect(runProcess).toHaveBeenCalledWith(
      "/usr/local/bin/npm",
      [
        "install",
        "--prefix",
        "/codex/cli.update",
        "--no-save",
        "--no-package-lock",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "@openai/codex@latest",
      ],
      180_000,
    );
    expect(updateResult).toMatchObject({
      previousVersion: "0.134.0",
      currentVersion: "0.144.0",
      changed: true,
      status: { source: "managed", updating: false },
    });
  });

  it("rejects a second concurrent update", async () => {
    let releaseInstall!: () => void;
    const installPending = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    runProcess.mockImplementation(async (command: string) => {
      if (command === "/usr/local/bin/npm") {
        await installPending;
        return result();
      }
      const isStaging = command === "/codex/cli.update/node_modules/.bin/codex";
      return result({ stdout: isStaging || managed ? "0.144.0" : "0.134.0" });
    });
    const instance = updater();

    const first = instance.update();
    await vi.waitFor(() =>
      expect(runProcess).toHaveBeenCalledWith(
        "/usr/local/bin/npm",
        expect.any(Array),
        180_000,
      ),
    );
    await expect(instance.update()).rejects.toMatchObject({
      code: "UPDATE_IN_PROGRESS",
    });
    releaseInstall();
    await first;
  });

  it("maps timeout and install failures to safe error codes", async () => {
    runProcess
      .mockResolvedValueOnce(result({ stdout: "0.134.0" }))
      .mockResolvedValueOnce(result({ timedOut: true, code: null }));

    await expect(updater().update()).rejects.toMatchObject({
      code: "UPDATE_TIMEOUT",
    });

    runProcess
      .mockResolvedValueOnce(result({ stdout: "0.134.0" }))
      .mockResolvedValueOnce(
        result({ code: 1, stderr: "secret registry detail" }),
      );
    await expect(updater().update()).rejects.toEqual(
      new CodexUpdateError(
        "UPDATE_FAILED",
        "Codex konnte nicht aktualisiert werden. Prüfe Netzwerk und Container-Logs.",
      ),
    );
  });

  it("does not replace an explicit CODEX_BIN administrator override", async () => {
    const instance = createCodexUpdater({
      resolveExecutable: () => ({
        command: "/opt/codex",
        source: "configured",
      }),
      runProcess,
    });

    await expect(instance.update()).rejects.toMatchObject({
      code: "MANAGED_UPDATE_DISABLED",
    });
    expect(runProcess).not.toHaveBeenCalled();
  });
});

describe("Codex version parsing", () => {
  it.each([
    ["codex-cli 0.144.0", "0.144.0"],
    ["codex 1.2.3-beta.1", "1.2.3-beta.1"],
    ["unknown", null],
  ])("parses %s", (output, expected) => {
    expect(parseCodexVersion(output)).toBe(expected);
  });
});
