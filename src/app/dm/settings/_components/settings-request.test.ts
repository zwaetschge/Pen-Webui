import { describe, expect, it, vi } from "vitest";
import {
  codexEffortPickerState,
  createSettingsRequestGate,
  requestSettings,
  type SettingsState,
} from "./settings-request";

const validSettingsState = {
  hasOpenAIKey: false,
  hasGlobalOpenAIKey: true,
  llm: {
    provider: "codex-cli",
    codexModel: "gpt-5.5",
    apiFallbackModel: "gpt-5.4",
  },
  assets: { provider: "codex-cli" },
  codex: {
    available: true,
    authenticated: true,
    detail: "logged in",
  },
  codexRuntime: {
    userModel: null,
    userReasoningEffort: null,
    effectiveModel: "gpt-5.5",
    effectiveReasoningEffort: "high",
  },
  codexModels: {
    available: true,
    detail: "Models reported by Codex.",
    models: [
      {
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "Frontier model",
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Balanced" },
          { reasoningEffort: "high", description: "Deeper" },
        ],
        defaultReasoningEffort: "medium",
      },
    ],
  },
  fallback: {
    hasUserKey: false,
    hasGlobalKey: true,
    userBaseUrl: null,
    userModelDm: null,
    effectiveBaseUrl: "https://api.openai.com/v1",
    effectiveModelDm: "gpt-5.4",
    configured: true,
  },
  terminal: { enabled: false, idleMinutes: 30 },
} satisfies SettingsState;

const validMutationResponse = {
  ok: true,
  fallback: validSettingsState.fallback,
  codexRuntime: validSettingsState.codexRuntime,
  hasOpenAIKey: false,
};

describe("requestSettings", () => {
  it("rejects an empty successful settings response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(requestSettings(undefined, fetcher)).rejects.toThrow(
      "invalid response",
    );
  });

  it("rejects a successful settings response missing a nested field", async () => {
    const missingFallback = { ...validSettingsState, fallback: undefined };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(missingFallback), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(requestSettings(undefined, fetcher)).rejects.toThrow(
      "invalid response",
    );
  });

  it("rejects a successful mutation response missing a nested field", async () => {
    const missingCodexRuntime = {
      ...validMutationResponse,
      codexRuntime: undefined,
    };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(missingCodexRuntime), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(requestSettings({ method: "POST" }, fetcher)).rejects.toThrow(
      "invalid response",
    );
  });

  it("rejects an error response instead of returning it as settings", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: "Settings temporarily unavailable" }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    await expect(requestSettings(undefined, fetcher)).rejects.toThrow(
      "Settings temporarily unavailable",
    );
  });

  it("reports a network failure", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(requestSettings(undefined, fetcher)).rejects.toThrow(
      "Unable to reach the settings service",
    );
  });
});

describe("createSettingsRequestGate", () => {
  it("blocks another request until the active request releases the gate", () => {
    const gate = createSettingsRequestGate();

    expect(gate.acquire()).toBe(true);
    expect(gate.acquire()).toBe(false);

    gate.release();

    expect(gate.acquire()).toBe(true);
  });
});

describe("codexEffortPickerState", () => {
  it("keeps a saved effort supported by the selected model", () => {
    expect(
      codexEffortPickerState({
        ...validSettingsState,
        codexRuntime: {
          ...validSettingsState.codexRuntime,
          userReasoningEffort: "high" as const,
        },
      }),
    ).toEqual({ value: "high", unsupported: null });
  });

  it("resets a legacy saved effort missing from the current /model entry", () => {
    expect(
      codexEffortPickerState({
        ...validSettingsState,
        codexRuntime: {
          ...validSettingsState.codexRuntime,
          userReasoningEffort: "minimal" as const,
        },
      }),
    ).toEqual({ value: "", unsupported: "minimal" });
  });
});
