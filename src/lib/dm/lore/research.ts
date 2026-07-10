export type LoreResearchProviderName = "codex-web" | "zai-mcp" | "searxng";

export type LoreResearchHit = {
  title: string;
  url?: string;
  snippet: string;
  siteName?: string;
  publishedAt?: string;
};

export type LoreResearchProvider = {
  name: LoreResearchProviderName;
  search: (input: {
    theme: string;
    maxResults: number;
  }) => Promise<LoreResearchHit[]>;
};

export type LoreResearchOutcome = {
  provider?: LoreResearchProviderName;
  results: LoreResearchHit[];
  warnings: string[];
};

export async function researchPublicLore(
  input: {
    theme: string;
    maxResults: number;
    enabled?: boolean;
  },
  providers: LoreResearchProvider[],
): Promise<LoreResearchOutcome> {
  if (input.enabled === false) return { results: [], warnings: [] };

  const warnings: string[] = [];

  for (const provider of providers) {
    try {
      const results = await provider.search({
        theme: input.theme,
        maxResults: input.maxResults,
      });
      if (results.length > 0) {
        return { provider: provider.name, results, warnings };
      }
    } catch (error) {
      warnings.push(`${provider.name} failed: ${errorMessage(error)}`);
    }
  }

  return { results: [], warnings };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
