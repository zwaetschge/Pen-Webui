import { describe, expect, it } from "vitest";
import {
  abilitiesFromCharacterSheet,
  advanceStatuses,
  applyDamage,
  applyHealing,
  applyStatusEffect,
  canPayAbilityCost,
  concentrationCheckDc,
  createReactionWindow,
  createTurnResources,
  deriveStatusModifiers,
  endConcentration,
  expireReactionWindow,
  reactionAbilitiesForTrigger,
  resolveAttack,
  resolveConcentrationCheck,
  resolveDeathSave,
  resolveSavingThrow,
  respondToReactionWindow,
  revive,
  spendAbilityCost,
  stabilize,
  startConcentration,
  validateAbilityTargets,
  type AbilityDefinition,
  type CombatantState,
} from "./combat";

function combatant(
  input: Partial<CombatantState> & Pick<CombatantState, "id">,
): CombatantState {
  return {
    id: input.id,
    team: input.team ?? "party",
    hpCurrent: input.hpCurrent ?? 10,
    hpMax: input.hpMax ?? 10,
    temporaryHp: input.temporaryHp ?? 0,
    lifeState: input.lifeState ?? "active",
    deathSaves: input.deathSaves ?? { successes: 0, failures: 0 },
    statuses: input.statuses ?? [],
    concentration: input.concentration ?? null,
  };
}

function reactionAbility(
  overrides: Partial<AbilityDefinition> = {},
): AbilityDefinition {
  return {
    id: "feature:parry",
    name: "Parry",
    source: "feature",
    activation: "reaction",
    cost: { reaction: 1 },
    target: {
      kind: "self",
      minTargets: 1,
      maxTargets: 1,
      range: 0,
      requiresLineOfSight: false,
      includeSelf: true,
      allowDowned: false,
      allowDead: false,
    },
    effects: [{ kind: "status", status: "shielded", durationRounds: 1 }],
    concentration: false,
    reactionTriggers: ["targeted_by_attack"],
    requiresAdjudication: false,
    ...overrides,
  };
}

describe("data-driven abilities", () => {
  it("adds stable core abilities for a minimal current character sheet", () => {
    const abilities = abilitiesFromCharacterSheet({
      abilities: { str: 16, dex: 12 },
      proficiencyBonus: 2,
    });

    expect(abilities.map((ability) => ability.id)).toEqual(
      expect.arrayContaining([
        "core:attack",
        "core:dash",
        "core:disengage",
        "core:dodge",
        "core:stabilize",
        "core:guard",
        "core:opportunity-attack",
      ]),
    );
    expect(
      abilities.find((ability) => ability.id === "core:attack"),
    ).toMatchObject({
      activation: "action",
      cost: { action: 1 },
      effects: [
        {
          kind: "attack",
          ability: "str",
          attackBonus: 5,
          damage: "1d8+3",
        },
      ],
    });
  });

  it("uses dexterity for the default attack when it is the stronger score", () => {
    const attack = abilitiesFromCharacterSheet({
      abilities: { str: 8, dex: 18 },
      proficiencyBonus: 3,
    }).find((ability) => ability.id === "core:attack");

    expect(attack?.effects[0]).toMatchObject({
      kind: "attack",
      ability: "dex",
      attackBonus: 7,
      damage: "1d8+4",
    });
  });

  it("parses current spells and features while excluding unprepared spells", () => {
    const abilities = abilitiesFromCharacterSheet({
      spells: [
        { name: "Fire Bolt", level: 0, prepared: true },
        { name: "Sleep", level: 1, prepared: false },
      ],
      features: [
        {
          name: "Second Wind",
          source: "Fighter",
          description: "Use as a bonus action to recover hit points.",
        },
      ],
    });

    expect(abilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "spell:fire-bolt",
          activation: "action",
          requiresAdjudication: true,
        }),
        expect.objectContaining({
          id: "feature:second-wind",
          activation: "bonusAction",
          cost: { bonusAction: 1 },
        }),
      ]),
    );
    expect(abilities.some((ability) => ability.id === "spell:sleep")).toBe(
      false,
    );
  });

  it("honours extended combat metadata and adds a spell-slot cost", () => {
    const ability = abilitiesFromCharacterSheet({
      spells: [
        {
          name: "Restoring Word",
          level: 2,
          prepared: true,
          combat: {
            activation: "bonusAction",
            target: {
              kind: "ally",
              range: 12,
              includeSelf: true,
              allowDowned: true,
            },
            effects: [{ kind: "heal", amount: "1d4+3" }],
            resourceCosts: { focus: 2 },
            concentration: false,
          },
        },
      ],
    }).find((entry) => entry.id === "spell:restoring-word");

    expect(ability).toMatchObject({
      activation: "bonusAction",
      cost: {
        bonusAction: 1,
        resources: { "spellSlot:2": 1, focus: 2 },
      },
      target: {
        kind: "ally",
        range: 12,
        includeSelf: true,
        allowDowned: true,
      },
      effects: [{ kind: "heal", amount: "1d4+3" }],
      requiresAdjudication: false,
    });
  });

  it("deduplicates sheet entries into stable ids", () => {
    const abilities = abilitiesFromCharacterSheet({
      spells: [
        { name: "Fire Bolt", level: 0, prepared: true },
        { name: "Fire Bolt", level: 0, prepared: true },
      ],
    });

    expect(
      abilities.filter((ability) => ability.id === "spell:fire-bolt"),
    ).toHaveLength(1);
  });
});

