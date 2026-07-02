import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type WorldDigest } from "./prompts";
import { allToolDefinitions } from "./tools";

const digest: WorldDigest = {
  campaignTitle: "Lichterkai",
  activeThreads: [],
  recentFacts: [],
  presentNpcs: [],
  characters: [],
};

describe("DM language contract", () => {
  it("pins player-facing German to idiomatic standard German", () => {
    const prompt = buildSystemPrompt(
      { theme: "Gothic harbor mystery", tone: "tense" },
      digest,
    );

    expect(prompt).toContain("Write idiomatic contemporary Standard German");
    expect(prompt).toContain("Do not invent dialects");
    expect(prompt).toContain("made-up harbor slang");
    expect(prompt).toContain("NPC voice comes from priorities");
    expect(prompt).toContain("Avoid literal English calques");
  });

  it("keeps the narrate tool aligned with the German style contract", () => {
    const narrateTool = allToolDefinitions().find(
      (tool) => tool.function.name === "narrate",
    );

    expect(narrateTool?.function.description).toContain(
      "idiomatic contemporary Standard German",
    );
    expect(narrateTool?.function.description).toContain(
      "Do not invent dialects",
    );
    expect(narrateTool?.function.description).toContain(
      "Avoid literal English calques",
    );
  });
});
