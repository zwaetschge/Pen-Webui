import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export const CODEX_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type CodexReasoningEffort =
  (typeof CODEX_REASONING_EFFORTS)[number];

export type CodexDmSettings = {
  userModel: string | null;
  userReasoningEffort: CodexReasoningEffort | null;
  effectiveModel: string;
  effectiveReasoningEffort: CodexReasoningEffort;
};

export async function codexDmSettings(
  userId: string,
): Promise<CodexDmSettings> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { codexModelDm: true, codexReasoningEffort: true },
  });
  if (!row) {
    throw new Error("Codex settings user was not found");
  }
  const userModel = normalizeModel(row.codexModelDm);
  const userReasoningEffort = normalizeEffort(row.codexReasoningEffort);

  return {
    userModel,
    userReasoningEffort,
    effectiveModel: userModel ?? env().CODEX_MODEL_DM,
    effectiveReasoningEffort:
      userReasoningEffort ?? env().CODEX_REASONING_EFFORT_DM,
  };
}

export async function setUserCodexDmSettings(
  userId: string,
  values: {
    model?: string | null;
    reasoningEffort?: CodexReasoningEffort | null;
  },
): Promise<void> {
  const data: {
    codexModelDm?: string | null;
    codexReasoningEffort?: string | null;
  } = {};

  if (values.model !== undefined) {
    data.codexModelDm = normalizeModel(values.model);
  }
  if (values.reasoningEffort !== undefined) {
    data.codexReasoningEffort = values.reasoningEffort;
  }
  if (Object.keys(data).length > 0) {
    await prisma.user.update({ where: { id: userId }, data });
  }
}

function normalizeModel(value: string | null | undefined) {
  const model = value?.trim();
  if (!model || ["auto", "default"].includes(model.toLowerCase())) {
    return null;
  }
  if (model.length > 120) {
    throw new Error("Codex model name is too long");
  }
  return model;
}

function normalizeEffort(value: string | null | undefined) {
  return CODEX_REASONING_EFFORTS.find((effort) => effort === value) ?? null;
}
