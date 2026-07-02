import { describe, expect, it } from "vitest";
import { combatResourceEvent, resourcesForTurn } from "./combat-resources";

describe("combat resource helpers", () => {
  it("parses action-use events and accumulates dash movement for the turn", () => {
    const dash = combatResourceEvent({
      tokenId: "hero",
      actionType: "dash",
      resource: "action",
      movementBonus: 6,
      round: 2,
      turnIndex: 0,
    });
    const oldRound = combatResourceEvent({
      tokenId: "hero",
      actionType: "dash",
      resource: "action",
      movementBonus: 6,
      round: 1,
      turnIndex: 0,
    });

    expect(dash).not.toBeNull();
    expect(
      resourcesForTurn([dash!, oldRound!], {
        tokenId: "hero",
        round: 2,
        turnIndex: 0,
      }),
    ).toMatchObject({
      actionUsed: true,
      movementBonus: 6,
      dash: true,
    });
  });
});
