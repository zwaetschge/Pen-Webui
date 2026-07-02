import OpenAI from "openai";
import { env } from "../env";
import { openaiSize } from "./dimensions";

export const OPENAI_IMAGE_MODEL = "gpt-image-2";

export type ImageGenResult = {
  png: Buffer;
  backend: "openai";
};

/** Generate a single image via the OpenAI Images API fallback. */
export async function generateOpenAIImage(opts: {
  prompt: string;
  kind: string;
  apiKey?: string;
  baseURL?: string;
}): Promise<ImageGenResult> {
  const apiKey = opts.apiKey ?? env().OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenAI API image fallback requires an API key; add one in /dm/settings or set OPENAI_API_KEY.",
    );
  }
  const client = new OpenAI({
    apiKey,
    baseURL: opts.baseURL ?? env().OPENAI_BASE_URL,
  });

  const resp = await client.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt: opts.prompt,
    size: openaiSize(opts.kind),
    n: 1,
  });

  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai image response missing b64_json");
  return { png: Buffer.from(b64, "base64"), backend: "openai" };
}