describe("action economy and resource pools", () => {
  it("spends action, movement and named resources without mutating input", () => {
    const current = createTurnResources({
      movement: 6,
      resources: { focus: 3 },
    });
    const result = spendAbilityCost(current, {
      action: 1,
      movement: 2,
      resources: { focus: 2 },
    });

    expect(result).toEqual({
      ok: true,
      state: {
        action: 0,
        bonusAction: 1,
        reaction: 1,
        movement: 4,
        resources: { focus: 1 },
      },
    });
    expect(current).toMatchObject({
      action: 1,
      movement: 6,
      resources: { focus: 3 },
    });
  });

  it("reports every missing resource and leaves state unchanged", () => {
    const current = createTurnResources({
      action: 0,
      movement: 1,
      resources: { focus: 1 },
    });
    const cost = { action: 1, movement: 2, resources: { focus: 3, rage: 1 } };

    expect(canPayAbilityCost(current, cost)).toEqual({
      ok: false,
      missing: { action: 1, movement: 1, focus: 2, rage: 1 },
    });
    expect(spendAbilityCost(current, cost)).toEqual({
      ok: false,
      state: current,
      missing: { action: 1, movement: 1, focus: 2, rage: 1 },
    });
  });
});

describe("target validation", () => {
  const attack = reactionAbility({
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
  });
  const actor = { id: "hero", team: "party" };

  it("accepts a visible enemy in range", () => {
    expect(
      validateAbilityTargets(attack, actor, [
        {
          id: "goblin",
          team: "enemy",
          distance: 5,
          lineOfSight: true,
          lifeState: "active",
        },
      ]),
    ).toEqual({ ok: true, issues: [] });
  });

  it("returns relation, range, sight and life-state issues", () => {
    const result = validateAbilityTargets(attack, actor, [
      {
        id: "ally",
        team: "party",
        distance: 9,
        lineOfSight: false,
        lifeState: "dead",
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid_relation",
        "out_of_range",
        "line_of_sight",
        "dead_not_allowed",
      ]),
    );
  });

  it("rejects duplicate targets and a wrong target count", () => {
    const target = {
      id: "goblin",
      team: "enemy",
      distance: 2,
      lineOfSight: true,
      lifeState: "active" as const,
    };
    const result = validateAbilityTargets(attack, actor, [target, target]);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["target_count", "duplicate_target"]),
    );
  });
});

describe("attack and saving throw resolution", () => {
  it.each([
    { roll: 1, bonus: 20, ac: 5, hit: false, critical: false },
    { roll: 20, bonus: -5, ac: 30, hit: true, critical: true },
    { roll: 12, bonus: 5, ac: 17, hit: true, critical: false },
    { roll: 11, bonus: 5, ac: 17, hit: false, critical: false },
  ])("resolves attack roll $roll", ({ roll, bonus, ac, hit, critical }) => {
    expect(
      resolveAttack({ roll, attackBonus: bonus, targetArmorClass: ac }),
    ).toMatchObject({ hit, critical, total: roll + bonus });
  });

  it("resolves saves at the DC without automatic natural-one failure", () => {
    expect(resolveSavingThrow({ roll: 9, modifier: 4, dc: 13 })).toMatchObject({
      success: true,
      total: 13,
    });
    expect(resolveSavingThrow({ roll: 1, modifier: 20, dc: 18 })).toMatchObject(
      { success: true, total: 21 },
    );
  });
});

