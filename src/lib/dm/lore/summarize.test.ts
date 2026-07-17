import { beforeEach, describe, expect, it, vi } from "vitest";

const llmMock = vi.hoisted(() => ({ completeDmJsonObject: vi.fn() }));
vi.mock("../llm", () => llmMock);

function buildChunkedRawText(chunkCount: number, label = "MARKER") {
  return Array.from({ length: chunkCount }, (_, index) => {
    const chunkLabel = `${label}_${index + 1}`;
    return `${chunkLabel} ${String(index + 1).repeat(7_600)}`;
  }).join("\n\n");
}

describe("buildLoreBible", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns an empty lore bible when no sources exist", async () => {
    const { buildLoreBible } = await import("./summarize");
    const bible = await buildLoreBible("user_1", {
      theme: "original fantasy",
      sourceNotes: "",
      uploadedSources: [],
      researchHits: [],
    });

    expect(bible.sourceTitles).toEqual([]);
    expect(bible.canonFacts).toEqual([]);
    expect(llmMock.completeDmJsonObject).not.toHaveBeenCalled();
  });

  it("sends mixed prepared sources to the DM summarizer payload", async () => {
    llmMock.completeDmJsonObject.mockResolvedValue({
      sourceTitles: ["novel.md"],
      canonFacts: ["Mira is the heir."],
      characters: [],
      locations: [],
      timeline: [],
      toneAndThemes: [],
      adaptationRules: [],
      forbiddenContradictions: [],
      campaignHooks: [],
      uncertainties: [],
      citations: [
        {
          title: "lore-bible.md",
          url: null,
          note: "Compiled from private and public sources.",
        },
      ],
    });

    const { buildLoreBible } = await import("./summarize");
    const bible = await buildLoreBible("user_1", {
      theme: "Mira campaign",
      sourceNotes: "keep names",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText: "Private novel text",
          summary: "Private novel summary",
          facts: ["Private canon fact"],
          citations: [
            {
              title: "novel.md",
              note: "Private citation note.",
            },
          ],
          contentHash: "a".repeat(64),
        },
        {
          kind: "web_research",
          title: "Public wiki",
          sourceUrl: "https://example.test/wiki",
          summary: "Public rumor that Mira vanished at sea.",
          facts: ["Public rumor that Mira vanished at sea."],
          citations: [
            {
              title: "Public wiki",
              url: "https://example.test/wiki",
              note: "Public rumor that Mira vanished at sea.",
            },
          ],
          contentHash: "b".repeat(64),
        },
      ],
      researchHits: [
        {
          title: "Public wiki",
          url: "https://example.test/wiki",
          snippet: "Public rumor that Mira vanished at sea.",
        },
      ],
    });

    const call = llmMock.completeDmJsonObject.mock.calls[0]?.[0];
    const payload = JSON.parse(call.user as string) as {
      sourceNotes: string;
      sources: Array<{
        kind: string;
        title: string;
        rawText?: string;
        sourceUrl?: string;
        summary: string;
        facts: string[];
        citations: Array<{
          title: string;
          url: string | null;
          note: string;
        }>;
      }>;
    };

    expect(payload.sourceNotes).toBe("keep names");
    expect(payload.sources).toHaveLength(2);
    expect(payload.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "upload",
          title: "novel.md",
          summary: "Private novel summary",
          facts: ["Private canon fact"],
        }),
        expect.objectContaining({
          kind: "web_research",
          title: "Public wiki",
          sourceUrl: "https://example.test/wiki",
          summary: "Public rumor that Mira vanished at sea.",
          facts: ["Public rumor that Mira vanished at sea."],
          citations: [
            {
              title: "Public wiki",
              url: "https://example.test/wiki",
              note: "Public rumor that Mira vanished at sea.",
            },
          ],
        }),
      ]),
    );
    expect(payload.sources.find((source) => source.kind === "web_research"))
      .not.toHaveProperty("rawText");
    expect(payload.sources.find((source) => source.kind === "upload"))
      .not.toHaveProperty("rawText");

    expect(bible.citations).toEqual([
      {
        title: "lore-bible.md",
        note: "Compiled from private and public sources.",
      },
    ]);
  });

  it("drops invented private-upload URLs from the combined lore bible", async () => {
    llmMock.completeDmJsonObject.mockResolvedValue({
      sourceTitles: ["novel.md"],
      canonFacts: ["Mira is the heir."],
      characters: [],
      locations: [],
      timeline: [],
      toneAndThemes: [],
      adaptationRules: [],
      forbiddenContradictions: [],
      campaignHooks: [],
      uncertainties: [],
      citations: [
        {
          title: "novel.md",
          url: "novel.md",
          note: "The opening establishes Mira's inheritance.",
        },
      ],
    });

    const { buildLoreBible } = await import("./summarize");
    const bible = await buildLoreBible("user_invalid_bible_url", {
      theme: "Mira campaign",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          summary: "Mira inherits House Tal.",
          facts: ["Mira is the heir."],
          citations: [{ title: "novel.md", note: "Opening paragraph." }],
          contentHash: "d".repeat(64),
        },
      ],
      researchHits: [],
    });

    const call = llmMock.completeDmJsonObject.mock.calls[0]?.[0];
    expect(
      call.outputSchema.properties.citations.items.properties.url.format,
    ).toBe("uri");
    expect(bible.citations).toEqual([
      {
        title: "novel.md",
        note: "The opening establishes Mira's inheritance.",
      },
    ]);
  });
});

