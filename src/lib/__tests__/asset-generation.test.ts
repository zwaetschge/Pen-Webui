import { describe, expect, it } from "vitest";
import { OPENAI_IMAGE_MODEL } from "../asset/openai-image";
import { isAssetTextMatch, scoreAssetTextMatch } from "../asset/match";

describe("asset generation model", () => {
  it("uses gpt-image-2 for dynamic generation", () => {
    expect(OPENAI_IMAGE_MODEL).toBe("gpt-image-2");
  });
});

describe("asset library matching", () => {
  it("ignores shared style words when judging fit", () => {
    const score = scoreAssetTextMatch(
      "Portrait of Borin, old dwarven mine elder, parchment brass fantasy illustration",
      "Portrait of a village elder with carved staff, parchment brass fantasy illustration",
    );
    expect(score).toBeGreaterThan(0.22);
  });

  it("rejects assets that only share generic visual style", () => {
    expect(
      isAssetTextMatch(
        "Top-down tactical goblin mine bridge ambush, brass parchment fantasy",
        "Cinematic portrait of a noble courtier, brass parchment fantasy",
      ),
    ).toBe(false);
  });
});
