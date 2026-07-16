import { describe, expect, it } from "vitest";
import {
  activeInitiativeName,
  isActiveTurnForCharacter,
  isActiveTurnForToken,
  isTurnAvailableForToken,
} from "./combat-turn";

const initiative = [
  { name: "Guard", roll: 18, refId: "npc_1" },
  { name: "Robert McBrianson", roll: 14, refId: "char_robert" },
];

describe("combat turn helpers", () => {
  it("matches the active turn by token refId", () => {
    expect(
      isActiveTurnForToken({
        initiative,
        turnIndex: 1,
        token: { id: "char_robert", name: "Robert McBrianson" },
      }),
    ).toBe(true);
    expect(
      isActiveTurnForToken({
        initiative,
        turnIndex: 0,
        token: { id: "char_robert", name: "Robert McBrianson" },
      }),
    ).toBe(false);
  });

  it("falls back to normalized names when refs are absent", () => {
    expect(
      isActiveTurnForCharacter({
        initiative: [{ name: "  Robert   McBrianson ", roll: 12 }],
        turnIndex: 0,
        characterId: "char_robert",
        characterName: "Robert McBrianson",
      }),
    ).toBe(true);
  });

  it("exposes the active combatant label", () => {
    expect(activeInitiativeName(initiative, 0)).toBe("Guard");
    expect(activeInitiativeName([], 0)).toBeNull();
  });

  it("allows every unfinished member of an adjacent player turn group", () => {
    const turnGroup = {
      tokenIds: ["char_robert", "char_mage"],
      completedTokenIds: ["char_robert"],
    };

    expect(
      isTurnAvailableForToken({
        initiative,
        turnIndex: 1,
        token: { id: "char_mage", name: "Mage" },
        turnGroup,
      }),
    ).toBe(true);
    expect(
      isTurnAvailableForToken({
        initiative,
        turnIndex: 1,
        token: { id: "char_robert", name: "Robert McBrianson" },
        turnGroup,
      }),
    ).toBe(false);
    expect(
      isTurnAvailableForToken({
        initiative,
        turnIndex: 1,
        token: { id: "npc_1", name: "Guard" },
        turnGroup,
      }),
    ).toBe(false);
  });
});
