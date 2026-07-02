import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDM, AuthError } from "@/lib/auth";
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

const schema = z.object({
  openaiKey: z.string().optional(),
  openaiBaseUrl: z.string().nullable().optional(),
  openaiModelDm: z.string().nullable().optional(),
  clearKey: z.boolean().optional(),
});

export async function GET() {
  try {
    const user = await requireDM();
    const e = env();
    const [fallback, codex] = await Promise.all([
      openaiFallbackSettings(user.id),
      codexLoginStatus(),
    ]);
    return NextResponse.json({
      llm: {
        provider: e.DM_LLM_PROVIDER,
        codexModel: e.CODEX_MODEL_DM,
        apiFallbackModel: fallback.effectiveModelDm,
      },
      assets: {
        provider: e.ASSET_IMAGE_PROVIDER,
      },
      codex,
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
    await setUserOpenAIFallbackSettings(user.id, {
      apiKey: body.openaiKey,
      baseUrl: body.openaiBaseUrl,
      modelDm: body.openaiModelDm,
    });
    const fallback = await openaiFallbackSettings(user.id);
    return NextResponse.json({
      ok: true,
      fallback,
      hasOpenAIKey: fallback.hasUserKey,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.code }, { status: 401 });
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
