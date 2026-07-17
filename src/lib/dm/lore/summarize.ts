import { createHash } from "node:crypto";
import { z } from "zod";

import { completeDmJsonObject } from "../llm";
import {
  loreBibleSchema,
  type LoreBible,
  type PreparedLoreSource,
} from "./types";
import type { LoreResearchHit } from "./research";

type LoreBibleInput = {
  theme: string;
  sourceNotes?: string;
  uploadedSources: PreparedLoreSource[];
  researchHits: LoreResearchHit[];
};

const MAX_UPLOAD_CHARS_PER_SUMMARY_CHUNK = 12_000;
const MAX_LLM_CONCURRENCY = 2;
const MAX_CHUNK_SUMMARIES_PER_MERGE = 8;
const MAX_RESEARCH_TITLE_CHARS = 240;
const MAX_RESEARCH_SNIPPET_CHARS = 1_500;
const MAX_RESEARCH_CITATION_NOTE_CHARS = 500;

export async function buildLoreBible(
  userId: string,
  input: LoreBibleInput,
): Promise<LoreBible> {
  if (input.uploadedSources.length === 0 && input.researchHits.length === 0) {
    return loreBibleSchema.parse({});
  }

  const sources = [
    ...input.uploadedSources.map(serializePreparedSourceForModel),
  ];
  const sourceKeys = new Set(sources.map(sourceIdentity));

  for (const researchHit of input.researchHits) {
    const researchSource = convertResearchHitToSource(researchHit);
    const key = sourceIdentity(researchSource);
    if (!sourceKeys.has(key)) {
      sourceKeys.add(key);
      sources.push(serializePreparedSourceForModel(researchSource));
    }
  }

  const parsed = await completeDmJsonObject({
    userId,
    temperature: 0.2,
    maxCompletionTokens: 2600,
    system: LORE_BIBLE_PROMPT,
    user: JSON.stringify({
      theme: input.theme,
      sourceNotes: input.sourceNotes ?? "",
      sources,
    }),
    outputSchema: loreBibleOutputSchema,
  });

  return loreBibleSchema.parse(parsed);
}

export async function summarizePreparedSources(
  userId: string,
  input: LoreBibleInput,
): Promise<PreparedLoreSource[]> {
  const runLimitedLlmCall = createConcurrencyLimiter(MAX_LLM_CONCURRENCY);
  const uploadedSources = await mapWithConcurrency(
    input.uploadedSources,
    MAX_LLM_CONCURRENCY,
    (source) => summarizeUploadSource(userId, input, source, runLimitedLlmCall),
  );

  const researchSources = input.researchHits.map(convertResearchHitToSource);

  return [...uploadedSources, ...researchSources];
}

const LORE_BIBLE_PROMPT = [
  "Build a compact tabletop campaign lore bible from private uploaded text and public research snippets.",
  "Preserve names, places, relationships, tone, and hard canon facts.",
  "Use the provided source objects, keeping kind, summary, facts, citations, sourceUrl, and rawText only for private uploads.",
  "Do not invent certainty. Put uncertain or conflicting information in uncertainties.",
  "Return only JSON matching the schema.",
].join("\n");

const UPLOAD_SOURCE_SUMMARY_PROMPT = [
  "Summarize one uploaded lore source for tabletop campaign preparation.",
  "Preserve exact names, places, relationships, chronology, and hard canon details from the source text.",
  "Do not use outside knowledge and do not invent missing facts.",
  "Write a concise summary, extract concrete facts, and include citations tied to the uploaded source title.",
  "Return only JSON matching the schema.",
].join("\n");

const UPLOAD_SOURCE_SYNTHESIS_PROMPT = [
  "Combine chunk summaries from one uploaded lore source into a single source summary for tabletop campaign preparation.",
  "Preserve exact names, places, relationships, chronology, and hard canon details from the chunk summaries.",
  "Do not invent missing facts and do not use outside knowledge.",
  "Work only from the provided chunk summaries, facts, and citations.",
  "Return only JSON matching the schema.",
].join("\n");

const uploadSourceFactSchema = z.preprocess(
  normalizeUploadSourceFact,
  z.string().trim().min(1),
);

const uploadSourceCitationSchema = z.object({
  title: z.string(),
  note: z.string(),
});

const uploadSourceSummarySchema = z.object({
  summary: z.string(),
  facts: z.array(uploadSourceFactSchema).default([]),
  citations: z.array(uploadSourceCitationSchema).default([]),
});
type UploadSourceSummary = z.infer<typeof uploadSourceSummarySchema>;
type ConcurrencyLimiter = <T>(task: () => Promise<T>) => Promise<T>;

