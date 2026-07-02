import { z } from "zod";
import { env } from "@/lib/env";
import type { VocariumVoice } from "./types";

const voiceListResponseSchema = z.object({
  voices: z.array(
    z.object({
      voice_id: z.string().min(1),
      name: z.string().min(1),
      language: z.string().nullable().optional(),
      source: z.string(),
    }),
  ),
});

export class VocariumError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "VocariumError";
  }
}

export async function listCloneVoices(
  vocariumUser: string,
): Promise<VocariumVoice[]> {
  const response = await vocariumFetch("/v1/voices?source=clone", {
    method: "GET",
    vocariumUser,
  });
  const json = await response.json().catch(() => null);
  const parsed = voiceListResponseSchema.safeParse(json);
  if (!parsed.success) throw new VocariumError("invalid_voice_response");

  return parsed.data.voices
    .filter((voice) => voice.source === "clone")
    .map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      language: voice.language ?? null,
      source: "clone",
      vocariumUser,
    }));
}

export async function synthesizeCloneSpeech(input: {
  vocariumUser: string;
  voiceId: string;
  text: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await vocariumFetch("/v1/audio/speech", {
    method: "POST",
    vocariumUser: input.vocariumUser,
    body: JSON.stringify({
      model: "tts-1",
      input: input.text,
      voice: input.voiceId,
      response_format: "wav",
    }),
    headers: { "Content-Type": "application/json" },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new VocariumError("empty_audio_response");
  return {
    bytes,
    mimeType: response.headers.get("content-type") ?? "audio/wav",
  };
}

async function vocariumFetch(
  path: string,
  opts: {
    method: "GET" | "POST";
    vocariumUser: string;
    headers?: Record<string, string>;
    body?: BodyInit;
  },
) {
  const base = env().VOCARIUM_API_URL.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    method: opts.method,
    headers: {
      "Remote-User": opts.vocariumUser,
      ...(opts.headers ?? {}),
    },
    body: opts.body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new VocariumError(`vocarium_${response.status}`, response.status);
  }
  return response;
}
