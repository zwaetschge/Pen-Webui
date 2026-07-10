import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoreResearchProviderName } from "./research";
import { researchPublicLore, type LoreResearchProvider } from "./research";

const completeDmJsonObjectMock = vi.hoisted(() => vi.fn());

function provider(
  name: "codex-web" | "zai-mcp" | "searxng",
  impl: LoreResearchProvider["search"],
): LoreResearchProvider {
  return { name, search: impl };
}

function mockResearchProviderDeps(codexWebEnabled: boolean) {
  vi.doMock("../../env", () => ({
    env: () => ({
      CODEX_WEB_RESEARCH_ENABLED: codexWebEnabled,
      ZAI_API_KEY: "",
      ZAI_WEB_SEARCH_MCP_URL: "https://z.ai.test/mcp",
      SEARXNG_URL: "https://searx.test/search",
    }),
  }));
  vi.doMock("../llm", () => ({
    completeDmJsonObject: completeDmJsonObjectMock,
  }));
}

describe("researchPublicLore", () => {
  it("falls through providers until one returns results", async () => {
    const codex = vi.fn().mockRejectedValue(new Error("no web"));
    const zai = vi.fn().mockResolvedValue([]);
    const searx = vi.fn().mockResolvedValue([
      {
        title: "Namek",
        url: "https://example.test/namek",
        snippet: "Namek is a planet.",
        siteName: "Example",
      },
    ]);

    const result = await researchPublicLore(
      { theme: "Dragon Ball on Namek", maxResults: 4 },
      [
        provider("codex-web", codex),
        provider("zai-mcp", zai),
        provider("searxng", searx),
      ],
    );

    expect(result.provider).toBe("searxng");
    expect(result.results).toHaveLength(1);
    expect(result.warnings).toContain("codex-web failed: no web");
    expect(zai).toHaveBeenCalled();
  });

  it("does not call providers when research is disabled by caller", async () => {
    const search = vi.fn();
    const result = await researchPublicLore(
      { theme: "anything", maxResults: 4, enabled: false },
      [provider("searxng", search)],
    );

    expect(result.provider).toBeUndefined();
    expect(result.results).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});

describe("defaultLoreResearchProviders", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock("../../env");
    vi.unmock("../llm");
  });

  it("orders concrete providers with codex-web disabled by default", async () => {
    mockResearchProviderDeps(false);

    const { defaultLoreResearchProviders } = await import("./research-providers");

    expect(providerNames(defaultLoreResearchProviders("user_1"))).toEqual([
      "zai-mcp",
      "searxng",
    ]);
  });

  it("places codex-web first only when explicitly enabled", async () => {
    mockResearchProviderDeps(true);

    const { defaultLoreResearchProviders } = await import("./research-providers");

    expect(providerNames(defaultLoreResearchProviders("user_1"))).toEqual([
      "codex-web",
      "zai-mcp",
      "searxng",
    ]);
  });

  it("accepts codex-web hits without optional metadata", async () => {
    mockResearchProviderDeps(true);
    completeDmJsonObjectMock.mockResolvedValue({
      results: [{ title: "Greyhawk", snippet: "Classic D&D setting." }],
    });

    const { defaultLoreResearchProviders } = await import("./research-providers");
    const [codexWeb] = defaultLoreResearchProviders("user_1");

    await expect(
      codexWeb.search({ theme: "Greyhawk", maxResults: 4 }),
    ).resolves.toEqual([
      { title: "Greyhawk", snippet: "Classic D&D setting." },
    ]);
  });

  it("returns no codex-web hits when the model output is not structured", async () => {
    mockResearchProviderDeps(true);
    completeDmJsonObjectMock.mockResolvedValue({
      results: [{ title: "Greyhawk" }],
    });

    const { defaultLoreResearchProviders } = await import("./research-providers");
    const [codexWeb] = defaultLoreResearchProviders("user_1");

    await expect(
      codexWeb.search({ theme: "Greyhawk", maxResults: 4 }),
    ).resolves.toEqual([]);
  });
});

function providerNames(
  providers: LoreResearchProvider[],
): LoreResearchProviderName[] {
  return providers.map((provider) => provider.name);
}
