import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  FAN_REFERENCE_CONTRACT,
  WORLDBUILD_PROMPT,
  type WorldDigest,
} from "./prompts";
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

describe("fan campaign reference contract", () => {
  it("treats host-supplied fan campaign names as private table canon", () => {
    const prompt = buildSystemPrompt(
      { theme: "Dragon Ball adventure on Namek", tone: "heroic anime action" },
      digest,
    );

    expect(prompt).toContain("Dragon Ball adventure on Namek");
    expect(prompt).toContain("valid private table");
    expect(prompt).toContain("keep requested worlds");
    expect(prompt).toContain("Do not euphemize,");
    expect(prompt).toContain('"file off serial numbers"');
  });

  it("instructs worldbuilding not to rename requested fan setting anchors", () => {
    expect(FAN_REFERENCE_CONTRACT).toContain(
      "host-supplied fictional or franchise references",
    );
    expect(WORLDBUILD_PROMPT).toContain(
      "Private fan campaign briefs are allowed",
    );
    expect(WORLDBUILD_PROMPT).toContain("other proper nouns unchanged");
    expect(WORLDBUILD_PROMPT).toContain("before inventing substitutes");
    expect(WORLDBUILD_PROMPT).toContain('"file off serial');
  });
});

describe("worldbuild lore prompt contract", () => {
  it("includes uploaded and researched lore as hard worldbuilding context", () => {
    expect(WORLDBUILD_PROMPT).toContain("LORE BIBLE");
    expect(WORLDBUILD_PROMPT).toContain("canonFacts");
    expect(WORLDBUILD_PROMPT).toContain("forbiddenContradictions");
  });

  it("requests titled opening beats without controlling player characters", () => {
    expect(WORLDBUILD_PROMPT).toContain(
      '"setupBeats": [ { "title": string, "text": string } ]',
    );
    expect(WORLDBUILD_PROMPT).toContain("observable action");
    expect(WORLDBUILD_PROMPT).toContain(
      "must not assign thoughts, decisions, dialogue, or actions to player characters",
    );
  });
});

describe("live DM lore digest", () => {
  it("includes compact campaign lore without raw source text", () => {
    const prompt = buildSystemPrompt(
      { theme: "private novel" },
      {
        ...digest,
        loreBible: {
          canonFacts: ["Mira is the heir."],
          adaptationRules: ["Keep Mira's name."],
          forbiddenContradictions: ["Do not make Mira an orphan."],
        },
      },
    );

    expect(prompt).toContain("CAMPAIGN LORE");
    expect(prompt).toContain("Mira is the heir.");
    expect(prompt).toContain("Do not make Mira an orphan.");
    expect(prompt).not.toContain("rawText");
  });
});
