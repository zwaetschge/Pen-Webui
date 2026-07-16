import { describe, expect, it } from "vitest";

import {
  averageCombatAiAmount,
  chooseCombatAiAction,
  combatAiIntentPayload,
  isAbilityLegalForCombatAi,
  rankCombatAiActions,
  type CombatAiContext,
  type CombatAiUnit,
} from "./combat-ai";
import {
  createTurnResources,
  type AbilityDefinition,
  type AbilityEffect,
} from "./rules/combat";
import { gridDistance, normalizeTacticalGrid } from "./rules/tactical";

function unit(
  id: string,
  team: string,
  x: number,
  y: number,
  overrides: Partial<CombatAiUnit> = {},
): CombatAiUnit {
  return {
    id,
    team,
    position: { x, y },
    hpCurrent: 10,
    hpMax: 10,
    armorClass: 12,
    threat: 1,
    ...overrides,
  };
}

function ability(
  id: string,
  effects: AbilityEffect[],
  overrides: Partial<AbilityDefinition> = {},
): AbilityDefinition {
  return {
    id,
    name: id,
    source: "feature",
    activation: "action",
    cost: { action: 1 },
    target: {
      kind: "enemy",
      minTargets: 1,
      maxTargets: 1,
      range: 10,
      requiresLineOfSight: true,
      includeSelf: false,
      allowDowned: false,
      allowDead: false,
    },
    effects,
    concentration: false,
    reactionTriggers: [],
    requiresAdjudication: false,
    ...overrides,
  };
}

function context(overrides: Partial<CombatAiContext> = {}): CombatAiContext {
  return {
    actor: unit("goblin", "monster", 1, 1),
    allies: [],
    enemies: [unit("hero", "player", 2, 1)],
    abilities: [
      ability("slash", [
        {
          kind: "attack",
          ability: "str",
          attackBonus: 5,
          damage: "1d8+2",
          damageType: "slashing",
        },
      ]),
    ],
    turnResources: createTurnResources({ movement: 0 }),
    grid: normalizeTacticalGrid({ columns: 7, rows: 7 }),
    seed: "encounter-1:round-1:goblin",
    ...overrides,
  };
}

describe("combat AI legality", () => {
  it("only ranks executable, affordable, non-reaction abilities", () => {
    const attack = ability("attack", [
      { kind: "damage", amount: 5, damageType: "piercing" },
    ]);
    const expensive = ability(
      "expensive",
      [{ kind: "damage", amount: 30, damageType: "force" }],
      { cost: { action: 1, resources: { focus: 1 } } },
    );
    const reaction = ability("parry", [], {
      activation: "reaction",
      cost: { reaction: 1 },
    });
    const narrativeOnly = ability("improvise", [], {
      requiresAdjudication: true,
    });
    const input = context({
      abilities: [attack, expensive, reaction, narrativeOnly],
    });

    expect(isAbilityLegalForCombatAi(input, attack)).toBe(true);
    expect(isAbilityLegalForCombatAi(input, expensive)).toBe(false);
    expect(isAbilityLegalForCombatAi(input, reaction)).toBe(false);
    expect(isAbilityLegalForCombatAi(input, narrativeOnly)).toBe(false);
    expect(
      rankCombatAiActions(input)
        .filter((candidate) => candidate.kind === "ability")
        .map((candidate) => candidate.abilityId),
    ).toEqual(["attack"]);
  });

  it("rejects targets outside range or line of sight", () => {
    const shortAttack = ability(
      "short",
      [{ kind: "damage", amount: 8, damageType: "piercing" }],
      { target: { ...ability("x", []).target, range: 1 } },
    );
    const result = chooseCombatAiAction(
      context({
        enemies: [unit("hero", "player", 4, 1)],
        abilities: [shortAttack],
      }),
    );
    expect(result.kind).toBe("end-turn");

    const blocked = chooseCombatAiAction(
      context({
        enemies: [unit("hero", "player", 4, 1)],
        abilities: [ability("ranged", [{ kind: "damage", amount: 8, damageType: "piercing" }])],
        grid: normalizeTacticalGrid({
          columns: 7,
          rows: 7,
          blocked: [{ x: 2, y: 1 }],
        }),
      }),
    );
    expect(blocked.kind).toBe("end-turn");
  });

  it("builds legal multi-target choices without duplicate targets", () => {
    const cleave = ability(
      "cleave",
      [{ kind: "damage", amount: 4, damageType: "slashing" }],
      {
        target: {
          ...ability("x", []).target,
          minTargets: 2,
          maxTargets: 2,
        },
      },
    );
    const result = chooseCombatAiAction(
      context({
        abilities: [cleave],
        enemies: [
          unit("hero-a", "player", 2, 1),
          unit("hero-b", "player", 2, 2),
        ],
      }),
    );
    expect(result).toMatchObject({
      kind: "ability",
      abilityId: "cleave",
      targetIds: ["hero-a", "hero-b"],
    });
  });
});

