/**
 * Asset generation is gpt-image-2 only.
 *
 * The preferred runtime is Codex CLI image generation so self-hosted installs
 * can use the same ChatGPT/Codex entitlement as the DM loop. The direct OpenAI
 * Images API remains as an explicit/fallback path for installs that provide an
 * API key.
 */

import { env } from "../env";
import { logger } from "../logger";
import { generateCodexImage } from "./codex-image";
import { generateOpenAIImage } from "./openai-image";

export type GenResult = {
  png: Buffer;
  backend: "codex-cli" | "openai";
};

export async function generateAsset(opts: {
  prompt: string;
  negativePrompt?: string;
  kind: string;
  openai?: {
    apiKey: string;
    baseURL?: string;
  };
}): Promise<GenResult> {
  if (env().ASSET_IMAGE_PROVIDER === "openai-api") {
    return generateOpenAIAsset(opts);
  }

  try {
    return await generateCodexImage({
      prompt: opts.prompt,
      kind: opts.kind,
    });
  } catch (codexError) {
    logger.warn(
      { err: formatError(codexError) },
      "Codex CLI image generation failed; trying OpenAI API fallback",
    );
    try {
      return await generateOpenAIAsset(opts);
    } catch (apiError) {
      throw new Error(
        `Codex CLI image generation failed (${formatError(
          codexError,
        )}); OpenAI API fallback failed (${formatError(apiError)})`,
      );
    }
  }
}

function generateOpenAIAsset(opts: {
  prompt: string;
  kind: string;
  openai?: {
    apiKey: string;
    baseURL?: string;
  };
}) {
  return generateOpenAIImage({
    prompt: opts.prompt,
    kind: opts.kind,
    apiKey: opts.openai?.apiKey,
    baseURL: opts.openai?.baseURL,
  });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
