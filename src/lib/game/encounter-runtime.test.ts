import { describe, expect, it } from "vitest";
import {
  completedTurnMembers,
  EMPTY_ENCOUNTER_RUNTIME,
  normalizeEncounterRuntime,
  withCompletedTurnMember,
  withPlannedAction,
} from "./encounter-runtime";

describe("encounter runtime", () => {
  it("repairs unknown persisted data to a versioned state", () => {
    expect(normalizeEncounterRuntime({ version: 99, plans: "broken" })).toEqual(
      EMPTY_ENCOUNTER_RUNTIME,
    );
  });

  it("persists plans and clears them once a group member ends their turn", () => {
    const planned = withPlannedAction(EMPTY_ENCOUNTER_RUNTIME, {
      actorTokenId: "char_a",
      abilityId: "basic_attack",
      targetTokenId: "goblin",
      createdAt: 10,
    });
    const completed = withCompletedTurnMember(planned, {
      round: 2,
      startIndex: 0,
      tokenId: "char_a",
    });
    expect(completed.plans.char_a).toBeUndefined();
    expect(completedTurnMembers(completed, 2, 0)).toEqual(["char_a"]);
    expect(completedTurnMembers(completed, 3, 0)).toEqual([]);
  });

  it("drops malformed reaction windows on load", () => {
    expect(
      normalizeEncounterRuntime({
        reaction: { id: "r", openedAt: 20, expiresAt: 10 },
      }).reaction,
    ).toBeNull();
  });
});
