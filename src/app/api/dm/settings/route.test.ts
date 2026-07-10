import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireDM: vi.fn(),
  AuthError: class AuthError extends Error {
    code = "auth_error";
  },
}));
const fallback = vi.hoisted(() => ({
  clearUserOpenAIKey: vi.fn(),
  openaiFallbackSettings: vi.fn(),
  setUserOpenAIFallbackSettings: vi.fn(),
}));
const codexSettings = vi.hoisted(() => ({
  codexDmSettings: vi.fn(),
  setUserCodexDmSettings: vi.fn(),
}));
const codex = vi.hoisted(() => ({ codexLoginStatus: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  requireDM: auth.requireDM,
  AuthError: auth.AuthError,
}));

vi.mock("@/lib/openai", () => fallback);

vi.mock("@/lib/dm/codex-settings", () => codexSettings);

vi.mock("@/lib/dm/llm", () => ({ codexLoginStatus: codex.codexLoginStatus }));

vi.mock("@/lib/dm/terminal", () => ({
  terminalSettings: () => ({ enabled: false, idleMinutes: 30 }),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({
    DM_LLM_PROVIDER: "codex-cli",
    CODEX_MODEL_DM: "gpt-installation-default",
    ASSET_IMAGE_PROVIDER: "codex-cli",
  }),
}));

const fallbackState = {
  hasUserKey: false,
  hasGlobalKey: true,
  userBaseUrl: null,
  userModelDm: null,
  effectiveBaseUrl: "https://api.openai.com/v1",
  effectiveModelDm: "gpt-api-default",
  configured: true,
};

const codexRuntime = {
  userModel: "gpt-5.5",
  userReasoningEffort: "high",
  effectiveModel: "gpt-5.5",
  effectiveReasoningEffort: "high",
};

function post(body: unknown) {
  return new Request("http://app/api/dm/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DM settings route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    auth.requireDM.mockResolvedValue({ id: "dm-a" });
    fallback.openaiFallbackSettings.mockResolvedValue(fallbackState);
    codexSettings.codexDmSettings.mockResolvedValue(codexRuntime);
    codex.codexLoginStatus.mockResolvedValue({
      available: true,
      authenticated: true,
      detail: "logged in",
    });
  });

  it("returns user and effective Codex settings in the runtime summary", async () => {
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.codexRuntime).toEqual(codexRuntime);
    expect(body.llm.codexModel).toBe(codexRuntime.effectiveModel);
    expect(codexSettings.codexDmSettings).toHaveBeenCalledWith("dm-a");
  });

  it("saves valid Codex overrides and returns their effective values", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      post({ codexModelDm: "gpt-5.5", codexReasoningEffort: "high" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(codexSettings.setUserCodexDmSettings).toHaveBeenCalledWith("dm-a", {
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(codexSettings.codexDmSettings).toHaveBeenCalledWith("dm-a");
    expect(body.codexRuntime).toEqual(codexRuntime);
    expect(fallback.setUserOpenAIFallbackSettings).not.toHaveBeenCalled();
  });

  it("resets Codex overrides without changing API fallback settings", async () => {
    const installationDefaults = {
      userModel: null,
      userReasoningEffort: null,
      effectiveModel: "gpt-installation-default",
      effectiveReasoningEffort: "medium",
    };
    codexSettings.codexDmSettings.mockResolvedValue(installationDefaults);
    const { POST } = await import("./route");

    const response = await POST(
      post({ codexModelDm: null, codexReasoningEffort: null }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(codexSettings.setUserCodexDmSettings).toHaveBeenCalledWith("dm-a", {
      model: null,
      reasoningEffort: null,
    });
    expect(body.codexRuntime).toEqual(installationDefaults);
    expect(fallback.setUserOpenAIFallbackSettings).not.toHaveBeenCalled();
    expect(fallback.clearUserOpenAIKey).not.toHaveBeenCalled();
  });

  it("rejects an invalid Codex effort before persistence", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      post({ codexModelDm: "gpt-5.5", codexReasoningEffort: "maximum" }),
    );

    expect(response.status).toBe(400);
    expect(codexSettings.setUserCodexDmSettings).not.toHaveBeenCalled();
    expect(fallback.setUserOpenAIFallbackSettings).not.toHaveBeenCalled();
    expect(fallback.clearUserOpenAIKey).not.toHaveBeenCalled();
  });

  it("returns 401 on DM auth rejection without calling persistence", async () => {
    auth.requireDM.mockRejectedValue(new auth.AuthError());
    const { POST } = await import("./route");

    const response = await POST(
      post({
        openaiModelDm: "gpt-api-custom",
        codexModelDm: "gpt-5.5",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "auth_error" });
    expect(fallback.setUserOpenAIFallbackSettings).not.toHaveBeenCalled();
    expect(codexSettings.setUserCodexDmSettings).not.toHaveBeenCalled();
    expect(fallback.clearUserOpenAIKey).not.toHaveBeenCalled();
  });

  it("keeps fallback-only saves independent from Codex settings", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      post({
        openaiBaseUrl: "https://fallback.example/v1",
        openaiModelDm: "gpt-api-custom",
      }),
    );

    expect(response.status).toBe(200);
    expect(fallback.setUserOpenAIFallbackSettings).toHaveBeenCalledWith(
      "dm-a",
      {
        apiKey: undefined,
        baseUrl: "https://fallback.example/v1",
        modelDm: "gpt-api-custom",
      },
    );
    expect(codexSettings.setUserCodexDmSettings).not.toHaveBeenCalled();
  });
});
