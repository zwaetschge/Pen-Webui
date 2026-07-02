import { describe, expect, it } from "vitest";
import {
  dieGeometryKind,
  latestDiceRoll,
  visibleDiceForRoll,
} from "./dice-visual";
import type { ChatLine } from "./store";

describe("dice visual helpers", () => {
  it("selects the latest roll from chat", () => {
    const chat: ChatLine[] = [
      { kind: "narrate", id: "n1", ts: 1, text: "Los." },
      {
        kind: "roll",
        id: "r1",
        ts: 2,
        actor: "player",
        notation: "1d20",
        total: 11,
        breakdown: "1d20[11]",
      },
      {
        kind: "roll",
        id: "r2",
        ts: 3,
        actor: "dm",
        notation: "2d6",
        total: 8,
        breakdown: "2d6[3,5]",
      },
    ];

    expect(latestDiceRoll(chat)?.id).toBe("r2");
  });

  it("limits visible dice while preserving the overflow count", () => {
    const roll: Extract<ChatLine, { kind: "roll" }> = {
      kind: "roll",
      id: "r1",
      ts: 1,
      actor: "player",
      notation: "10d6",
      total: 35,
      breakdown: "10d6[...]",
      dice: Array.from({ length: 10 }, (_, index) => ({
        sides: 6,
        value: index + 1,
      })),
    };

    expect(visibleDiceForRoll(roll, 6)).toMatchObject({
      extraCount: 4,
      dice: [
        { sides: 6, value: 1 },
        { sides: 6, value: 2 },
        { sides: 6, value: 3 },
        { sides: 6, value: 4 },
        { sides: 6, value: 5 },
        { sides: 6, value: 6 },
      ],
    });
  });

  it("falls back to one visual die for older roll events without dice payloads", () => {
    const roll: Extract<ChatLine, { kind: "roll" }> = {
      kind: "roll",
      id: "old",
      ts: 1,
      actor: "dm",
      notation: "1d20+5",
      total: 17,
      breakdown: "12 + 5",
    };

    expect(visibleDiceForRoll(roll).dice).toEqual([
      { sides: 20, value: 17 },
    ]);
  });

  it("maps common tabletop dice to 3d geometry names", () => {
    expect(dieGeometryKind(4)).toBe("d4");
    expect(dieGeometryKind(6)).toBe("d6");
    expect(dieGeometryKind(20)).toBe("d20");
    expect(dieGeometryKind(13)).toBe("generic");
  });
});