describe("combat AI target selection", () => {
  it("finishes the weakest target when threat is otherwise equal", () => {
    const result = chooseCombatAiAction(
      context({
        enemies: [
          unit("healthy", "player", 3, 1, { hpCurrent: 20, hpMax: 20 }),
          unit("wounded", "player", 2, 1, { hpCurrent: 2, hpMax: 20 }),
        ],
      }),
    );
    expect(result).toMatchObject({ kind: "ability", targetIds: ["wounded"] });
    expect(result.reasons).toContain("finishing-blow");
  });

  it("can prioritize a much more dangerous target over a wounded one", () => {
    const result = chooseCombatAiAction(
      context({
        enemies: [
          unit("almost-down", "player", 2, 1, {
            hpCurrent: 1,
            hpMax: 20,
            threat: 0,
          }),
          unit("wizard", "player", 3, 1, {
            hpCurrent: 20,
            hpMax: 20,
            threat: 10,
            concentrating: true,
          }),
        ],
      }),
    );
    expect(result).toMatchObject({ kind: "ability", targetIds: ["wizard"] });
    expect(result.reasons).toContain("dangerous-target");
  });

  it("exploits a lightning and water surface combination", () => {
    const lightning = ability("lightning", [
      { kind: "damage", amount: 5, damageType: "lightning" },
    ]);
    const result = chooseCombatAiAction(
      context({
        abilities: [lightning],
        enemies: [
          unit("dry", "player", 3, 1),
          unit("wet", "player", 3, 2),
        ],
        grid: normalizeTacticalGrid({
          columns: 7,
          rows: 7,
          surfaces: [{ x: 3, y: 2, type: "water" }],
        }),
      }),
    );
    expect(result).toMatchObject({ kind: "ability", targetIds: ["wet"] });
  });

  it("prefers an effective heal over attacking at critical health", () => {
    const selfHeal = ability(
      "second-wind",
      [{ kind: "heal", amount: 7 }],
      {
        activation: "bonusAction",
        cost: { bonusAction: 1 },
        target: {
          ...ability("x", []).target,
          kind: "self",
          range: 0,
          includeSelf: true,
        },
      },
    );
    const input = context({
      actor: unit("goblin", "monster", 1, 1, {
        hpCurrent: 2,
        hpMax: 20,
      }),
      abilities: [...context().abilities, selfHeal],
    });
    expect(chooseCombatAiAction(input)).toMatchObject({
      kind: "ability",
      abilityId: "second-wind",
      intent: "heal",
    });
  });
});

