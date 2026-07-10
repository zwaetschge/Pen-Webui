import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireDM: vi.fn() }));
const worldbuild = vi.hoisted(() => ({
  draftBlueprint: vi.fn(),
  commitBlueprint: vi.fn(),
}));
const lore = vi.hoisted(() => ({
  prepareMarkdownLoreFile: vi.fn(),
  summarizePreparedSources: vi.fn(),
  buildLoreBible: vi.fn(),
  researchPublicLore: vi.fn(),
  defaultLoreResearchProviders: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireDM: auth.requireDM,
  AuthError: class AuthError extends Error {
    code = "auth_error";
  },
}));

vi.mock("@/lib/dm/worldbuild", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dm/worldbuild")>(
    "@/lib/dm/worldbuild",
  );
  return { ...actual, ...worldbuild };
});

vi.mock("@/lib/dm/lore/markdown", () => ({
  prepareMarkdownLoreFile: lore.prepareMarkdownLoreFile,
}));

vi.mock("@/lib/dm/lore/summarize", () => ({
  summarizePreparedSources: lore.summarizePreparedSources,
  buildLoreBible: lore.buildLoreBible,
}));

vi.mock("@/lib/dm/lore/research", () => ({
  researchPublicLore: lore.researchPublicLore,
}));

vi.mock("@/lib/dm/lore/research-providers", () => ({
  defaultLoreResearchProviders: lore.defaultLoreResearchProviders,
}));

