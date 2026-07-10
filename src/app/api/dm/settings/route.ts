import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDM, AuthError } from "@/lib/auth";
import {
  codexDmSettings,
  setUserCodexDmSettings,
} from "@/lib/dm/codex-settings";
import { terminalSettings } from "@/lib/dm/terminal";
import { codexLoginStatus } from "@/lib/dm/llm";
import { env } from "@/lib/env";
import {
  clearUserOpenAIKey,
  openaiFallbackSettings,
  setUserOpenAIFallbackSettings,
} from "@/lib/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reasoningEffortSchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const schema = z.object({
  openaiKey: z.string().optional(),
  openaiBaseUrl: z.string().nullable().optional(),
  openaiModelDm: z.string().nullable().optional(),
  clearKey: z.boolean().optional(),
  codexModelDm: z.string().max(120).nullable().optional(),
  codexReasoningEffort: reasoningEffortSchema.nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireDM();
    const e = env();
    const [fallback, codex, codexRuntime] = await Promise.all([
      openaiFallbackSettings(user.id),
      codexLoginStatus(),
      codexDmSettings(user.id),
    ]);
    return NextResponse.json({
      llm: {
        provider: e.DM_LLM_PROVIDER,
        codexModel: codexRuntime.effectiveModel,
        apiFallbackModel: fallback.effectiveModelDm,
      },
      assets: {
        provider: e.ASSET_IMAGE_PROVIDER,
      },
      codex,
      codexRuntime,
      fallback,
      hasOpenAIKey: fallback.hasUserKey,
      hasGlobalOpenAIKey: fallback.hasGlobalKey,
      terminal: terminalSettings(),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireDM();
    const body = schema.parse(await req.json());

    if (body.clearKey) {
      await clearUserOpenAIKey(user.id);
    }
    if (
      body.openaiKey !== undefined ||
      body.openaiBaseUrl !== undefined ||
      body.openaiModelDm !== undefined
    ) {
      await setUserOpenAIFallbackSettings(user.id, {
        apiKey: body.openaiKey,
        baseUrl: body.openaiBaseUrl,
        modelDm: body.openaiModelDm,
      });
    }
    if (
      body.codexModelDm !== undefined ||
      body.codexReasoningEffort !== undefined
    ) {
      await setUserCodexDmSettings(user.id, {
        model: body.codexModelDm,
        reasoningEffort: body.codexReasoningEffort,
      });
    }
    const [fallback, codexRuntime] = await Promise.all([
      openaiFallbackSettings(user.id),
      codexDmSettings(user.id),
    ]);
    return NextResponse.json({
      ok: true,
      fallback,
      codexRuntime,
      hasOpenAIKey: fallback.hasUserKey,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
