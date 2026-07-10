import { env } from "../../env";
import { completeDmJsonObject } from "../llm";
import { z } from "zod";
import type { LoreResearchHit, LoreResearchProvider } from "./research";

export function defaultLoreResearchProviders(
  userId: string,
): LoreResearchProvider[] {
  const providers: LoreResearchProvider[] = [
    zaiMcpResearchProvider(),
    searxngResearchProvider(),
  ];

  if (env().CODEX_WEB_RESEARCH_ENABLED) {
    providers.unshift(codexWebResearchProvider(userId));
  }

  return providers;
}

function codexWebResearchProvider(userId: string): LoreResearchProvider {
  return {
    name: "codex-web",
    async search(input) {
      if (!env().CODEX_WEB_RESEARCH_ENABLED) {
        return [];
      }

      const value = await completeDmJsonObject({
        userId,
        temperature: 0.2,
        maxCompletionTokens: 1800,
        system:
          'Research public lore for the requested tabletop campaign theme. Use built-in web search if available. Return only sourced JSON. If web search is unavailable, return {"results":[]}.',
        user: JSON.stringify(input),
        outputSchema: researchOutputSchema,
      });
      return parseResearchOutput(value);
    },
  };
}

function zaiMcpResearchProvider(): LoreResearchProvider {
  return {
    name: "zai-mcp",
    async search(input) {
      const key = env().ZAI_API_KEY;
      if (!key) return [];

      const url = env().ZAI_WEB_SEARCH_MCP_URL;
      const body = {
        jsonrpc: "2.0",
        id: "plum-web-search",
        method: "tools/call",
        params: {
          name: "webSearchPrime",
          arguments: { query: input.theme, count: input.maxResults },
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Z.AI MCP search failed (${response.status})`);
      }

      const json = (await response.json()) as unknown;
      return parseZaiMcpHits(json).slice(0, input.maxResults);
    },
  };
}

function searxngResearchProvider(): LoreResearchProvider {
  return {
    name: "searxng",
    async search(input) {
      const url = new URL(env().SEARXNG_URL);
      url.searchParams.set("q", input.theme);
      url.searchParams.set("format", "json");

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`SearxNG search failed (${response.status})`);
      }

      const json = (await response.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          engine?: string;
        }>;
      };

      return (json.results ?? [])
        .map((hit) => ({
          title: hit.title ?? hit.url ?? "Untitled result",
          url: hit.url,
          snippet: hit.content ?? "",
          siteName: hit.engine,
        }))
        .filter((hit) => hit.snippet.length > 0)
        .slice(0, input.maxResults);
    },
  };
}

const researchOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
          siteName: { type: "string" },
          publishedAt: { type: "string" },
        },
        required: ["title", "snippet"],
      },
    },
  },
  required: ["results"],
} as const;

const researchHitSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  snippet: z.string(),
  siteName: z.string().optional(),
  publishedAt: z.string().optional(),
});

const researchOutputParser = z.object({
  results: z.array(researchHitSchema),
});

function parseResearchOutput(value: unknown): LoreResearchHit[] {
  const parsed = researchOutputParser.safeParse(value);
  return parsed.success ? parsed.data.results : [];
}

function parseZaiMcpHits(value: unknown): LoreResearchHit[] {
  const text = JSON.stringify(value);
  const data = JSON.parse(text) as {
    result?: { content?: Array<{ text?: string }> };
  };

  const raw = data.result?.content?.flatMap((item) => {
    if (!item.text) return [];
    try {
      return parseResearchOutput(JSON.parse(item.text));
    } catch {
      return [];
    }
  });

  return raw ?? [];
}
