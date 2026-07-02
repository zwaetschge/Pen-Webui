import { describe, expect, it } from "vitest";
import {
  actionChoiceButtonClassName,
  actionChoiceGridClassName,
  COMBAT_ACTION_BUTTONS,
  combatActionGridClassName,
  selectActionCards,
  selectNextActions,
} from "./ActionBar";

describe("selectNextActions", () => {
  it("returns a stable empty fallback while bootstrap has not populated actions", () => {
    expect(selectNextActions({ scene: {} })).toBe(
      selectNextActions({ scene: {} }),
    );
  });

  it("returns the server-provided actions by reference", () => {
    const nextActions = ["Inspect the well", "Question the guard"];

    expect(selectNextActions({ scene: { nextActions } })).toBe(nextActions);
  });
});

describe("selectActionCards", () => {
  it("presents at most three numbered playable action cards", () => {
    expect(
      selectActionCards({
        scene: {
          nextActions: ["Inspect the well", "Question the guard", "Sneak", "Run"],
        },
      }),
    ).toEqual([
      { id: "action-1", label: "Inspect the well", shortcut: "1" },
      { id: "action-2", label: "Question the guard", shortcut: "2" },
      { id: "action-3", label: "Sneak", shortcut: "3" },
    ]);
  });
});

describe("action choice layout", () => {
  it("uses a responsive grid instead of a horizontal scroll row", () => {
    const className = actionChoiceGridClassName(3);

    expect(className).toContain("grid");
    expect(className).toContain("grid-cols-1");
    expect(className).toContain("md:grid-cols-3");
    expect(className).not.toContain("overflow-x-auto");
  });

  it("allows long action labels to wrap inside stable buttons", () => {
    const className = actionChoiceButtonClassName();

    expect(className).toContain("w-full");
    expect(className).toContain("min-h-");
    expect(className).toContain("whitespace-normal");
    expect(className).toContain("break-words");
  });
});

describe("combat action layout", () => {
  it("includes actionable bonus and reaction buttons", () => {
    expect(COMBAT_ACTION_BUTTONS.map((button) => button.type)).toEqual([
      "attack",
      "bonus_action",
      "reaction",
      "dash",
      "dodge",
      "disengage",
      "end_turn",
    ]);
  });

  it("wraps combat buttons responsively instead of forcing one narrow row", () => {
    const className = combatActionGridClassName();

    expect(className).toContain("grid-cols-2");
    expect(className).toContain("sm:grid-cols-4");
    expect(className).toContain("xl:grid-cols-7");
    expect(className).not.toContain("grid-cols-5");
  });
});