describe("damage, healing and life-state transitions", () => {
  it("consumes temporary hp before normal hp", () => {
    const result = applyDamage(
      combatant({ id: "hero", hpCurrent: 10, temporaryHp: 4 }),
      6,
    );

    expect(result).toMatchObject({
      absorbedByTemporaryHp: 4,
      hpLost: 2,
      state: { hpCurrent: 8, temporaryHp: 0, lifeState: "active" },
    });
  });

  it("makes a character downed rather than dead at zero hp", () => {
    const result = applyDamage(combatant({ id: "hero", hpCurrent: 4 }), 5);

    expect(result.state).toMatchObject({
      hpCurrent: 0,
      lifeState: "downed",
      deathSaves: { successes: 0, failures: 0 },
    });
    expect(result.state.statuses).toContainEqual(
      expect.objectContaining({ id: "unconscious" }),
    );
  });

  it("kills immediately only when zero-hp overflow reaches maximum hp", () => {
    const result = applyDamage(
      combatant({ id: "hero", hpCurrent: 2, hpMax: 10 }),
      12,
    );

    expect(result.state.lifeState).toBe("dead");
  });

  it("adds death-save failures when a downed character takes damage", () => {
    const downed = combatant({
      id: "hero",
      hpCurrent: 0,
      lifeState: "downed",
      deathSaves: { successes: 1, failures: 0 },
    });

    expect(applyDamage(downed, 2).state.deathSaves.failures).toBe(1);
    expect(applyDamage(downed, 2, { critical: true }).state).toMatchObject({
      lifeState: "downed",
      deathSaves: { successes: 1, failures: 2 },
    });
  });

  it("makes a damaged stable character unstable with a fresh save track", () => {
    const stable = combatant({
      id: "hero",
      hpCurrent: 0,
      lifeState: "stable",
      deathSaves: { successes: 3, failures: 2 },
    });

    expect(applyDamage(stable, 1).state).toMatchObject({
      lifeState: "downed",
      deathSaves: { successes: 0, failures: 1 },
    });
  });

  it("healing wakes a downed or stable character and resets death saves", () => {
    const state = combatant({
      id: "hero",
      hpCurrent: 0,
      lifeState: "stable",
      deathSaves: { successes: 3, failures: 1 },
      statuses: [{ id: "unconscious" }],
    });

    expect(applyHealing(state, 4).state).toEqual(
      expect.objectContaining({
        hpCurrent: 4,
        lifeState: "active",
        deathSaves: { successes: 0, failures: 0 },
        statuses: [],
      }),
    );
  });

  it("ordinary healing cannot return a dead character", () => {
    const dead = combatant({ id: "hero", hpCurrent: 0, lifeState: "dead" });
    expect(applyHealing(dead, 10).state).toEqual(dead);
  });
});

describe("death saves, stabilization and revival", () => {
  it("a natural twenty returns a downed character at one hp", () => {
    const state = combatant({ id: "hero", hpCurrent: 0, lifeState: "downed" });
    expect(resolveDeathSave(state, 20)).toMatchObject({
      outcome: "revived",
      state: { hpCurrent: 1, lifeState: "active" },
    });
  });

  it("a natural one records two failures and three failures kill", () => {
    const state = combatant({
      id: "hero",
      hpCurrent: 0,
      lifeState: "downed",
      deathSaves: { successes: 0, failures: 1 },
    });
    expect(resolveDeathSave(state, 1)).toMatchObject({
      outcome: "dead",
      state: {
        lifeState: "dead",
        deathSaves: { successes: 0, failures: 3 },
      },
    });
  });

  it("three successful saves stabilize", () => {
    const state = combatant({
      id: "hero",
      hpCurrent: 0,
      lifeState: "downed",
      deathSaves: { successes: 2, failures: 1 },
    });
    expect(resolveDeathSave(state, 10)).toMatchObject({
      outcome: "stabilized",
      state: {
        lifeState: "stable",
        deathSaves: { successes: 0, failures: 0 },
      },
    });
  });

  it("stabilize and revive are explicit, deterministic transitions", () => {
    const downed = combatant({ id: "hero", hpCurrent: 0, lifeState: "downed" });
    const stable = stabilize(downed);
    expect(stable).toMatchObject({
      lifeState: "stable",
      deathSaves: { successes: 0, failures: 0 },
    });

    const dead = { ...stable, lifeState: "dead" as const };
    expect(revive(dead, 3)).toMatchObject({
      lifeState: "active",
      hpCurrent: 3,
      deathSaves: { successes: 0, failures: 0 },
    });
  });
});

