import { describe, expect, it } from "vitest";
import {
  parseCodexModelPages,
  validateCodexModelSelection,
  validateCodexReasoningEffortSelection,
  type CodexModelCatalog,
} from "./codex-models";

function model(
  name: string,
  options?: { hidden?: boolean; isDefault?: boolean },
) {
  return {
    model: name,
    displayName: name.toUpperCase(),
    description: `${name} description`,
    hidden: options?.hidden ?? false,
    isDefault: options?.isDefault ?? false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Quick" },
      { reasoningEffort: "medium", description: "Balanced" },
      { reasoningEffort: "future-effort", description: "Unknown to this CLI" },
    ],
    defaultReasoningEffort: "medium",
  };
}

describe("Codex model catalog", () => {
  it("keeps picker order, filters hidden entries, and tolerates new efforts", () => {
    const models = parseCodexModelPages([
      {
        data: [
          model("gpt-5.5", { isDefault: true }),
          model("internal-preview", { hidden: true }),
          model("gpt-5.4"),
        ],
        nextCursor: "page-2",
      },
      {
        data: [model("gpt-5.4"), model("gpt-5.4-mini")],
        nextCursor: null,
      },
    ]);

    expect(models.map((entry) => entry.model)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
    expect(models[0]).toMatchObject({
      displayName: "GPT-5.5",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Quick" },
        { reasoningEffort: "medium", description: "Balanced" },
      ],
    });
  });

  it("accepts installation defaults and models present in the picker", () => {
    const catalog: CodexModelCatalog = {
      available: true,
      models: parseCodexModelPages([
        { data: [model("gpt-5.5")], nextCursor: null },
      ]),
      detail: "ready",
    };

    expect(validateCodexModelSelection("auto", catalog)).toBeNull();
    expect(validateCodexModelSelection("  gpt-5.5  ", catalog)).toBe("gpt-5.5");
  });

  it("rejects a model that the current Codex picker does not offer", () => {
    const catalog: CodexModelCatalog = {
      available: true,
      models: parseCodexModelPages([
        { data: [model("gpt-5.5")], nextCursor: null },
      ]),
      detail: "ready",
    };

    expect(() => validateCodexModelSelection("gpt-made-up", catalog)).toThrow(
      "not available",
    );
  });

  it("still validates model syntax when catalog discovery is unavailable", () => {
    const unavailable: CodexModelCatalog = {
      available: false,
      models: [],
      detail: "offline",
    };

    expect(validateCodexModelSelection("provider/model-1", unavailable)).toBe(
      "provider/model-1",
    );
    expect(() =>
      validateCodexModelSelection("gpt-5.5 --danger", unavailable),
    ).toThrow("unsupported characters");
  });

  it("rejects a reasoning effort that /model does not support", () => {
    const catalog: CodexModelCatalog = {
      available: true,
      models: parseCodexModelPages([
        { data: [model("gpt-5.5")], nextCursor: null },
      ]),
      detail: "ready",
    };

    expect(() =>
      validateCodexReasoningEffortSelection("gpt-5.5", "minimal", catalog),
    ).toThrow("does not support reasoning effort");
    expect(
      validateCodexReasoningEffortSelection("gpt-5.5", "medium", catalog),
    ).toBe("medium");
    expect(() =>
      validateCodexReasoningEffortSelection("auto", "minimal", catalog),
    ).toThrow("does not support reasoning effort");
  });

  it("keeps custom/offline model settings when Codex cannot describe them", () => {
    const unavailable: CodexModelCatalog = {
      available: false,
      models: [],
      detail: "offline",
    };

    expect(
      validateCodexReasoningEffortSelection(
        "custom-provider/model",
        "minimal",
        unavailable,
      ),
    ).toBe("minimal");
  });
});
