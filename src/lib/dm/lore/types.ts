import { z } from "zod";

export const loreOptionsSchema = z.object({
  researchPublicLore: z.boolean().default(false),
  sourceNotes: z.string().max(2000).optional(),
});

const loreCitationUrlSchema = z.preprocess(
  normalizeLoreCitationUrl,
  z.string().url().optional(),
);

export const loreCitationSchema = z.object({
  title: z.string(),
  url: loreCitationUrlSchema,
  note: z.string(),
});

function normalizeLoreCitationUrl(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") return value;

  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

export const loreBibleSchema = z.object({
  sourceTitles: z.array(z.string()).default([]),
  canonFacts: z.array(z.string()).default([]),
  characters: z
    .array(z.object({ name: z.string(), role: z.string(), notes: z.string() }))
    .default([]),
  locations: z
    .array(z.object({ name: z.string(), notes: z.string() }))
    .default([]),
  timeline: z.array(z.string()).default([]),
  toneAndThemes: z.array(z.string()).default([]),
  adaptationRules: z.array(z.string()).default([]),
  forbiddenContradictions: z.array(z.string()).default([]),
  campaignHooks: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  citations: z.array(loreCitationSchema).default([]),
});

export type LoreOptions = z.infer<typeof loreOptionsSchema>;
export type LoreBible = z.infer<typeof loreBibleSchema>;

export type PreparedLoreSource = {
  kind: "upload" | "web_research";
  title: string;
  sourceUrl?: string;
  rawText?: string;
  summary: string;
  facts: string[];
  citations: Array<{ title: string; url?: string; note: string }>;
  contentHash: string;
};