function normalizeUploadSourceFact(value: unknown) {
  if (typeof value === "string" || !isRecord(value)) return value;

  for (const key of [
    "fact",
    "text",
    "statement",
    "claim",
    "description",
    "summary",
    "value",
  ]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const scalarValues = Object.values(value)
    .filter(
      (entry): entry is string | number | boolean =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean",
    )
    .map(String)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return scalarValues.length > 0 ? scalarValues.join(" — ") : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const uploadSourceSummaryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    facts: { type: "array", items: { type: "string" } },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          note: { type: "string" },
        },
        required: ["title", "note"],
      },
    },
  },
  required: ["summary", "facts", "citations"],
} as const;

const loreBibleOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceTitles: { type: "array", items: { type: "string" } },
    canonFacts: { type: "array", items: { type: "string" } },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          notes: { type: "string" },
        },
        required: ["name", "role", "notes"],
      },
    },
    locations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          notes: { type: "string" },
        },
        required: ["name", "notes"],
      },
    },
    timeline: { type: "array", items: { type: "string" } },
    toneAndThemes: { type: "array", items: { type: "string" } },
    adaptationRules: { type: "array", items: { type: "string" } },
    forbiddenContradictions: { type: "array", items: { type: "string" } },
    campaignHooks: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: ["string", "null"], format: "uri" },
          note: { type: "string" },
        },
        required: ["title", "note"],
      },
    },
  },
  required: [
    "sourceTitles",
    "canonFacts",
    "characters",
    "locations",
    "timeline",
    "toneAndThemes",
    "adaptationRules",
    "forbiddenContradictions",
    "campaignHooks",
    "uncertainties",
    "citations",
  ],
} as const;

function serializePreparedSourceForModel(source: PreparedLoreSource) {
  const hasStructuredSummary =
    source.summary.trim().length > 0 ||
    source.facts.some((fact) => fact.trim().length > 0) ||
    source.citations.length > 0;
  const includeRawText =
    source.kind === "upload" &&
    source.rawText !== undefined &&
    source.rawText.length <= MAX_UPLOAD_CHARS_PER_SUMMARY_CHUNK &&
    !hasStructuredSummary;

  return {
    kind: source.kind,
    title: source.title,
    summary: source.summary,
    facts: source.facts,
    citations: source.citations.map((citation) => ({
      title: citation.title,
      url: citation.url ?? null,
      note: citation.note,
    })),
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
    ...(includeRawText ? { rawText: source.rawText } : {}),
  };
}

function sourceIdentity(source: {
  kind: PreparedLoreSource["kind"];
  title: string;
  sourceUrl?: string;
  rawText?: string;
}) {
  return [
    source.kind,
    source.title,
    source.sourceUrl ?? "",
    source.rawText ?? "",
  ].join("\u0000");
}

function convertResearchHitToSource(hit: LoreResearchHit): PreparedLoreSource {
  const normalized = normalizeResearchHit(hit);
  const snippet = normalized.snippet;

  return {
    kind: "web_research",
    title: normalized.title,
    sourceUrl: normalized.url,
    summary: snippet,
    facts: snippet ? [snippet] : [],
    citations: [
      {
        title: normalized.title,
        url: normalized.url,
        note: normalized.citationNote,
      },
    ],
    contentHash: createHash("sha256")
      .update(
        [
          normalized.title,
          normalized.url ?? "",
          normalized.snippet,
          normalized.siteName ?? "",
          normalized.publishedAt ?? "",
        ].join("\u0000"),
        "utf8",
      )
      .digest("hex"),
  };
}

async function summarizeUploadSource(
  userId: string,
  input: LoreBibleInput,
  source: PreparedLoreSource,
  runLimitedLlmCall: ConcurrencyLimiter,
): Promise<PreparedLoreSource> {
  if (!source.rawText || source.summary.trim().length > 0) {
    return { ...source };
  }

  const chunks = chunkLoreText(source.rawText, MAX_UPLOAD_CHARS_PER_SUMMARY_CHUNK);
  const chunkSummaries = await mapWithConcurrency(
    chunks,
    MAX_LLM_CONCURRENCY,
    (rawText, chunkIndex) =>
      summarizeUploadChunk(
        userId,
        input,
        source.title,
        rawText,
        chunkIndex,
        chunks.length,
        runLimitedLlmCall,
      ),
  );

  const parsed = await synthesizeUploadSummaryBatches(
    userId,
    input,
    source.title,
    chunkSummaries,
    runLimitedLlmCall,
  );

  return {
    ...source,
    summary: parsed.summary,
    facts: parsed.facts,
    citations: parsed.citations.map(({ title, note }) => ({ title, note })),
  };
}

