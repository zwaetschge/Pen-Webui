import OpenAI from "openai";
import { prisma } from "./db";
import { decryptString, encryptString } from "./crypto";
import { env } from "./env";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export type OpenAIFallbackConfig = {
  apiKey: string;
  baseURL?: string;
  modelDm: string;
  keySource: "user" | "env";
};

export type OpenAIFallbackSettings = {
  hasUserKey: boolean;
  hasGlobalKey: boolean;
  userBaseUrl: string | null;
  userModelDm: string | null;
  effectiveBaseUrl: string;
  effectiveModelDm: string;
  configured: boolean;
};

/**
 * Resolve the OpenAI-compatible API fallback for a DM user.
 * Per-user Settings override env for URL/model/key; env remains the global fallback.
 *
 * Throws when no API key is available.
 */
export async function resolveOpenAIFallbackConfig(
  userId: string,
): Promise<OpenAIFallbackConfig> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      encOpenAIKey: true,
      openAIBaseUrl: true,
      openAIModelDm: true,
    },
  });

  let apiKey: string | undefined;
  let keySource: "user" | "env" = "env";
  if (user?.encOpenAIKey && user.encOpenAIKey.length > 0) {
    try {
      apiKey = await decryptString(Buffer.from(user.encOpenAIKey));
      keySource = "user";
    } catch {
      // fall through to env fallback
    }
  }

  apiKey = apiKey ?? env().OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Codex failed and API fallback is not configured. Set fallback URL/model/key in /dm/settings or define OPENAI_API_KEY.",
    );
  }

  const baseURL = cleanOptional(user?.openAIBaseUrl) ?? env().OPENAI_BASE_URL;
  const modelDm = cleanOptional(user?.openAIModelDm) ?? env().OPENAI_MODEL_DM;

  return { apiKey, baseURL, modelDm, keySource };
}

export async function openaiFallbackSettings(
  userId: string,
): Promise<OpenAIFallbackSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      encOpenAIKey: true,
      openAIBaseUrl: true,
      openAIModelDm: true,
    },
  });
  const e = env();
  const userBaseUrl = cleanOptional(user?.openAIBaseUrl) ?? null;
  const userModelDm = cleanOptional(user?.openAIModelDm) ?? null;
  const hasUserKey = !!(user?.encOpenAIKey && user.encOpenAIKey.length > 0);
  const hasGlobalKey = !!cleanOptional(e.OPENAI_API_KEY);
  return {
    hasUserKey,
    hasGlobalKey,
    userBaseUrl,
    userModelDm,
    effectiveBaseUrl: userBaseUrl ?? e.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    effectiveModelDm: userModelDm ?? e.OPENAI_MODEL_DM,
    configured: hasUserKey || hasGlobalKey,
  };
}

export async function openaiForUser(userId: string): Promise<OpenAI> {
  const config = await resolveOpenAIFallbackConfig(userId);
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}

/** Anonymous client for SRD sync, system tasks etc. — env key only. */
export function openaiSystem(): OpenAI {
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set for system client");
  return new OpenAI({ apiKey, baseURL: env().OPENAI_BASE_URL });
}

export async function setUserOpenAIKey(userId: string, plainKey: string) {
  const trimmed = plainKey.trim();
  if (trimmed.length < 1 || trimmed.length > 4096) {
    throw new Error("API key is empty or too long");
  }
  const enc = await encryptString(trimmed);
  await prisma.user.update({
    where: { id: userId },
    data: { encOpenAIKey: enc },
  });
}

export async function setUserOpenAIFallbackSettings(
  userId: string,
  values: {
    apiKey?: string;
    baseUrl?: string | null;
    modelDm?: string | null;
  },
) {
  const data: {
    encOpenAIKey?: Buffer;
    openAIBaseUrl?: string | null;
    openAIModelDm?: string | null;
  } = {};

  if (values.apiKey !== undefined && values.apiKey.trim().length > 0) {
    const trimmed = values.apiKey.trim();
    if (trimmed.length > 4096) throw new Error("API key is too long");
    data.encOpenAIKey = await encryptString(trimmed);
  }

  if (values.baseUrl !== undefined) {
    data.openAIBaseUrl = normalizeBaseUrl(values.baseUrl);
  }

  if (values.modelDm !== undefined) {
    const model = cleanOptional(values.modelDm);
    if (model && model.length > 120) throw new Error("model name is too long");
    data.openAIModelDm = model;
  }

  if (Object.keys(data).length === 0) return;
  await prisma.user.update({ where: { id: userId }, data });
}

export async function clearUserOpenAIKey(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { encOpenAIKey: null },
  });
}

function cleanOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = cleanOptional(value);
  if (!trimmed) return null;
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("API URL must start with http:// or https://");
  }
  return parsed.toString().replace(/\/$/, "");
}