describe("concentration transitions", () => {
  it("replaces old concentration and reports the transition", () => {
    const state = combatant({
      id: "hero",
      concentration: { abilityId: "spell:bless", startedRound: 1 },
    });
    const result = startConcentration(state, {
      abilityId: "spell:hold-person",
      startedRound: 2,
    });

    expect(result.transition).toEqual({
      previous: { abilityId: "spell:bless", startedRound: 1 },
      current: { abilityId: "spell:hold-person", startedRound: 2 },
      reason: "replaced",
    });
  });

  it("uses max(10, half damage) and ends concentration on a failed check", () => {
    expect(concentrationCheckDc(8)).toBe(10);
    expect(concentrationCheckDc(30)).toBe(15);

    const state = combatant({
      id: "hero",
      concentration: { abilityId: "spell:bless" },
    });
    const failed = resolveConcentrationCheck(state, {
      damage: 30,
      roll: 10,
      constitutionSaveModifier: 4,
    });
    expect(failed).toMatchObject({ success: false, dc: 15, total: 14 });
    expect(failed.state.concentration).toBeNull();

    const passed = resolveConcentrationCheck(state, {
      damage: 6,
      roll: 7,
      constitutionSaveModifier: 3,
    });
    expect(passed).toMatchObject({ success: true, dc: 10, total: 10 });
    expect(passed.state.concentration).toEqual(state.concentration);
  });

  it("damage that causes unconsciousness immediately ends concentration", () => {
    const state = combatant({
      id: "hero",
      hpCurrent: 3,
      concentration: { abilityId: "spell:bless" },
    });
    const result = applyDamage(state, 4);

    expect(result.state.concentration).toBeNull();
    expect(result.concentrationTransition).toMatchObject({
      previous: { abilityId: "spell:bless" },
      current: null,
      reason: "incapacitated",
    });
  });

  it("damage fully absorbed by temporary hp still requires concentration", () => {
    const state = combatant({
      id: "hero",
      hpCurrent: 8,
      temporaryHp: 10,
      concentration: { abilityId: "spell:bless" },
    });
    const result = applyDamage(state, 6);

    expect(result).toMatchObject({
      absorbedByTemporaryHp: 6,
      hpLost: 0,
      concentrationCheckRequired: true,
      concentrationDc: 10,
      state: { hpCurrent: 8, temporaryHp: 4, lifeState: "active" },
    });
  });

  it("can end concentration explicitly", () => {
    const state = combatant({
      id: "hero",
      concentration: { abilityId: "spell:bless" },
    });
    expect(endConcentration(state, "cancelled").transition.reason).toBe(
      "cancelled",
    );
  });
});

