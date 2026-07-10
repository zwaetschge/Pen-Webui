import { z } from "zod";

type SettingsFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const codexReasoningEffortSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const codexRuntimeSchema = z.object({
  userModel: z.string().nullable(),
  userReasoningEffort: codexReasoningEffortSchema.nullable(),
  effectiveModel: z.string(),
  effectiveReasoningEffort: codexReasoningEffortSchema,
});

const fallbackSchema = z.object({
  hasUserKey: z.boolean(),
  hasGlobalKey: z.boolean(),
  userBaseUrl: z.string().nullable(),
  userModelDm: z.string().nullable(),
  effectiveBaseUrl: z.string(),
  effectiveModelDm: z.string(),
  configured: z.boolean(),
});

const settingsStateSchema = z.object({
  hasOpenAIKey: z.boolean(),
  hasGlobalOpenAIKey: z.boolean(),
  llm: z.object({
    provider: z.enum(["codex-cli", "openai-api"]),
    codexModel: z.string(),
    apiFallbackModel: z.string(),
  }),
  assets: z.object({
    provider: z.enum(["codex-cli", "openai-api"]),
  }),
  codex: z.object({
    available: z.boolean(),
    authenticated: z.boolean(),
    detail: z.string(),
  }),
  codexRuntime: codexRuntimeSchema,
  fallback: fallbackSchema,
  terminal: z.object({
    enabled: z.boolean(),
    idleMinutes: z.number(),
  }),
});

const settingsMutationResponseSchema = z.object({
  ok: z.literal(true),
  fallback: fallbackSchema,
  codexRuntime: codexRuntimeSchema,
  hasOpenAIKey: z.boolean(),
});

export type SettingsState = z.infer<typeof settingsStateSchema>;
export type SettingsMutationResponse = z.infer<
  typeof settingsMutationResponseSchema
>;

type MutationRequestInit = RequestInit & { method: "POST" };

export function requestSettings(
  init?: undefined,
  fetcher?: SettingsFetcher,
): Promise<SettingsState>;
export function requestSettings(
  init: MutationRequestInit,
  fetcher?: SettingsFetcher,
): Promise<SettingsMutationResponse>;
export async function requestSettings(
  init?: RequestInit,
  fetcher: SettingsFetcher = fetch,
): Promise<SettingsState | SettingsMutationResponse> {
  let response: Response;

  try {
    response = await fetcher("/api/dm/settings", init);
  } catch (cause) {
    throw new Error("Unable to reach the settings service. Try again.", {
      cause,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    const message = response.ok
      ? "The settings service returned an invalid response."
      : `Settings request failed (${response.status}).`;
    throw new Error(message, { cause });
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Settings request failed (${response.status}).`;
    throw new Error(message);
  }

  const responseSchema =
    init?.method?.toUpperCase() === "POST"
      ? settingsMutationResponseSchema
      : settingsStateSchema;
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("The settings service returned an invalid response.");
  }

  return parsed.data;
}

export type SettingsRequestGate = {
  acquire(): boolean;
  release(): void;
};

export function createSettingsRequestGate(): SettingsRequestGate {
  let active = false;

  return {
    acquire() {
      if (active) return false;
      active = true;
      return true;
    },
    release() {
      active = false;
    },
  };
}
