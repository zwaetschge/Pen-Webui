import { describe, expect, it } from "vitest";
import { worldbuildOutputSchema } from "@/lib/dm/worldbuild-output-schema";

type JsonSchema = {
  type?: string | readonly string[];
  additionalProperties?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  $defs?: Record<string, JsonSchema>;
};

function walkSchemas(schema: JsonSchema, visit: (schema: JsonSchema) => void) {
  visit(schema);
  if (schema.properties) {
    for (const child of Object.values(schema.properties)) {
      walkSchemas(child, visit);
    }
  }
  if (schema.items) walkSchemas(schema.items, visit);
  if (schema.$defs) {
    for (const child of Object.values(schema.$defs)) {
      walkSchemas(child, visit);
    }
  }
}

describe("worldbuild Codex output schema", () => {
  it("uses strict object schemas accepted by OpenAI structured outputs", () => {
    walkSchemas(worldbuildOutputSchema, (schema) => {
      if (schema.type !== "object") return;

      expect(schema.additionalProperties).toBe(false);
      expect(schema.required ?? []).toEqual(
        Object.keys(schema.properties ?? {}),
      );
    });
  });

  it("requires a title and text for every setup beat", () => {
    const setupBeats = worldbuildOutputSchema.properties.openingScene.properties
      .introPlan.properties.setupBeats as JsonSchema;

    expect(setupBeats.items).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        text: { type: "string" },
      },
      required: ["title", "text"],
    });
  });
});