describe("summarizePreparedSources", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("summarizes uploaded sources through the DM model and preserves private fields", async () => {
    llmMock.completeDmJsonObject.mockResolvedValue({
      summary: "A noble house falls and Mira becomes the last heir.",
      facts: ["Mira is the last surviving heir."],
      citations: [
        {
          title: "novel.md",
          note: "Opening chapter establishes Mira's inheritance.",
        },
      ],
    });

    const { summarizePreparedSources } = await import("./summarize");
    const [source] = await summarizePreparedSources("user_private", {
      theme: "Mira campaign",
      sourceNotes: "preserve family names",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText: "Private novel text about Mira and House Tal.",
          summary: "",
          facts: [],
          citations: [],
          contentHash: "a".repeat(64),
        },
      ],
      researchHits: [
        {
          title: "Public wiki",
          url: "https://example.test/wiki",
          snippet: "Public rumor that Mira vanished at sea.",
        },
      ],
    });

    expect(llmMock.completeDmJsonObject).toHaveBeenCalledTimes(1);
    expect(llmMock.completeDmJsonObject).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_private",
      }),
    );

    const call = llmMock.completeDmJsonObject.mock.calls[0]?.[0];
    expect(call.user).toContain("Private novel text about Mira and House Tal.");
    expect(call.user).toContain("preserve family names");
    expect(call.user).not.toContain("Public rumor that Mira vanished at sea.");

    expect(source).toMatchObject({
      kind: "upload",
      title: "novel.md",
      rawText: "Private novel text about Mira and House Tal.",
      summary: "A noble house falls and Mira becomes the last heir.",
      facts: ["Mira is the last surviving heir."],
      citations: [
        {
          title: "novel.md",
          note: "Opening chapter establishes Mira's inheritance.",
        },
      ],
      contentHash: "a".repeat(64),
    });
  });

  it("normalizes object facts and defaults omitted citations", async () => {
    llmMock.completeDmJsonObject.mockResolvedValue({
      summary: "Mira erbt das verfallene Haus ihrer Familie.",
      facts: [
        { fact: "Mira ist die letzte Erbin." },
        { subject: "Haus Tal", relation: "steht in", object: "Cypress Hollow" },
      ],
    });

    const { summarizePreparedSources } = await import("./summarize");
    const [source] = await summarizePreparedSources("user_malformed", {
      theme: "Mira campaign",
      sourceNotes: "preserve names",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText: "Private novel text about Mira and House Tal.",
          summary: "",
          facts: [],
          citations: [],
          contentHash: "f".repeat(64),
        },
      ],
      researchHits: [],
    });

    expect(source.facts).toEqual([
      "Mira ist die letzte Erbin.",
      "Haus Tal — steht in — Cypress Hollow",
    ]);
    expect(source.citations).toEqual([]);
  });

  it("ignores invented URLs on citations for private uploads", async () => {
    llmMock.completeDmJsonObject.mockResolvedValue({
      summary: "Mira erbt das verfallene Haus ihrer Familie.",
      facts: ["Mira ist die letzte Erbin."],
      citations: [
        {
          title: "novel.md",
          url: "novel.md",
          note: "Die Erbfolge steht im ersten Absatz.",
        },
      ],
    });

    const { summarizePreparedSources } = await import("./summarize");
    const [source] = await summarizePreparedSources("user_invalid_upload_url", {
      theme: "Mira campaign",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText: "Private novel text about Mira and House Tal.",
          summary: "",
          facts: [],
          citations: [],
          contentHash: "e".repeat(64),
        },
      ],
      researchHits: [],
    });

    const call = llmMock.completeDmJsonObject.mock.calls[0]?.[0];
    expect(
      call.outputSchema.properties.citations.items.properties,
    ).not.toHaveProperty("url");
    expect(source.citations).toEqual([
      {
        title: "novel.md",
        note: "Die Erbfolge steht im ersten Absatz.",
      },
    ]);
  });

  it("chunks large uploaded sources before synthesis and does not resend raw text", async () => {
    llmMock.completeDmJsonObject.mockImplementation(async ({ user }) => {
      const payload = JSON.parse(user as string) as {
        source: {
          title: string;
          rawText?: string;
          chunkIndex?: number;
          chunkCount?: number;
          chunks?: Array<{
            chunkIndex: number;
            summary: string;
            facts: string[];
            citations: Array<{ title: string; url: string | null; note: string }>;
          }>;
        };
      };

      if (payload.source.rawText) {
        return {
          summary: `Chunk ${payload.source.chunkIndex} summary`,
          facts: [`Chunk ${payload.source.chunkIndex} fact`],
          citations: [
            {
              title: payload.source.title,
              note: `Chunk ${payload.source.chunkIndex} note`,
            },
          ],
        };
      }

      return {
        summary: "Merged upload summary",
        facts: ["Merged fact"],
        citations: [
          {
            title: payload.source.title,
            note: "Merged note",
          },
        ],
      };
    });

    const { summarizePreparedSources } = await import("./summarize");
    const chunkOne = `FIRST_MARKER ${"A".repeat(9_000)}`;
    const chunkTwo = `SECOND_MARKER ${"B".repeat(9_000)}`;
    const rawText = `${chunkOne}\n\n${chunkTwo}`;

    const [source] = await summarizePreparedSources("user_chunked", {
      theme: "Mira campaign",
      sourceNotes: "preserve names",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText,
          summary: "",
          facts: [],
          citations: [],
          contentHash: "c".repeat(64),
        },
      ],
      researchHits: [],
    });

    const calls = llmMock.completeDmJsonObject.mock.calls.map(
      ([call]) => JSON.parse(call.user as string) as { source: Record<string, unknown> },
    );
    const chunkCalls = calls.filter((call) => "rawText" in call.source);
    const synthesisCall = calls.find((call) => "chunks" in call.source);

    expect(chunkCalls).toHaveLength(2);
    expect(
      chunkCalls.every(
        (call) =>
          typeof call.source.rawText === "string" &&
          (call.source.rawText as string).length < rawText.length,
      ),
    ).toBe(true);
    expect((chunkCalls[0]?.source.rawText as string) ?? "").toContain("FIRST_MARKER");
    expect((chunkCalls[0]?.source.rawText as string) ?? "").not.toContain("SECOND_MARKER");
    expect((chunkCalls.at(-1)?.source.rawText as string) ?? "").toContain("SECOND_MARKER");

    expect(synthesisCall).toBeDefined();
    expect(JSON.stringify(synthesisCall)).not.toContain("FIRST_MARKER");
    expect(JSON.stringify(synthesisCall)).not.toContain("SECOND_MARKER");

    expect(source.summary).toBe("Merged upload summary");
    expect(source.facts).toEqual(["Merged fact"]);
    expect(source.citations).toEqual([
      {
        title: "novel.md",
        note: "Merged note",
      },
    ]);
    expect(source.rawText).toBe(rawText);
  });

  it("limits concurrent chunk summary calls to two", async () => {
    const startedChunks: number[] = [];
    const pendingChunkResolvers = new Map<number, () => void>();
    let activeCalls = 0;
    let maxActiveCalls = 0;

    llmMock.completeDmJsonObject.mockImplementation(({ user }) => {
      const payload = JSON.parse(user as string) as {
        source: {
          title: string;
          chunkIndex?: number;
          rawText?: string;
        };
      };

      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

      if (payload.source.rawText) {
        const chunkIndex = payload.source.chunkIndex ?? 0;
        startedChunks.push(chunkIndex);

        return new Promise((resolve) => {
          pendingChunkResolvers.set(chunkIndex, () => {
            activeCalls -= 1;
            resolve({
              summary: `Chunk ${chunkIndex} summary`,
              facts: [`Chunk ${chunkIndex} fact`],
              citations: [
                {
                  title: payload.source.title,
                  note: `Chunk ${chunkIndex} note`,
                },
              ],
            });
          });
        });
      }

      activeCalls -= 1;
      return Promise.resolve({
        summary: "Merged upload summary",
        facts: ["Merged fact"],
        citations: [
          {
            title: payload.source.title,
            note: "Merged note",
          },
        ],
      });
    });

    const { summarizePreparedSources } = await import("./summarize");
    const summarizePromise = summarizePreparedSources("user_limited", {
      theme: "Mira campaign",
      sourceNotes: "preserve names",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText: buildChunkedRawText(4, "LIMIT"),
          summary: "",
          facts: [],
          citations: [],
          contentHash: "d".repeat(64),
        },
      ],
      researchHits: [],
    });

    await vi.waitFor(() => {
      expect(startedChunks).toHaveLength(2);
    });
    expect(startedChunks).toEqual([1, 2]);
    expect(maxActiveCalls).toBe(2);

    pendingChunkResolvers.get(1)?.();
    pendingChunkResolvers.get(2)?.();

    await vi.waitFor(() => {
      expect(startedChunks).toHaveLength(4);
    });
    expect(startedChunks).toEqual([1, 2, 3, 4]);
    expect(maxActiveCalls).toBe(2);

    pendingChunkResolvers.get(3)?.();
    pendingChunkResolvers.get(4)?.();

    const [source] = await summarizePromise;
    expect(source.summary).toBe("Merged upload summary");
  });

  it("merges many chunk summaries in bounded staged batches", async () => {
    llmMock.completeDmJsonObject.mockImplementation(async ({ user }) => {
      const payload = JSON.parse(user as string) as {
        source: {
          title: string;
          mergeStage?: number;
          batchIndex?: number;
          chunkIndex?: number;
          chunkCount?: number;
          rawText?: string;
          chunks?: Array<{
            chunkIndex: number;
            summary: string;
            facts: string[];
            citations: Array<{ title: string; url: string | null; note: string }>;
          }>;
        };
      };

      if (payload.source.rawText) {
        const chunkIndex = payload.source.chunkIndex ?? 0;
        return {
          summary: `Chunk ${chunkIndex} summary`,
          facts: [`Chunk ${chunkIndex} fact`],
          citations: [
            {
              title: payload.source.title,
              note: `Chunk ${chunkIndex} note`,
            },
          ],
        };
      }

      return {
        summary: `Merged stage ${payload.source.mergeStage} batch ${payload.source.batchIndex}`,
        facts: [`Merged fact count ${payload.source.chunkCount}`],
        citations: [
          {
            title: payload.source.title,
            note: `Merged stage ${payload.source.mergeStage}`,
          },
        ],
      };
    });

    const { summarizePreparedSources } = await import("./summarize");
    const [source] = await summarizePreparedSources("user_staged_merge", {
      theme: "Mira campaign",
      sourceNotes: "preserve names",
      uploadedSources: [
        {
          kind: "upload",
          title: "novel.md",
          rawText: buildChunkedRawText(18, "MERGE"),
          summary: "",
          facts: [],
          citations: [],
          contentHash: "e".repeat(64),
        },
      ],
      researchHits: [],
    });

    const calls = llmMock.completeDmJsonObject.mock.calls.map(
      ([call]) => JSON.parse(call.user as string) as { source: Record<string, unknown> },
    );
    const synthesisCalls = calls.filter((call) => "chunks" in call.source);

    expect(synthesisCalls.length).toBeGreaterThan(1);
    expect(
      synthesisCalls.every(
        (call) =>
          Array.isArray(call.source.chunks) && call.source.chunks.length <= 8,
      ),
    ).toBe(true);
    expect(
      synthesisCalls.some(
        (call) =>
          call.source.mergeStage === 2 && call.source.chunkCount === 3,
      ),
    ).toBe(true);
    expect(source.summary).toBe("Merged stage 2 batch 1");
    expect(source.facts).toEqual(["Merged fact count 3"]);
  });

  it("converts research hits into public lore sources without rawText", async () => {
    const { summarizePreparedSources } = await import("./summarize");

    const [source] = await summarizePreparedSources("user_public", {
      theme: "Greyhawk",
      sourceNotes: "",
      uploadedSources: [],
      researchHits: [
        {
          title: "Greyhawk Wiki",
          url: "https://example.test/greyhawk",
          snippet: "Greyhawk is a classic Dungeons & Dragons setting.",
          siteName: "Example",
          publishedAt: "2024-01-01",
        },
      ],
    });

    expect(llmMock.completeDmJsonObject).not.toHaveBeenCalled();
    expect(source.kind).toBe("web_research");
    expect(source.title).toBe("Greyhawk Wiki");
    expect(source.sourceUrl).toBe("https://example.test/greyhawk");
    expect(source.summary).toBe(
      "Greyhawk is a classic Dungeons & Dragons setting.",
    );
    expect(source.facts).toEqual([
      "Greyhawk is a classic Dungeons & Dragons setting.",
    ]);
    expect(source.citations).toEqual([
      {
        title: "Greyhawk Wiki",
        url: "https://example.test/greyhawk",
        note: "Greyhawk is a classic Dungeons & Dragons setting.",
      },
    ]);
    expect("rawText" in source).toBe(false);
    expect(source.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const [repeat] = await summarizePreparedSources("user_public", {
      theme: "Greyhawk",
      sourceNotes: "",
      uploadedSources: [],
      researchHits: [
        {
          title: "Greyhawk Wiki",
          url: "https://example.test/greyhawk",
          snippet: "Greyhawk is a classic Dungeons & Dragons setting.",
          siteName: "Example",
          publishedAt: "2024-01-01",
        },
      ],
    });

    expect(repeat.contentHash).toBe(source.contentHash);
  });

  it("clips long research snippets before persistence and hashing", async () => {
    const { summarizePreparedSources } = await import("./summarize");
    const longTitle = `Greyhawk ${"Title ".repeat(80)}`;
    const sharedPrefix = "Greyhawk lore ".repeat(120);
    const longSnippetA = `${sharedPrefix}${"A".repeat(600)}`;
    const longSnippetB = `${sharedPrefix}${"B".repeat(600)}`;

    const [first] = await summarizePreparedSources("user_public", {
      theme: "Greyhawk",
      sourceNotes: "",
      uploadedSources: [],
      researchHits: [
        {
          title: longTitle,
          url: "https://example.test/greyhawk",
          snippet: longSnippetA,
        },
      ],
    });
    const [second] = await summarizePreparedSources("user_public", {
      theme: "Greyhawk",
      sourceNotes: "",
      uploadedSources: [],
      researchHits: [
        {
          title: longTitle,
          url: "https://example.test/greyhawk",
          snippet: longSnippetB,
        },
      ],
    });

    expect(first.title.length).toBeLessThanOrEqual(240);
    expect(first.summary.length).toBeLessThanOrEqual(1_500);
    expect(first.citations[0]?.note.length).toBeLessThanOrEqual(500);
    expect(first.facts).toEqual([first.summary]);
    expect(first.contentHash).toBe(second.contentHash);
  });
});