describe("worldbuild route", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.requireDM.mockReset();
    worldbuild.draftBlueprint.mockReset();
    worldbuild.commitBlueprint.mockReset();
    lore.prepareMarkdownLoreFile.mockReset();
    lore.summarizePreparedSources.mockReset();
    lore.buildLoreBible.mockReset();
    lore.researchPublicLore.mockReset();
    lore.defaultLoreResearchProviders.mockReset();
  });

  it("keeps legacy JSON requests working with empty lore metadata", async () => {
    auth.requireDM.mockResolvedValue({ id: "user_1" });
    lore.defaultLoreResearchProviders.mockReturnValue(["provider"]);
    lore.researchPublicLore.mockResolvedValue({ results: [], warnings: [] });
    lore.summarizePreparedSources.mockResolvedValue([]);
    lore.buildLoreBible.mockResolvedValue({
      sourceTitles: [],
      canonFacts: [],
      characters: [],
      locations: [],
      timeline: [],
      toneAndThemes: [],
      adaptationRules: [],
      forbiddenContradictions: [],
      campaignHooks: [],
      uncertainties: [],
      citations: [],
    });
    worldbuild.draftBlueprint.mockResolvedValue({
      title: "A",
      npcs: [],
      locations: [],
      openingScene: {
        introPlan: {
          setupBeats: [
            {
              title: "Ankunft im Regen",
              text: "Regen zeichnet helle Spuren auf die Scheiben.",
            },
            {
              title: "Blicke am Tresen",
              text: "Elinor Hale mustert die Neuankömmlinge.",
            },
            {
              title: "Die erste Wahl",
              text: "Vor der Hintertür fällt ein schwerer Gegenstand zu Boden.",
            },
          ],
        },
      },
    });
    worldbuild.commitBlueprint.mockResolvedValue({ campaignId: "camp_1" });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://test/api/dm/worldbuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Mira",
          theme: "private novel",
          partySize: 4,
          partyLevel: 3,
          sessionLengthHours: 3,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(lore.prepareMarkdownLoreFile).not.toHaveBeenCalled();
    expect(lore.researchPublicLore).toHaveBeenCalledWith(
      {
        theme: "private novel",
        maxResults: 6,
        enabled: false,
      },
      ["provider"],
    );
    expect(worldbuild.draftBlueprint).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        title: "Mira",
        theme: "private novel",
      }),
      {
        loreBible: expect.objectContaining({
          sourceTitles: [],
        }),
      },
    );
    expect(worldbuild.commitBlueprint).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "user_1",
        loreSources: [],
      }),
    );
    expect(body).toMatchObject({
      campaignId: "camp_1",
      blueprint: { title: "A" },
      lore: { sourceCount: 0, researchProvider: null, warnings: [] },
    });
  });

  it("threads multipart lore through summarization and persistence without leaking uploads to research", async () => {
    const preparedUpload = {
      kind: "upload" as const,
      title: "novel.md",
      rawText: "# Mira\nPrivate text",
      summary: "",
      facts: [],
      citations: [],
      contentHash: "a".repeat(64),
    };
    const persistedSources = [
      {
        ...preparedUpload,
        summary: "A private novel.",
        facts: ["Mira is the heir."],
      },
      {
        kind: "web_research" as const,
        title: "Reference article",
        sourceUrl: "https://example.com/mira",
        summary: "Public summary",
        facts: ["The article mentions Mira."],
        citations: [
          {
            title: "Reference article",
            url: "https://example.com/mira",
            note: "Public citation",
          },
        ],
        contentHash: "b".repeat(64),
      },
    ];
    const loreBible = {
      sourceTitles: ["novel.md", "Reference article"],
      canonFacts: ["Mira is the heir."],
      characters: [],
      locations: [],
      timeline: [],
      toneAndThemes: [],
      adaptationRules: [],
      forbiddenContradictions: [],
      campaignHooks: [],
      uncertainties: [],
      citations: [],
    };

    auth.requireDM.mockResolvedValue({ id: "user_1" });
    lore.prepareMarkdownLoreFile.mockResolvedValue(preparedUpload);
    lore.defaultLoreResearchProviders.mockReturnValue([{ name: "provider" }]);
    lore.researchPublicLore.mockResolvedValue({
      provider: "codex-web",
      results: [
        {
          title: "Reference article",
          url: "https://example.com/mira",
          snippet: "Public snippet",
        },
      ],
      warnings: ["provider warning"],
    });
    lore.summarizePreparedSources.mockResolvedValue(persistedSources);
    lore.buildLoreBible.mockResolvedValue(loreBible);
    worldbuild.draftBlueprint.mockResolvedValue({
      title: "A",
      npcs: [],
      locations: [],
      openingScene: {
        introPlan: {
          setupBeats: [
            {
              title: "Ankunft im Regen",
              text: "Regen zeichnet helle Spuren auf die Scheiben.",
            },
            {
              title: "Blicke am Tresen",
              text: "Elinor Hale mustert die Neuankömmlinge.",
            },
            {
              title: "Die erste Wahl",
              text: "Vor der Hintertür fällt ein schwerer Gegenstand zu Boden.",
            },
          ],
        },
      },
    });
    worldbuild.commitBlueprint.mockResolvedValue({ campaignId: "camp_1" });

    const form = new FormData();
    form.set(
      "brief",
      JSON.stringify({
        title: "Mira",
        theme: "private novel",
        partySize: 4,
        partyLevel: 3,
        sessionLengthHours: 3,
        lore: { researchPublicLore: true, sourceNotes: "keep names" },
      }),
    );
    form.append(
      "loreFiles[]",
      new File(["# Mira\nPrivate text"], "novel.md", {
        type: "text/markdown",
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://test/api/dm/worldbuild", {
        method: "POST",
        body: form,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(lore.prepareMarkdownLoreFile).toHaveBeenCalledTimes(1);
    expect(lore.defaultLoreResearchProviders).toHaveBeenCalledWith("user_1");
    expect(lore.researchPublicLore).toHaveBeenCalledWith(
      {
        theme: "private novel",
        maxResults: 6,
        enabled: true,
      },
      [{ name: "provider" }],
    );
    expect(lore.researchPublicLore).not.toHaveBeenCalledWith(
      expect.objectContaining({
        sourceNotes: expect.anything(),
        rawText: expect.anything(),
      }),
      expect.anything(),
    );
    expect(lore.summarizePreparedSources).toHaveBeenCalledWith("user_1", {
      theme: "private novel",
      sourceNotes: "keep names",
      uploadedSources: [preparedUpload],
      researchHits: [
        {
          title: "Reference article",
          url: "https://example.com/mira",
          snippet: "Public snippet",
        },
      ],
    });
    expect(lore.buildLoreBible).toHaveBeenCalledWith("user_1", {
      theme: "private novel",
      sourceNotes: "keep names",
      uploadedSources: persistedSources,
      researchHits: [],
    });
    expect(worldbuild.draftBlueprint).toHaveBeenCalledWith(
      "user_1",
      expect.objectContaining({
        title: "Mira",
      }),
      { loreBible },
    );
    expect(worldbuild.commitBlueprint).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "user_1",
        loreBible,
        loreSources: persistedSources,
      }),
    );
    expect(body).toMatchObject({
      campaignId: "camp_1",
      blueprint: { title: "A" },
      lore: {
        sourceCount: 2,
        researchProvider: "codex-web",
        warnings: ["provider warning"],
      },
    });
  });
});
