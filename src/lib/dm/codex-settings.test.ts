import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { user } }));

describe("per-DM Codex settings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("S3_ACCESS_KEY", "test");
    vi.stubEnv("S3_SECRET_KEY", "test");
    vi.stubEnv(
      "SECRET_BOX_KEY",
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    vi.stubEnv("INVITE_HMAC_SECRET", "test-invite-secret");
    vi.stubEnv("CODEX_MODEL_DM", "gpt-installation-default");
    vi.stubEnv("CODEX_REASONING_EFFORT_DM", "medium");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts exactly the supported reasoning efforts", async () => {
    const { CODEX_REASONING_EFFORTS } = await import("./codex-settings");

    expect(CODEX_REASONING_EFFORTS).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("resolves user overrides over environment defaults", async () => {
    user.findUnique.mockResolvedValue({
      codexModelDm: "gpt-5.5",
      codexReasoningEffort: "high",
    });

    const { codexDmSettings } = await import("./codex-settings");

    await expect(codexDmSettings("dm-a")).resolves.toMatchObject({
      userModel: "gpt-5.5",
      userReasoningEffort: "high",
      effectiveModel: "gpt-5.5",
      effectiveReasoningEffort: "high",
    });
    expect(user.findUnique).toHaveBeenCalledWith({
      where: { id: "dm-a" },
      select: { codexModelDm: true, codexReasoningEffort: true },
    });
  });

  it("uses environment defaults for a user without overrides", async () => {
    user.findUnique.mockResolvedValue({
      codexModelDm: null,
      codexReasoningEffort: null,
    });

    const { codexDmSettings } = await import("./codex-settings");

    await expect(codexDmSettings("dm-b")).resolves.toMatchObject({
      userModel: null,
      userReasoningEffort: null,
      effectiveModel: "gpt-installation-default",
      effectiveReasoningEffort: "medium",
    });
  });

  it("rejects a missing DM without exposing the user identifier", async () => {
    user.findUnique.mockResolvedValue(null);

    const { codexDmSettings } = await import("./codex-settings");

    await expect(codexDmSettings("missing-dm")).rejects.toThrow(
      "Codex settings user was not found",
    );
  });

  it("ignores an unsupported stored effort", async () => {
    user.findUnique.mockResolvedValue({
      codexModelDm: null,
      codexReasoningEffort: "turbo",
    });

    const { codexDmSettings } = await import("./codex-settings");

    await expect(codexDmSettings("dm-c")).resolves.toMatchObject({
      userReasoningEffort: null,
      effectiveReasoningEffort: "medium",
    });
  });

  it("normalizes default selections to null for the requested user", async () => {
    const { setUserCodexDmSettings } = await import("./codex-settings");

    await setUserCodexDmSettings("dm-a", {
      model: "auto",
      reasoningEffort: null,
    });

    expect(user.update).toHaveBeenCalledWith({
      where: { id: "dm-a" },
      data: { codexModelDm: null, codexReasoningEffort: null },
    });
  });

  it("trims a model override and persists an accepted effort", async () => {
    const { setUserCodexDmSettings } = await import("./codex-settings");

    await setUserCodexDmSettings("dm-b", {
      model: "  gpt-5.5  ",
      reasoningEffort: "xhigh",
    });

    expect(user.update).toHaveBeenCalledWith({
      where: { id: "dm-b" },
      data: { codexModelDm: "gpt-5.5", codexReasoningEffort: "xhigh" },
    });
  });

  it("rejects an overlong model name without writing", async () => {
    const { setUserCodexDmSettings } = await import("./codex-settings");

    await expect(
      setUserCodexDmSettings("dm-a", { model: "m".repeat(121) }),
    ).rejects.toThrow("Codex model name is too long");
    expect(user.update).not.toHaveBeenCalled();
  });
});
