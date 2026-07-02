import { z } from "zod";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { searchSRD } from "./search";
import { formatForTool } from "./format";

export const lookupSRDArgs = z.object({
  query: z.string().min(1).describe("free-text query, or exact spell/monster/item name"),
  type: z
    .enum([
      "spell",
      "monster",
      "rule",
      "item",
      "class",
      "race",
      "background",
      "feat",
      "condition",
      "feature",
    ])
    .optional()
    .describe("restrict to one SRD type"),
  limit: z.number().int().min(1).max(8).default(3),
});

export const lookupSRDTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "lookup_srd",
    description:
      "Look up rules, spells, monsters, items, classes, races, conditions or features in the official D&D 5.1 SRD. You MUST use this tool whenever you need exact numerical mechanics (damage, DC, range, casting time, HP, AC) instead of recalling them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "free-text query, or exact spell/monster/item name",
        },
        type: {
          type: "string",
          enum: [
            "spell",
            "monster",
            "rule",
            "item",
            "class",
            "race",
            "background",
            "feat",
            "condition",
            "feature",
          ],
          description: "restrict to one SRD type",
        },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
    },
  },
};

export async function runLookupSRD(rawArgs: unknown): Promise<string> {
  const args = lookupSRDArgs.parse(rawArgs);
  const hits = await searchSRD({
    query: args.query,
    type: args.type,
    limit: args.limit,
  });
  if (hits.length === 0) {
    return `No SRD entries found for "${args.query}"${args.type ? ` (type=${args.type})` : ""}.`;
  }
  return hits.map((h) => formatForTool(h)).join("\n\n---\n\n");
}
