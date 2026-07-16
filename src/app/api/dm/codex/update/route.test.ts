import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireDM: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN_NOT_DM") {
      super(code);
    }
  },
}));
const updater = vi.hoisted(() => ({
  status: vi.fn(),
  update: vi.fn(),
  CodexUpdateError: class CodexUpdateError extends Error {
    constructor(
      public code:
        | "UPDATE_IN_PROGRESS"
        | "MANAGED_UPDATE_DISABLED"
        | "UPDATE_TIMEOUT"
        | "UPDATE_FAILED",
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/auth", () => ({
  requireDM: auth.requireDM,
  AuthError: auth.AuthError,
}));
vi.mock("@/lib/dm/codex-updater", () => ({
  codexUpdateStatus: updater.status,
  updateCodexCli: updater.update,
  CodexUpdateError: updater.CodexUpdateError,
}));

const status = {
  available: true,
  currentVersion: "0.134.0",
  source: "bundled",
  managed: false,
  canUpdate: true,
  updating: false,
};

describe("DM Codex update route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    auth.requireDM.mockResolvedValue({ id: "dm-a", isDM: true });
    updater.status.mockResolvedValue(status);
    updater.update.mockResolvedValue({
      previousVersion: "0.134.0",
      currentVersion: "0.144.0",
      changed: true,
      status: { ...status, currentVersion: "0.144.0", source: "managed" },
    });
  });

  it("returns the active version only to a DM", async () => {
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status });
    expect(auth.requireDM).toHaveBeenCalledOnce();
  });

  it("updates with no user-controlled command input", async () => {
    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        previousVersion: "0.134.0",
        currentVersion: "0.144.0",
        changed: true,
      },
    });
    expect(updater.update).toHaveBeenCalledWith();
  });

  it.each([
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN_NOT_DM", 403],
  ] as const)("maps %s auth failures", async (code, expectedStatus) => {
    auth.requireDM.mockRejectedValue(new auth.AuthError(code));
    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
    expect(updater.update).not.toHaveBeenCalled();
  });

  it.each([
    ["UPDATE_IN_PROGRESS", 409],
    ["MANAGED_UPDATE_DISABLED", 409],
    ["UPDATE_TIMEOUT", 504],
    ["UPDATE_FAILED", 502],
  ] as const)("maps updater error %s", async (code, expectedStatus) => {
    updater.update.mockRejectedValue(
      new updater.CodexUpdateError(code, "safe public message"),
    );
    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code, message: "safe public message" },
    });
  });

  it("does not expose unexpected process or registry errors", async () => {
    updater.update.mockRejectedValue(
      new Error("registry token npm_secret must not escape"),
    );
    const { POST } = await import("./route");
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("npm_secret");
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
