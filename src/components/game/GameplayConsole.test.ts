import { describe, expect, it } from "vitest";
import type { AbilityDefinition } from "@/lib/game/rules/combat";
import {
  abilityActionMode,
  combatActionUrl,
  consoleErrorLabel,
  dmRollUrl,
  dmTurnUrl,
  gameplayStateUrl,
  isVisibleCombatTarget,
  queuedTurnLabel,
  questProgress,
  reactionSecondsRemaining,
  resourceIdForAbilityCost,
  validTargetForAbility,
} from "./GameplayConsole";

const ability: AbilityDefinition = {
  id: "core:test",
  name: "Testangriff",
  source: "core",
  activation: "action",
  cost: { action: 1 },
  target: {
    kind: "enemy",
    minTargets: 1,
    maxTargets: 1,
    range: 6,
    requiresLineOfSight: true,
    includeSelf: false,
    allowDowned: false,
    allowDead: false,
  },
  effects: [],
  concentration: false,
  reactionTriggers: [],
  requiresAdjudication: false,
};

describe("GameplayConsole helpers", () => {
  it("builds authenticated and invite gameplay URLs safely", () => {
    expect(gameplayStateUrl("session one")).toBe(
      "/api/sessions/session%20one/gameplay",
    );
    expect(gameplayStateUrl("session one", "invite/token")).toBe(
      "/api/invite/sessions/session%20one/gameplay/invite%2Ftoken",
    );
    expect(combatActionUrl("session one", "invite/token")).toBe(
      "/api/invite/sessions/session%20one/combat-action/invite%2Ftoken",
    );
    expect(dmTurnUrl("session one", "invite/token")).toBe(
      "/api/invite/sessions/session%20one/turn/invite%2Ftoken",
    );
    expect(dmRollUrl("session one", "invite/token")).toBe(
      "/api/invite/sessions/session%20one/roll/invite%2Ftoken",
    );
  });

  it("rounds reaction time up and clamps expired windows", () => {
    expect(reactionSecondsRemaining(2_001, 1_000)).toBe(2);
    expect(reactionSecondsRemaining(2_000, 1_000)).toBe(1);
    expect(reactionSecondsRemaining(999, 1_000)).toBe(0);
    expect(reactionSecondsRemaining(Number.NaN, 1_000)).toBe(0);
  });

  it("switches between immediate execution and planning", () => {
    expect(
      abilityActionMode({ combatActive: true, canAct: true, completed: false }),
    ).toBe("use_ability");
    expect(
      abilityActionMode({
        combatActive: true,
        canAct: false,
        completed: false,
      }),
    ).toBe("plan_action");
    expect(
      abilityActionMode({ combatActive: true, canAct: true, completed: true }),
    ).toBe("blocked");
    expect(
      abilityActionMode({
        combatActive: false,
        canAct: false,
        completed: false,
      }),
    ).toBe("blocked");
  });

  it("normalizes spell-slot and custom resource identifiers", () => {
    expect(resourceIdForAbilityCost("spellSlot:2")).toBe("spell-slot-2");
    expect(resourceIdForAbilityCost("spell_slot_3")).toBe("spell-slot-3");
    expect(resourceIdForAbilityCost("Ki Points")).toBe("ki-points");
  });

  it("validates enemy and ally targets without accepting a downed target", () => {
    const actor = { id: "hero", team: "player" as const, hp: 8 };
    const enemy = { id: "goblin", team: "monster" as const, hp: 4 };
    const ally = { id: "mage", team: "player" as const, hp: 6 };
    expect(validTargetForAbility(ability, actor, enemy)).toBe(true);
    expect(validTargetForAbility(ability, actor, ally)).toBe(false);
    expect(validTargetForAbility(ability, actor, { ...enemy, hp: 0 })).toBe(
      false,
    );
    expect(validTargetForAbility(ability, actor, null)).toBe(false);
    expect(
      validTargetForAbility(
        { ...ability, target: { ...ability.target, kind: "self" } },
        actor,
        null,
      ),
    ).toBe(true);
  });

  it("hides undiscovered hostiles but keeps downed allies selectable", () => {
    const actor = { id: "hero", team: "player" as const };
    expect(
      isVisibleCombatTarget({
        actor,
        candidate: { id: "hidden-goblin", team: "monster", hp: 5 },
        hiddenTokenIds: ["hidden-goblin"],
        host: false,
      }),
    ).toBe(false);
    expect(
      isVisibleCombatTarget({
        actor,
        candidate: { id: "hidden-goblin", team: "monster", hp: 5 },
        hiddenTokenIds: ["hidden-goblin"],
        host: true,
      }),
    ).toBe(true);
    expect(
      isVisibleCombatTarget({
        actor,
        candidate: { id: "downed-ally", team: "player", hp: 0 },
        hiddenTokenIds: [],
        host: false,
      }),
    ).toBe(true);
  });

  it("derives quest completion from the declared objective order", () => {
    const progress = questProgress({
      id: "q1",
      title: "Die Ruine",
      status: "active",
      objectiveOrder: ["find", "return"],
      objectives: {
        find: {
          id: "find",
          title: "Eingang finden",
          status: "completed",
          progress: 1,
          target: 1,
          optional: false,
        },
        return: {
          id: "return",
          title: "Zurückkehren",
          status: "active",
          progress: 0,
          target: 1,
          optional: false,
        },
        hidden: {
          id: "hidden",
          title: "Nicht gezählt",
          status: "completed",
          progress: 1,
          target: 1,
          optional: true,
        },
      },
    });
    expect(progress).toEqual({ total: 2, completed: 1, percent: 50 });
  });

  it("turns API error codes into concise player-facing copy", () => {
    expect(consoleErrorLabel("not_your_turn", 409)).toContain("noch nicht");
    expect(consoleErrorLabel("unknown_problem", 422)).toBe("Unknown problem");
    expect(consoleErrorLabel(null, 500)).toBe("Befehl fehlgeschlagen (500)");
  });

  it("formats queued DM turns defensively", () => {
    expect(queuedTurnLabel(3.9)).toContain("Position 3");
    expect(queuedTurnLabel(-4)).toContain("Position 1");
    expect(queuedTurnLabel("unknown")).toContain("Position 1");
  });
});
