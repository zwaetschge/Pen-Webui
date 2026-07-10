import { describe, expect, it } from "vitest";
import { normalizeOpeningBeats, openingBeatFromLegacy } from "./opening-beat";

describe("opening beats", () => {
  it("preserves explicit titles separately from narration", () => {
    expect(normalizeOpeningBeats([
      { title: "Blicke im Diner", text: "Elinor mustert die Fremden." },
    ])).toEqual([
      { title: "Blicke im Diner", text: "Elinor mustert die Fremden." },
    ]);
  });

  it("finds the acting NPC after an inverted location phrase", () => {
    expect(openingBeatFromLegacy(
      "Im Diner Zur Grauen Wolldecke mustert Elinor Hale die Fremden.",
      0,
    )).toMatchObject({ title: "Begegnung mit Elinor Hale" });
  });

  it("uses a complete neutral title for unknown legacy prose", () => {
    const beat = openingBeatFromLegacy(
      "Hinter den regennassen Fenstern verändert sich etwas Unbestimmtes.",
      2,
    );
    expect(beat?.title).toBe("Ein neuer Moment");
    expect(beat?.title).not.toContain("...");
  });

  it("drops malformed and blank entries and respects the limit", () => {
    expect(normalizeOpeningBeats([
      "  ", { title: "", text: "x" }, "Eins.", "Zwei.",
    ], 1)).toHaveLength(1);
  });
});
