import { describe, expect, it } from "vitest";
import {
  ACTION_INPUT_LABEL,
  actionChoiceButtonClassName,
  actionChoiceGridClassName,
  actionErrorLabel,
  COMBAT_ACTION_BUTTONS,
  combatActionGridClassName,
  explorationInputDisabled,
  queuedActionMessage,
  selectActionCards,
  selectNextActions,
  shouldClearQueueNotice,
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
          nextActions: [
            "Inspect the well",
            "Question the guard",
            "Sneak",
            "Run",
          ],
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

describe("action errors", () => {
  it("explains a busy Codex turn without exposing an internal error code", () => {
    expect(actionErrorLabel("dm_busy", 409)).toBe(
      "Der DM verarbeitet gerade eine andere Aktion. Gleich erneut versuchen.",
    );
  });

  it("turns queue limits into player-facing German", () => {
    expect(actionErrorLabel("turn_queue_actor_limit", 429)).toContain(
      "drei Aktionen vorgemerkt",
    );
    expect(actionErrorLabel("turn_queue_full", 429)).toContain(
      "Tischrunde ist gerade voll",
    );
  });
});

describe("parallel exploration input", () => {
  it("keeps the composer available while Codex resolves another player", () => {
    expect(
      explorationInputDisabled({
        busy: false,
        dmThinking: true,
        blockedByTurn: false,
        sessionEnded: false,
      }),
    ).toBe(false);
  });

  it("describes a queued action with its table position", () => {
    expect(queuedActionMessage(2)).toBe(
      "Aktion vorgemerkt · Position 2 in der Tischrunde",
    );
  });

  it("removes the queued notice once the DM is no longer working", () => {
    expect(shouldClearQueueNotice("Aktion vorgemerkt", false)).toBe(true);
    expect(shouldClearQueueNotice("Aktion vorgemerkt", true)).toBe(false);
    expect(shouldClearQueueNotice(null, false)).toBe(false);
  });

  it("provides a permanent accessible label for the freeform action", () => {
    expect(ACTION_INPUT_LABEL).toBe("Aktion für den Codex-DM beschreiben");
  });
});