async function summarizeUploadChunk(
  userId: string,
  input: LoreBibleInput,
  title: string,
  rawText: string,
  chunkIndex: number,
  chunkCount: number,
  runLimitedLlmCall: ConcurrencyLimiter,
) {
  return uploadSourceSummarySchema.parse(
    await runLimitedLlmCall(() =>
      completeDmJsonObject({
        userId,
        temperature: 0.2,
        maxCompletionTokens: 1200,
        system: UPLOAD_SOURCE_SUMMARY_PROMPT,
        user: JSON.stringify({
          theme: input.theme,
          sourceNotes: input.sourceNotes ?? "",
          source: {
            title,
            chunkIndex: chunkIndex + 1,
            chunkCount,
            rawText,
          },
        }),
        outputSchema: uploadSourceSummaryOutputSchema,
      }),
    ),
  );
}

async function synthesizeUploadSummaryBatches(
  userId: string,
  input: LoreBibleInput,
  title: string,
  chunkSummaries: UploadSourceSummary[],
  runLimitedLlmCall: ConcurrencyLimiter,
  mergeStage = 1,
): Promise<UploadSourceSummary> {
  if (chunkSummaries.length === 1) {
    return chunkSummaries[0];
  }

  const batches = chunkArray(chunkSummaries, MAX_CHUNK_SUMMARIES_PER_MERGE);
  const mergedBatches = await mapWithConcurrency(
    batches,
    MAX_LLM_CONCURRENCY,
    (batch, batchIndex) =>
      batch.length === 1
        ? Promise.resolve(batch[0])
        : mergeUploadSummaryBatch(
            userId,
            input,
            title,
            batch,
            mergeStage,
            batchIndex,
            batches.length,
            runLimitedLlmCall,
          ),
  );

  return synthesizeUploadSummaryBatches(
    userId,
    input,
    title,
    mergedBatches,
    runLimitedLlmCall,
    mergeStage + 1,
  );
}

async function mergeUploadSummaryBatch(
  userId: string,
  input: LoreBibleInput,
  title: string,
  chunkSummaries: UploadSourceSummary[],
  mergeStage: number,
  batchIndex: number,
  batchCount: number,
  runLimitedLlmCall: ConcurrencyLimiter,
) {
  return uploadSourceSummarySchema.parse(
    await runLimitedLlmCall(() =>
      completeDmJsonObject({
        userId,
        temperature: 0.2,
        maxCompletionTokens: 1200,
        system: UPLOAD_SOURCE_SYNTHESIS_PROMPT,
        user: JSON.stringify({
          theme: input.theme,
          sourceNotes: input.sourceNotes ?? "",
          source: {
            title,
            mergeStage,
            batchIndex: batchIndex + 1,
            batchCount,
            chunkCount: chunkSummaries.length,
            chunks: chunkSummaries.map((chunk, index) => ({
              chunkIndex: index + 1,
              summary: chunk.summary,
              facts: chunk.facts,
              citations: chunk.citations,
            })),
          },
        }),
        outputSchema: uploadSourceSummaryOutputSchema,
      }),
    ),
  );
}

function chunkLoreText(text: string, maxChars: number) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length) {
    const remaining = trimmed.length - cursor;
    if (remaining <= maxChars) {
      chunks.push(trimmed.slice(cursor).trim());
      break;
    }

    const window = trimmed.slice(cursor, cursor + maxChars);
    const splitAt = findChunkBreak(window);
    chunks.push(trimmed.slice(cursor, cursor + splitAt).trim());
    cursor += splitAt;

    while (
      cursor < trimmed.length &&
      (trimmed[cursor] === "\n" ||
        trimmed[cursor] === "\r" ||
        trimmed[cursor] === "\t" ||
        trimmed[cursor] === " ")
    ) {
      cursor += 1;
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function findChunkBreak(window: string) {
  const minimumBreak = Math.floor(window.length * 0.6);
  for (const separator of ["\n\n", "\n", " "]) {
    const index = window.lastIndexOf(separator);
    if (index >= minimumBreak) {
      return index + separator.length;
    }
  }

  return window.length;
}

function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  return function runLimitedLlmCall<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        activeCount += 1;
        void task()
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            const next = queue.shift();
            next?.();
          });
      };

      if (activeCount < limit) {
        execute();
        return;
      }

      queue.push(execute);
    });
  };
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<TResult>,
) {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
      }
    }),
  );

  return results;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeResearchHit(hit: LoreResearchHit) {
  const title =
    clipText(normalizeWhitespace(hit.title), MAX_RESEARCH_TITLE_CHARS) ||
    "Untitled research source";
  const snippet = clipText(
    normalizeWhitespace(hit.snippet),
    MAX_RESEARCH_SNIPPET_CHARS,
  );
  const citationNote = clipText(
    snippet || "Public research hit",
    MAX_RESEARCH_CITATION_NOTE_CHARS,
  );

  return {
    ...hit,
    title,
    url: normalizeOptionalValue(hit.url),
    siteName: normalizeOptionalValue(hit.siteName),
    publishedAt: normalizeOptionalValue(hit.publishedAt),
    snippet,
    citationNote,
  };
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clipText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }

  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}