describe("combat AI tactical positioning", () => {
  it("retreats from nearby enemies below the configured HP threshold", () => {
    const input = context({
      actor: unit("goblin", "monster", 3, 3, {
        hpCurrent: 2,
        hpMax: 10,
      }),
      enemies: [unit("hero", "player", 3, 2)],
      abilities: [],
      turnResources: createTurnResources({ action: 0, movement: 3 }),
    });
    const result = chooseCombatAiAction(input);
    expect(result.kind).toBe("move");
    if (result.kind !== "move") throw new Error("expected movement");
    expect(result.intent).toBe("retreat");
    expect(result.reasons).toContain("low-hp-retreat");
    expect(gridDistance(result.destination, input.enemies[0].position)).toBeGreaterThan(
      gridDistance(input.actor.position, input.enemies[0].position),
    );
  });

  it("claims cover and high ground when repositioning", () => {
    const result = chooseCombatAiAction(
      context({
        actor: unit("archer", "monster", 1, 2),
        enemies: [unit("hero", "player", 5, 2)],
        abilities: [],
        turnResources: createTurnResources({ action: 0, movement: 1 }),
        grid: normalizeTacticalGrid({
          columns: 7,
          rows: 7,
          elevations: [{ x: 2, y: 3, elevation: 3 }],
          coverCells: [{ x: 2, y: 3, level: "half" }],
        }),
      }),
    );
    expect(result).toMatchObject({
      kind: "move",
      destination: { x: 2, y: 3 },
    });
    expect(result.reasons).toContain("claims-high-ground");
    expect(result.reasons).toContain("gains-cover");
  });

  it("avoids ending a move in a damaging surface", () => {
    const result = chooseCombatAiAction(
      context({
        actor: unit("goblin", "monster", 1, 1),
        enemies: [unit("hero", "player", 4, 1)],
        abilities: [],
        turnResources: createTurnResources({ action: 0, movement: 1 }),
        grid: normalizeTacticalGrid({
          columns: 7,
          rows: 7,
          surfaces: [{ x: 2, y: 1, type: "fire", intensity: 3 }],
        }),
      }),
    );
    expect(result.kind).toBe("move");
    if (result.kind !== "move") throw new Error("expected movement");
    expect(result.destination).not.toEqual({ x: 2, y: 1 });
  });

  it("moves toward a high-priority encounter objective", () => {
    const input = context({
      actor: unit("goblin", "monster", 0, 0),
      enemies: [],
      abilities: [],
      turnResources: createTurnResources({ action: 0, movement: 2 }),
      objectives: [
        {
          id: "lever",
          label: "Reach the lever",
          kind: "reach",
          position: { x: 5, y: 0 },
          priority: 5,
        },
      ],
    });
    const result = chooseCombatAiAction(input);
    expect(result.kind).toBe("move");
    if (result.kind !== "move") throw new Error("expected movement");
    expect(result.intent).toBe("objective");
    expect(result.reasons).toContain("objective-progress");
    expect(gridDistance(result.destination, { x: 5, y: 0 })).toBeLessThan(5);
  });

  it("uses an environmental explosion only with positive enemy value", () => {
    const grid = normalizeTacticalGrid({
      columns: 7,
      rows: 7,
      objects: [
        {
          id: "barrel",
          type: "barrel",
          x: 2,
          y: 1,
          content: "volatile",
        },
      ],
    });
    const result = chooseCombatAiAction(
      context({
        actor: unit("goblin", "monster", 1, 1),
        enemies: [
          unit("hero-a", "player", 3, 1),
          unit("hero-b", "player", 3, 2),
        ],
        abilities: [],
        grid,
      }),
    );
    expect(result).toMatchObject({
      kind: "interact",
      objectId: "barrel",
      action: "ignite",
    });
    expect(result.reasons).toContain("environmental-explosion");

    const friendlyFire = rankCombatAiActions(
      context({
        actor: unit("goblin", "monster", 1, 1),
        allies: [
          unit("ally-a", "monster", 2, 2),
          unit("ally-b", "monster", 1, 2),
        ],
        enemies: [unit("hero", "player", 3, 1)],
        abilities: [],
        grid,
      }),
    );
    expect(
      friendlyFire.some(
        (candidate) =>
          candidate.kind === "interact" && candidate.action === "ignite",
      ),
    ).toBe(false);
  });
});

describe("combat AI replay stability and handoff", () => {
  it("resolves equal scores reproducibly from the supplied seed", () => {
    const input = context({
      enemies: [
        unit("hero-a", "player", 2, 1),
        unit("hero-b", "player", 1, 2),
      ],
      seed: "stable-replay-seed",
    });
    expect(chooseCombatAiAction(input)).toEqual(chooseCombatAiAction(input));
    expect(rankCombatAiActions(input)).toEqual(rankCombatAiActions(input));
  });

  it("falls back to end turn when the actor cannot act or move", () => {
    const result = chooseCombatAiAction(
      context({
        actor: unit("goblin", "monster", 1, 1, {
          canAct: false,
          canMove: false,
        }),
        abilities: [],
      }),
    );
    expect(result).toEqual({
      id: "end-turn",
      kind: "end-turn",
      intent: "end-turn",
      score: 0,
      reasons: ["no-legal-action"],
    });
  });

  it("maps decisions to the existing ai_intent event shape", () => {
    const decision = chooseCombatAiAction(context());
    expect(combatAiIntentPayload("goblin", decision)).toMatchObject({
      actorTokenId: "goblin",
      action: "ability",
      abilityId: "slash",
      targetTokenIds: ["hero"],
      intent: "attack",
    });
  });

  it("computes stable expected values for D&D dice expressions", () => {
    expect(averageCombatAiAmount("2d6+3")).toBe(10);
    expect(averageCombatAiAmount("d8-1")).toBe(3.5);
    expect(averageCombatAiAmount(7)).toBe(7);
    expect(averageCombatAiAmount("not-dice")).toBe(0);
  });
});
