import { describe, expect, it } from "vitest";
import {
  activeTurnGroup,
  normalizePlannedAction,
  remainingGroupTokenIds,
  tokenCanActInGroup,
} from "./turn-groups";

const initiative = [
  { name: "A", roll: 18, refId: "a" },
  { name: "B", roll: 17, refId: "b" },
  { name: "Goblin", roll: 12, refId: "g" },
  { name: "C", roll: 8, refId: "c" },
];
const tokens = [
  { id: "a", name: "A", x: 0, y: 0, hp: 5, team: "player" as const },
  { id: "b", name: "B", x: 1, y: 0, hp: 5, team: "player" as const },
  { id: "g", name: "Goblin", x: 2, y: 0, hp: 5, team: "monster" as const },
  { id: "c", name: "C", x: 3, y: 0, hp: 5, team: "player" as const },
];

describe("turn groups", () => {
  it("groups adjacent living allies without crossing an enemy", () => {
    expect(activeTurnGroup(initiative, 0, tokens)).toEqual({
      team: "player",
      startIndex: 0,
      endIndex: 1,
      tokenIds: ["a", "b"],
    });
  });

  it("tracks each group member independently", () => {
    const group = activeTurnGroup(initiative, 0, tokens);
    expect(tokenCanActInGroup("b", group, ["a"])).toBe(true);
    expect(tokenCanActInGroup("a", group, ["a"])).toBe(false);
    expect(remainingGroupTokenIds(group, ["a"])).toEqual(["b"]);
  });

  it("keeps downed players in the group for death saves", () => {
    const defeated = tokens.map((token) =>
      token.id === "b" ? { ...token, hp: 0 } : token,
    );
    expect(activeTurnGroup(initiative, 0, defeated)?.tokenIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("normalizes durable action plans", () => {
    expect(
      normalizePlannedAction({
        actorTokenId: " a ",
        abilityId: " shove ",
        targetTokenId: "g",
        targetCell: { x: 2, y: 3 },
        createdAt: 42,
      }),
    ).toEqual({
      actorTokenId: "a",
      abilityId: "shove",
      targetTokenId: "g",
      targetCell: { x: 2, y: 3 },
      createdAt: 42,
    });
  });
});