describe("status effects and deterministic hooks", () => {
  it("combines built-in modifiers and cancels advantage with disadvantage", () => {
    const modifiers = deriveStatusModifiers([
      { id: "poisoned" },
      { id: "invisible" },
      { id: "shielded" },
      { id: "slowed" },
    ]);

    expect(modifiers).toMatchObject({
      attackAdvantage: "normal",
      incomingAttackAdvantage: "disadvantage",
      armorClass: 5,
      speedMultiplier: 0.5,
      canAct: true,
      canMove: true,
    });
  });

  it("models incapacitating and contextual prone hooks", () => {
    expect(deriveStatusModifiers([{ id: "stunned" }])).toMatchObject({
      canAct: false,
      canMove: false,
      breaksConcentration: true,
      autoFailSaves: ["str", "dex"],
    });
    expect(
      deriveStatusModifiers([{ id: "prone" }], {
        incomingAttackDistance: 1,
      }).incomingAttackAdvantage,
    ).toBe("advantage");
    expect(
      deriveStatusModifiers([{ id: "prone" }], {
        incomingAttackDistance: 4,
      }).incomingAttackAdvantage,
    ).toBe("disadvantage");
  });

  it("applies custom modifiers and breaks concentration when required", () => {
    const state = combatant({
      id: "hero",
      concentration: { abilityId: "spell:bless" },
    });
    const result = applyStatusEffect(state, {
      kind: "status",
      status: "petrified",
      durationRounds: 2,
      modifiers: { canAct: false, breaksConcentration: true, armorClass: 2 },
    });

    expect(result.state.statuses[0]).toMatchObject({
      id: "petrified",
      durationRounds: 2,
    });
    expect(result.state.concentration).toBeNull();
    expect(deriveStatusModifiers(result.state.statuses).armorClass).toBe(2);
  });

  it("advances timed statuses without mutating permanent statuses", () => {
    expect(
      advanceStatuses([
        { id: "blinded", durationRounds: 1 },
        { id: "poisoned", durationRounds: 3 },
        { id: "cursed" },
      ]),
    ).toEqual([{ id: "poisoned", durationRounds: 2 }, { id: "cursed" }]);
  });
});

describe("reaction triggers and windows", () => {
  const parry = reactionAbility();
  const opportunity = reactionAbility({
    id: "core:opportunity-attack",
    reactionTriggers: ["leaves_reach"],
  });

  it("filters reactions by trigger and available economy", () => {
    expect(
      reactionAbilitiesForTrigger(
        [parry, opportunity],
        "targeted_by_attack",
        createTurnResources(),
      ).map((ability) => ability.id),
    ).toEqual(["feature:parry"]);

    expect(
      reactionAbilitiesForTrigger(
        [parry],
        "targeted_by_attack",
        createTurnResources({ reaction: 0 }),
      ),
    ).toEqual([]);
  });

  it("accepts a valid response and deterministically resolves the window", () => {
    const window = createReactionWindow({
      id: "rw_1",
      trigger: {
        id: "trigger_1",
        kind: "targeted_by_attack",
        actorId: "goblin",
        targetIds: ["hero"],
        round: 2,
        turnIndex: 1,
      },
      openedAt: 100,
      expiresAt: 200,
      eligible: { hero: ["feature:parry"], bard: ["feature:cutting-words"] },
    });
    const result = respondToReactionWindow(window, {
      combatantId: "hero",
      abilityId: "feature:parry",
      respondedAt: 120,
    });

    expect(result.ok).toBe(true);
    expect(result.window).toMatchObject({
      status: "resolved",
      accepted: {
        combatantId: "hero",
        abilityId: "feature:parry",
        respondedAt: 120,
      },
    });
    expect(window.status).toBe("open");
  });

  it("rejects ineligible responses and resolves when everyone passes", () => {
    const window = createReactionWindow({
      id: "rw_1",
      trigger: {
        id: "trigger_1",
        kind: "spell_cast",
        actorId: "mage",
        targetIds: [],
        round: 1,
        turnIndex: 0,
      },
      openedAt: 0,
      expiresAt: 100,
      eligible: { hero: ["spell:counterspell"], bard: [] },
    });

    expect(
      respondToReactionWindow(window, {
        combatantId: "hero",
        abilityId: "feature:parry",
        respondedAt: 10,
      }),
    ).toMatchObject({ ok: false, error: "ineligible_ability" });

    const heroPass = respondToReactionWindow(window, {
      combatantId: "hero",
      abilityId: null,
      respondedAt: 10,
    });
    expect(heroPass.window.status).toBe("resolved");
    expect(heroPass.window.accepted).toBeNull();
  });

  it("expires an open window at its caller-supplied deadline", () => {
    const window = createReactionWindow({
      id: "rw_1",
      trigger: {
        id: "trigger_1",
        kind: "takes_damage",
        actorId: "goblin",
        targetIds: ["hero"],
        round: 1,
        turnIndex: 0,
      },
      openedAt: 100,
      expiresAt: 200,
      eligible: { hero: ["feature:retaliate"] },
    });

    expect(expireReactionWindow(window, 199).status).toBe("open");
    expect(expireReactionWindow(window, 200).status).toBe("expired");
  });
});
