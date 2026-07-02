import OpenAI from "openai";
import type { SRDRecord } from "./types";

const MODEL = process.env.OPENAI_MODEL_EMBEDDING ?? "text-embedding-3-large";
const BATCH = 96;

/**
 * Embed a batch of SRD records.  Each record's text is built from its name,
 * type label, structured metadata, and body (truncated for token safety).
 * Returns a parallel array of embedding vectors (length 3072 for
 * text-embedding-3-large).
 */
export async function embedRecords(
  client: OpenAI,
  records: SRDRecord[],
): Promise<number[][]> {
  if (records.length === 0) return [];

  const inputs = records.map(buildEmbeddingInput);
  const out: number[][] = new Array(records.length);

  for (let i = 0; i < inputs.length; i += BATCH) {
    const slice = inputs.slice(i, i + BATCH);
    const resp = await client.embeddings.create({
      model: MODEL,
      input: slice,
      encoding_format: "float",
    });
    resp.data.forEach((e, j) => {
      out[i + j] = e.embedding as number[];
    });
  }

  return out;
}

function buildEmbeddingInput(r: SRDRecord): string {
  const metaLines = r.data
    ? Object.entries(r.data)
        .slice(0, 12)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  // Embedding model limit is ~8k tokens; SRD entries are nearly always far
  // below that, but truncate defensively at ~24k chars (~6k tokens).
  const body = r.content.slice(0, 24_000);

  return [`[${r.type}] ${r.name}`, metaLines, body].filter(Boolean).join("\n\n");
}
