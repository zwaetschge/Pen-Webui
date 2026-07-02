import { describe, expect, it } from "vitest";
import { cleanFallbackNarration } from "./orchestrator";

describe("DM fallback narration", () => {
  it("drops fallback content that violates the German style gate", () => {
    expect(
      cleanFallbackNarration(
        "DM: Du kannst fuer mich sichtbar gehen, aber die Dockratten schliessen ihre Muender.",
      ),
    ).toBeNull();
  });

  it("keeps concise idiomatic fallback content", () => {
    expect(
      cleanFallbackNarration(
        "Spielleitung: Mara wartet auf deine Entscheidung.",
      ),
    ).toBe("Mara wartet auf deine Entscheidung.");
  });
});
