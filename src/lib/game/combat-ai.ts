/**
 * Presentation-free deterministic combat AI.
 *
 * The AI does not roll dice or mutate combat state. It ranks only commands
 * that the server can validate and execute through the existing combat and
 * tactical rules. Equal scores are resolved through a stable seeded hash so
 * a replay with the same state and seed always produces the same decision.
 */

import {
  canPayAbilityCost,
  validateAbilityTargets,
  type AbilityDefinition,
  type AbilityEffect,
  type AbilityScore,
  type CombatTurnResources,
  type LifeState,
  type TargetCandidate,
} from "./rules/combat";
import {
  elevationAt,
  gridDistance,
  isCellBlocked,
  isInsideGrid,
  isObjectDestroyed,
  lineOfSight,
  movementCostAt,
  pointKey,
  positionModifiersBetween,
  surfaceAt,
  surfaceEffectAt,
  type GridPoint,
  type TacticalGrid,
  type TacticalObjectAction,
} from "./rules/tactical";

export type CombatAiUnit = {
  id: string;
  team: string;
  position: GridPoint;
  hpCurrent: number;
  hpMax: number;
  armorClass: number;
  lifeState?: LifeState;
  /** Relative damage/control potential. One is an ordinary combatant. */
  threat?: number;
  savingThrows?: Partial<Record<AbilityScore, number>>;
  hidden?: boolean;
  concentrating?: boolean;
  canAct?: boolean;
  canMove?: boolean;
};

export type CombatAiObjective = {
  id: string;
  label: string;
  kind: "reach" | "escape" | "protect" | "interact";
  position: GridPoint;
  priority?: number;
  status?: "active" | "completed" | "failed";
  objectId?: string;
};

export type CombatAiStrategy = {
  aggression: number;
  survival: number;
  threatFocus: number;
  finisherFocus: number;
  objectiveFocus: number;
  surfaceAwareness: number;
  retreatHpRatio: number;
};

export const DEFAULT_COMBAT_AI_STRATEGY: CombatAiStrategy = {
  aggression: 1,
  survival: 1,
  threatFocus: 1,
  finisherFocus: 1,
  objectiveFocus: 1,
  surfaceAwareness: 1,
  retreatHpRatio: 0.3,
};

export type CombatAiContext = {
  actor: CombatAiUnit;
  allies: CombatAiUnit[];
  enemies: CombatAiUnit[];
  abilities: AbilityDefinition[];
  turnResources: CombatTurnResources;
  grid: TacticalGrid;
  objectives?: CombatAiObjective[];
  occupied?: GridPoint[];
  strategy?: Partial<CombatAiStrategy>;
  /** Overrides turnResources.movement when supplied. */
  movementBudget?: number;
  /** Rules-authored abilities without executable effects are excluded by default. */
  allowAdjudication?: boolean;
  /** Stable replay seed. Defaults to the actor id. */
  seed?: string | number;
};

type CombatAiCandidateBase = {
  id: string;
  score: number;
  intent:
    | "attack"
    | "control"
    | "heal"
    | "stabilize"
    | "defend"
    | "retreat"
    | "reposition"
    | "objective"
    | "interact"
    | "end-turn";
  reasons: string[];
};

export type CombatAiAbilityCandidate = CombatAiCandidateBase & {
  kind: "ability";
  abilityId: string;
  targetIds: string[];
};

export type CombatAiMoveCandidate = CombatAiCandidateBase & {
  kind: "move";
  destination: GridPoint;
  path: GridPoint[];
  movementCost: number;
};

export type CombatAiInteractCandidate = CombatAiCandidateBase & {
  kind: "interact";
  objectId: string;
  action: TacticalObjectAction;
};

export type CombatAiEndTurnCandidate = CombatAiCandidateBase & {
  kind: "end-turn";
};

export type CombatAiCandidate =
  | CombatAiAbilityCandidate
  | CombatAiMoveCandidate
  | CombatAiInteractCandidate
  | CombatAiEndTurnCandidate;

export type CombatAiIntentPayload = {
  actorTokenId: string;
  intent: CombatAiCandidate["intent"];
  action: CombatAiCandidate["kind"];
  abilityId?: string;
  targetTokenIds?: string[];
  destination?: GridPoint;
  objectId?: string;
  objectAction?: TacticalObjectAction;
  score: number;
  reasons: string[];
};

/** Returns every legal option, best first. Never returns an empty list. */
export function rankCombatAiActions(
  context: CombatAiContext,
): CombatAiCandidate[] {
  const strategy = normalizedStrategy(context.strategy);
  const candidates: CombatAiCandidate[] = [
    ...legalAbilityCandidates(context, strategy),
    ...movementCandidates(context, strategy),
    ...interactionCandidates(context, strategy),
  ];
  if (candidates.length === 0) candidates.push(endTurnCandidate());
  return candidates.sort(candidateComparator(context.seed ?? context.actor.id));
}

export function chooseCombatAiAction(
  context: CombatAiContext,
): CombatAiCandidate {
  return rankCombatAiActions(context)[0];
}

/** Shape intended to be published as the existing `ai_intent` event payload. */
export function combatAiIntentPayload(
  actorTokenId: string,
  candidate: CombatAiCandidate,
): CombatAiIntentPayload {
  const base: CombatAiIntentPayload = {
    actorTokenId,
    intent: candidate.intent,
    action: candidate.kind,
    score: candidate.score,
    reasons: [...candidate.reasons],
  };
  if (candidate.kind === "ability") {
    return {
      ...base,
      abilityId: candidate.abilityId,
      targetTokenIds: [...candidate.targetIds],
    };
  }
  if (candidate.kind === "move") {
    return { ...base, destination: { ...candidate.destination } };
  }
  if (candidate.kind === "interact") {
    return {
      ...base,
      objectId: candidate.objectId,
      objectAction: candidate.action,
    };
  }
  return base;
}

/** Useful to API integrations that want to expose why abilities were rejected. */
export function isAbilityLegalForCombatAi(
  context: CombatAiContext,
  ability: AbilityDefinition,
): boolean {
  return (
    context.actor.lifeState !== "dead" &&
    context.actor.lifeState !== "downed" &&
    context.actor.canAct !== false &&
    ability.activation !== "reaction" &&
    ability.activation !== "passive" &&
    (context.allowAdjudication === true || !ability.requiresAdjudication) &&
    canPayAbilityCost(context.turnResources, ability.cost).ok
  );
}

function legalAbilityCandidates(
  context: CombatAiContext,
  strategy: CombatAiStrategy,
): CombatAiAbilityCandidate[] {
  if (context.actor.canAct === false) return [];
  return context.abilities.flatMap((ability) => {
    if (!isAbilityLegalForCombatAi(context, ability)) return [];
    return targetSetsForAbility(context, ability).flatMap((targets) => {
      const validation = validateAbilityTargets(
        ability,
        context.actor,
        targets.map((target) => targetCandidate(context, target)),
      );
      if (!validation.ok) return [];
      const scored = scoreAbility(context, strategy, ability, targets);
      return [
        {
          id: `ability:${ability.id}:${targets.map((target) => target.id).join(",") || "none"}`,
          kind: "ability" as const,
          abilityId: ability.id,
          targetIds: targets.map((target) => target.id),
          score: roundedScore(scored.score),
          intent: scored.intent,
          reasons: unique(scored.reasons),
        },
      ];
    });
  });
}

function targetSetsForAbility(
  context: CombatAiContext,
  ability: AbilityDefinition,
): CombatAiUnit[][] {
  const rule = ability.target;
  if (rule.kind === "none") return rule.minTargets === 0 ? [[]] : [];
  if (rule.kind === "self") return [[context.actor]];

  const pool = [context.actor, ...context.allies, ...context.enemies]
    .filter((unit, index, all) => all.findIndex((item) => item.id === unit.id) === index)
    .filter((unit) => {
      if (unit.id === context.actor.id && !rule.includeSelf) return false;
      if (rule.kind === "ally" && unit.team !== context.actor.team) return false;
      if (rule.kind === "enemy" && unit.team === context.actor.team) return false;
      if (unit.hidden && unit.team !== context.actor.team) return false;
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const minTargets = Math.max(0, rule.minTargets);
  const maxTargets = Math.min(Math.max(minTargets, rule.maxTargets), 4);
  const result: CombatAiUnit[][] = minTargets === 0 ? [[]] : [];
  for (let size = Math.max(1, minTargets); size <= maxTargets; size += 1) {
    result.push(...combinations(pool.slice(0, 10), size));
  }
  return result;
}

function targetCandidate(
  context: CombatAiContext,
  unit: CombatAiUnit,
): TargetCandidate {
  return {
    id: unit.id,
    team: unit.team,
    distance: gridDistance(context.actor.position, unit.position),
    lineOfSight:
      unit.id === context.actor.id ||
      lineOfSight(context.grid, context.actor.position, unit.position).visible,
    lifeState: unit.lifeState ?? (unit.hpCurrent > 0 ? "active" : "downed"),
  };
}

function scoreAbility(
  context: CombatAiContext,
  strategy: CombatAiStrategy,
  ability: AbilityDefinition,
  targets: CombatAiUnit[],
): {
  score: number;
  intent: CombatAiAbilityCandidate["intent"];
  reasons: string[];
} {
  let score = 6;
  let intent: CombatAiAbilityCandidate["intent"] = "control";
  const reasons: string[] = [];
  const actorHpRatio = hpRatio(context.actor);

  for (const effect of ability.effects) {
    for (const target of targets.length > 0 ? targets : [context.actor]) {
      const result = scoreEffect(context, strategy, ability, effect, target);
      score += result.score;
      if (result.intent) intent = result.intent;
      reasons.push(...result.reasons);
    }
  }

  if (ability.effects.length === 0) score -= 5;
  if (ability.concentration && context.actor.concentrating) {
    score -= 4;
    reasons.push("replaces-concentration");
  }
  score -= resourceScarcityPenalty(ability);

  if (ability.id === "core:dodge") {
    score += 8 + context.enemies.length * 2;
    intent = "defend";
    reasons.push("defensive-stance");
  }
  if (ability.id === "core:disengage") {
    const adjacentEnemies = context.enemies.filter(
      (enemy) => gridDistance(context.actor.position, enemy.position) <= 1,
    ).length;
    score += adjacentEnemies * (actorHpRatio <= strategy.retreatHpRatio ? 15 : 5);
    intent = actorHpRatio <= strategy.retreatHpRatio ? "retreat" : "defend";
    if (adjacentEnemies > 0) reasons.push("breaks-melee-contact");
  }
  if (ability.id === "core:dash") {
    const urgency = objectiveUrgency(context, strategy);
    score += urgency + (actorHpRatio <= strategy.retreatHpRatio ? 14 : 0);
    intent = actorHpRatio <= strategy.retreatHpRatio ? "retreat" : "objective";
    reasons.push(urgency > 0 ? "objective-mobility" : "extra-mobility");
  }
  if (actorHpRatio <= strategy.retreatHpRatio && intent === "attack") {
    score -= 10 * strategy.survival;
  }

  return { score, intent, reasons };
}

function scoreEffect(
  context: CombatAiContext,
  strategy: CombatAiStrategy,
  ability: AbilityDefinition,
  effect: AbilityEffect,
  target: CombatAiUnit,
): {
  score: number;
  intent?: CombatAiAbilityCandidate["intent"];
  reasons: string[];
} {
  const enemy = target.team !== context.actor.team;
  const reasons: string[] = [];
  if (effect.kind === "attack") {
    if (!enemy) return { score: -100, reasons: ["avoids-friendly-fire"] };
    const position = positionModifiersBetween(
      context.grid,
      context.actor.position,
      target.position,
    );
    if (position.totalAttackRollModifier === null) {
      return { score: -100, reasons: ["target-has-full-cover"] };
    }
    const damage = averageAmount(effect.damage);
    const chance = hitChance(
      effect.attackBonus + position.totalAttackRollModifier,
      target.armorClass,
    );
    let score = damage * chance * 4 * strategy.aggression;
    score += enemyPriority(target, damage, strategy);
    score += surfaceComboScore(context, target, effect.damageType, strategy);
    if (position.height.label === "high-ground") {
      reasons.push("high-ground");
    }
    if (position.cover.level !== "none") reasons.push("target-in-cover");
    if (target.hpCurrent <= damage) reasons.push("finishing-blow");
    if ((target.threat ?? 1) > 1) reasons.push("dangerous-target");
    return { score, intent: "attack", reasons };
  }
  if (effect.kind === "save") {
    if (!enemy) return { score: -100, reasons: ["avoids-friendly-fire"] };
    const damage = averageAmount(effect.damage ?? 0);
    const saveChance = savingThrowChance(
      target.savingThrows?.[effect.ability] ?? 0,
      effect.dc,
    );
    const expected = effect.halfDamageOnSuccess
      ? damage * (1 - saveChance / 2)
      : damage * (1 - saveChance);
    const score =
      expected * 4 * strategy.aggression +
      enemyPriority(target, damage, strategy) +
      surfaceComboScore(context, target, effect.damageType, strategy);
    if (target.hpCurrent <= damage) reasons.push("finishing-blow");
    if ((target.savingThrows?.[effect.ability] ?? 0) <= 0) {
      reasons.push("weak-saving-throw");
    }
    return { score, intent: damage > 0 ? "attack" : "control", reasons };
  }
  if (effect.kind === "damage") {
    if (!enemy) return { score: -100, reasons: ["avoids-friendly-fire"] };
    const damage = averageAmount(effect.amount);
    const score =
      damage * 4 * strategy.aggression +
      enemyPriority(target, damage, strategy) +
      surfaceComboScore(context, target, effect.damageType, strategy);
    if (target.hpCurrent <= damage) reasons.push("finishing-blow");
    return { score, intent: "attack", reasons };
  }
  if (effect.kind === "heal") {
    if (enemy) return { score: -100, reasons: ["avoids-healing-enemy"] };
    const healing = Math.min(
      averageAmount(effect.amount),
      Math.max(0, target.hpMax - target.hpCurrent),
    );
    const downed = target.lifeState === "downed" || target.lifeState === "stable";
    if (healing <= 0 && !downed) return { score: -8, intent: "heal", reasons: ["overhealing"] };
    if (downed) reasons.push("raises-downed-ally");
    if (target.id === context.actor.id) reasons.push("self-preservation");
    return {
      score: healing * 5 * strategy.survival + (downed ? 45 : 0),
      intent: "heal",
      reasons,
    };
  }
  if (effect.kind === "stabilize") {
    const downed = target.lifeState === "downed" || target.hpCurrent <= 0;
    return {
      score: downed && !enemy ? 75 * strategy.survival : -20,
      intent: "stabilize",
      reasons: downed && !enemy ? ["prevents-ally-death"] : ["invalid-stabilize-value"],
    };
  }
  if (effect.kind === "revive") {
    const dead = target.lifeState === "dead";
    return {
      score: dead && !enemy ? 90 * strategy.survival : -25,
      intent: "stabilize",
      reasons: dead && !enemy ? ["revives-ally"] : ["invalid-revive-value"],
    };
  }
  if (effect.kind === "status") {
    const beneficial = !enemy;
    const magnitude = statusMagnitude(effect.modifiers);
    return {
      score: beneficial
        ? (8 + magnitude) * strategy.survival
        : (10 + magnitude + enemyPriority(target, 0, strategy) / 2) *
          strategy.aggression,
      intent: beneficial ? "defend" : "control",
      reasons: [beneficial ? "buffs-ally" : "controls-threat"],
    };
  }
  if (effect.kind === "resource") {
    const movementResource = effect.resource === "movement";
    return {
      score: Math.max(0, effect.amount) * (movementResource ? 1.5 : 2),
      intent: movementResource ? "reposition" : "defend",
      reasons: [movementResource ? "extends-movement" : "restores-resource"],
    };
  }
  return { score: 0, reasons };
}

function movementCandidates(
  context: CombatAiContext,
  strategy: CombatAiStrategy,
): CombatAiMoveCandidate[] {
  if (
    context.actor.canMove === false ||
    context.actor.lifeState === "dead" ||
    context.actor.lifeState === "downed"
  ) {
    return [];
  }
  const budget = Math.max(
    0,
    Math.floor(context.movementBudget ?? context.turnResources.movement),
  );
  if (budget <= 0) return [];

  const occupied = new Set(
    [
      ...context.allies,
      ...context.enemies,
      ...(context.occupied ?? []).map((position, index) => ({
        id: `extra-${index}`,
        position,
      })),
    ].map((entry) => pointKey(entry.position)),
  );
  occupied.delete(pointKey(context.actor.position));
  const reachable = reachableCells(
    context.grid,
    context.actor.position,
    budget,
    occupied,
  );
  const actorRatio = hpRatio(context.actor);
  return reachable
    .filter((cell) => cell.cost > 0)
    .map((cell) => {
      const scored = scoreDestination(
        context,
        strategy,
        cell.point,
        actorRatio <= strategy.retreatHpRatio,
      );
      return {
        id: `move:${cell.point.x}:${cell.point.y}`,
        kind: "move" as const,
        destination: cell.point,
        path: cell.path,
        movementCost: cell.cost,
        score: roundedScore(scored.score - cell.cost * 0.15),
        intent: scored.intent,
        reasons: unique(scored.reasons),
      };
    });
}

function scoreDestination(
  context: CombatAiContext,
  strategy: CombatAiStrategy,
  destination: GridPoint,
  retreating: boolean,
): {
  score: number;
  intent: CombatAiMoveCandidate["intent"];
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 5;
  let intent: CombatAiMoveCandidate["intent"] = "reposition";
  const currentNearest = nearestDistance(context.actor.position, context.enemies);
  const destinationNearest = nearestDistance(destination, context.enemies);

  if (retreating) {
    intent = "retreat";
    score += 48 * strategy.survival;
    if (Number.isFinite(currentNearest) && Number.isFinite(destinationNearest)) {
      const distanceGain = destinationNearest - currentNearest;
      score += distanceGain * 8 * strategy.survival;
      if (distanceGain > 0) reasons.push("opens-distance");
      if (distanceGain < 0) score += distanceGain * 12;
    }
    reasons.push("low-hp-retreat");
  } else {
    score += offensivePositionScore(context, destination, reasons) * strategy.aggression;
  }

  const coverScore = defensiveCoverScore(context, destination);
  score += coverScore * strategy.survival;
  if (coverScore > 0) reasons.push("gains-cover");

  const objective = closestActiveObjective(context, destination);
  if (objective) {
    const before = gridDistance(context.actor.position, objective.position);
    const after = gridDistance(destination, objective.position);
    const progress = before - after;
    if (progress > 0) {
      score +=
        progress *
        (6 + objectivePriority(objective) * 2) *
        strategy.objectiveFocus;
      reasons.push("objective-progress");
      if (!retreating && progress * objectivePriority(objective) >= 4) {
        intent = "objective";
      }
    }
    if (after === 0) {
      score += 18 * strategy.objectiveFocus;
      reasons.push("reaches-objective");
      if (!retreating) intent = "objective";
    }
  }

  const surfacePenalty = destinationSurfacePenalty(context.grid, destination);
  score -= surfacePenalty * strategy.surfaceAwareness;
  if (surfacePenalty >= 6) reasons.push("hazardous-destination");
  if (surfacePenalty === 0 && surfaceAt(context.grid, destination)) {
    reasons.push("safe-surface");
  }
  return { score, intent, reasons };
}

function offensivePositionScore(
  context: CombatAiContext,
  destination: GridPoint,
  reasons: string[],
): number {
  if (context.enemies.length === 0) return 0;
  const damagingAbilities = context.abilities.filter(
    (ability) =>
      isAbilityLegalForCombatAi(context, ability) &&
      ability.effects.some((effect) =>
        effect.kind === "attack" || effect.kind === "damage" || effect.kind === "save",
      ),
  );
  const maximumRange = Math.max(1, ...damagingAbilities.map((ability) => ability.target.range));
  const preferredRange = maximumRange <= 1 ? 1 : Math.min(8, Math.max(3, Math.round(maximumRange * 0.6)));
  const dangerous = [...context.enemies].sort(
    (left, right) => (right.threat ?? 1) - (left.threat ?? 1) || left.id.localeCompare(right.id),
  )[0];
  if (!dangerous) return 0;
  const before = gridDistance(context.actor.position, dangerous.position);
  const after = gridDistance(destination, dangerous.position);
  const rangeImprovement = Math.abs(before - preferredRange) - Math.abs(after - preferredRange);
  let score = rangeImprovement * 4;
  if (rangeImprovement > 0) reasons.push("improves-attack-range");

  const height = elevationAt(context.grid, destination) - elevationAt(context.grid, dangerous.position);
  if (height >= 2) {
    score += 8;
    reasons.push("claims-high-ground");
  } else if (height <= -2) {
    score -= 5;
  }
  if (lineOfSight(context.grid, destination, dangerous.position).visible) score += 2;
  return score;
}

function interactionCandidates(
  context: CombatAiContext,
  strategy: CombatAiStrategy,
): CombatAiInteractCandidate[] {
  if (context.actor.canAct === false || context.turnResources.action < 1) return [];
  return context.grid.objects.flatMap((object) => {
    if (
      isObjectDestroyed(object) ||
      gridDistance(context.actor.position, object) > 1
    ) {
      return [];
    }
    const objective = activeObjectives(context).find(
      (candidate) => candidate.objectId === object.id,
    );
    const candidates: CombatAiInteractCandidate[] = [];
    const add = (
      action: TacticalObjectAction,
      baseScore: number,
      reasons: string[],
    ) => {
      candidates.push({
        id: `interact:${object.id}:${action}`,
        kind: "interact",
        objectId: object.id,
        action,
        score: roundedScore(
          baseScore +
            (objective
              ? (25 + objectivePriority(objective) * 8) * strategy.objectiveFocus
              : 0),
        ),
        intent: objective ? "objective" : "interact",
        reasons: unique([
          ...reasons,
          ...(objective ? ["objective-interaction"] : []),
        ]),
      });
    };

    if (object.kind === "door" && object.state === "closed") {
      add("open", 12, ["opens-route"]);
    }
    if (object.kind === "trap" && object.state === "armed" && object.detected) {
      add("disarm", 28 * strategy.survival, ["removes-trap"]);
    }
    if (
      object.kind === "barrel" &&
      object.state === "intact" &&
      (object.content === "oil" || object.content === "volatile")
    ) {
      const enemiesInBlast = context.enemies.filter(
        (enemy) => gridDistance(enemy.position, object) <= 2,
      ).length;
      const alliesInBlast = [context.actor, ...context.allies].filter(
        (ally) => gridDistance(ally.position, object) <= 2,
      ).length;
      const score =
        8 +
        enemiesInBlast * 18 * strategy.aggression -
        alliesInBlast * 24 * strategy.survival;
      if (enemiesInBlast > 0 && score > 0) {
        add("ignite", score, ["environmental-explosion"]);
      }
    }
    return candidates;
  });
}

function enemyPriority(
  target: CombatAiUnit,
  expectedDamage: number,
  strategy: CombatAiStrategy,
): number {
  const weakness = 1 - hpRatio(target);
  const finishing =
    expectedDamage > 0 && target.hpCurrent <= expectedDamage
      ? 12 * strategy.finisherFocus
      : 0;
  return (
    weakness * 8 * strategy.finisherFocus +
    Math.max(0, target.threat ?? 1) * 4 * strategy.threatFocus +
    finishing
  );
}

function surfaceComboScore(
  context: CombatAiContext,
  target: CombatAiUnit,
  damageType: string | undefined,
  strategy: CombatAiStrategy,
): number {
  const surface = surfaceAt(context.grid, target.position);
  const type = damageType?.trim().toLowerCase();
  if (!surface || !type) return 0;
  if (type === "lightning" && surface.type === "water") {
    return 10 * strategy.surfaceAwareness;
  }
  if ((type === "cold" || type === "ice") && surface.type === "water") {
    return 7 * strategy.surfaceAwareness;
  }
  if (type === "fire" && surface.type === "ice") {
    return 4 * strategy.surfaceAwareness;
  }
  if (type === "fire" && surface.type === "water") {
    return -3 * strategy.surfaceAwareness;
  }
  return 0;
}

function defensiveCoverScore(
  context: CombatAiContext,
  destination: GridPoint,
): number {
  if (context.enemies.length === 0) return 0;
  const total = context.enemies.reduce((sum, enemy) => {
    const cover = positionModifiersBetween(
      context.grid,
      enemy.position,
      destination,
    ).cover.level;
    return (
      sum +
      (cover === "full"
        ? 7
        : cover === "three-quarters"
          ? 5
          : cover === "half"
            ? 2
            : 0)
    );
  }, 0);
  return total / context.enemies.length;
}

function destinationSurfacePenalty(
  grid: TacticalGrid,
  destination: GridPoint,
): number {
  const surface = surfaceAt(grid, destination);
  if (!surface) return 0;
  const effect = surfaceEffectAt(grid, destination, "end-turn");
  return (
    effect.damage * 3 +
    effect.conditions.length * 4 +
    (effect.save ? 4 : 0) +
    Math.max(0, effect.movementCost - 1)
  );
}

type ReachableCell = {
  point: GridPoint;
  cost: number;
  path: GridPoint[];
};

function reachableCells(
  grid: TacticalGrid,
  start: GridPoint,
  budget: number,
  occupied: Set<string>,
): ReachableCell[] {
  const costs = new Map<string, number>([[pointKey(start), 0]]);
  const paths = new Map<string, GridPoint[]>([[pointKey(start), [{ ...start }]]]);
  const queue: Array<{ point: GridPoint; cost: number }> = [
    { point: { ...start }, cost: 0 },
  ];

  while (queue.length > 0) {
    queue.sort(
      (left, right) =>
        left.cost - right.cost || pointKey(left.point).localeCompare(pointKey(right.point)),
    );
    const current = queue.shift()!;
    if (current.cost !== costs.get(pointKey(current.point))) continue;
    for (const next of neighbors(current.point)) {
      const key = pointKey(next);
      if (
        !isInsideGrid(next, grid) ||
        isCellBlocked(grid, next) ||
        occupied.has(key)
      ) {
        continue;
      }
      const nextCost = current.cost + movementCostAt(grid, next);
      if (nextCost > budget || nextCost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, nextCost);
      paths.set(key, [...(paths.get(pointKey(current.point)) ?? []), next]);
      queue.push({ point: next, cost: nextCost });
    }
  }

  return [...costs.entries()]
    .map(([key, cost]) => ({
      point: pointFromKey(key),
      cost,
      path: paths.get(key) ?? [],
    }))
    .sort((left, right) => pointKey(left.point).localeCompare(pointKey(right.point)));
}

function neighbors(point: GridPoint): GridPoint[] {
  const result: GridPoint[] = [];
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      if (x === 0 && y === 0) continue;
      result.push({ x: point.x + x, y: point.y + y });
    }
  }
  return result.sort((left, right) => pointKey(left).localeCompare(pointKey(right)));
}

function pointFromKey(key: string): GridPoint {
  const [x, y] = key.split(":").map(Number);
  return { x, y };
}

function activeObjectives(context: CombatAiContext): CombatAiObjective[] {
  return (context.objectives ?? []).filter(
    (objective) => (objective.status ?? "active") === "active",
  );
}

function closestActiveObjective(
  context: CombatAiContext,
  position: GridPoint,
): CombatAiObjective | null {
  return (
    [...activeObjectives(context)].sort(
      (left, right) =>
        gridDistance(position, left.position) -
          gridDistance(position, right.position) ||
        objectivePriority(right) - objectivePriority(left) ||
        left.id.localeCompare(right.id),
    )[0] ?? null
  );
}

function objectiveUrgency(
  context: CombatAiContext,
  strategy: CombatAiStrategy,
): number {
  const objective = closestActiveObjective(context, context.actor.position);
  return objective
    ? objectivePriority(objective) * 3 * strategy.objectiveFocus
    : 0;
}

function objectivePriority(value: { priority?: number }): number {
  return Math.max(0, Math.min(10, value.priority ?? 1));
}

function nearestDistance(position: GridPoint, units: CombatAiUnit[]): number {
  return units.reduce(
    (nearest, unit) => Math.min(nearest, gridDistance(position, unit.position)),
    Infinity,
  );
}

function hitChance(attackBonus: number, armorClass: number): number {
  const required = armorClass - attackBonus;
  return clamp((21 - required) / 20, 0.05, 0.95);
}

function savingThrowChance(modifier: number, dc: number): number {
  const required = dc - modifier;
  return clamp((21 - required) / 20, 0.05, 0.95);
}

/** Deterministic average for simple D&D dice expressions (for example 2d6+3). */
export function averageCombatAiAmount(value: number | string): number {
  return averageAmount(value);
}

function averageAmount(value: number | string): number {
  if (typeof value === "number") return Math.max(0, value);
  const compact = value.replace(/\s+/g, "").toLowerCase();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(compact)) {
    return Math.max(0, Number(compact));
  }
  const match = compact.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) return 0;
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = Number(match[3] ?? 0);
  if (count <= 0 || sides <= 0) return 0;
  return Math.max(0, count * ((sides + 1) / 2) + modifier);
}

function statusMagnitude(
  modifiers: Extract<AbilityEffect, { kind: "status" }>["modifiers"],
): number {
  if (!modifiers) return 0;
  let score = 0;
  score += Math.abs(modifiers.attackRoll ?? 0);
  score += Math.abs(modifiers.armorClass ?? 0);
  if (modifiers.canAct === false) score += 14;
  if (modifiers.canMove === false) score += 8;
  if (modifiers.attackAdvantage && modifiers.attackAdvantage !== "normal") score += 4;
  if (
    modifiers.incomingAttackAdvantage &&
    modifiers.incomingAttackAdvantage !== "normal"
  ) {
    score += 4;
  }
  return score;
}

function resourceScarcityPenalty(ability: AbilityDefinition): number {
  return Object.entries(ability.cost.resources ?? {}).reduce(
    (penalty, [resource, amount]) =>
      penalty +
      Math.max(0, amount) *
        (resource.toLowerCase().includes("spellslot") ? 2.5 : 1),
    0,
  );
}

function hpRatio(unit: CombatAiUnit): number {
  return clamp(unit.hpCurrent / Math.max(1, unit.hpMax), 0, 1);
}

function normalizedStrategy(
  input: Partial<CombatAiStrategy> | undefined,
): CombatAiStrategy {
  return {
    aggression: nonNegative(input?.aggression, DEFAULT_COMBAT_AI_STRATEGY.aggression),
    survival: nonNegative(input?.survival, DEFAULT_COMBAT_AI_STRATEGY.survival),
    threatFocus: nonNegative(input?.threatFocus, DEFAULT_COMBAT_AI_STRATEGY.threatFocus),
    finisherFocus: nonNegative(input?.finisherFocus, DEFAULT_COMBAT_AI_STRATEGY.finisherFocus),
    objectiveFocus: nonNegative(input?.objectiveFocus, DEFAULT_COMBAT_AI_STRATEGY.objectiveFocus),
    surfaceAwareness: nonNegative(input?.surfaceAwareness, DEFAULT_COMBAT_AI_STRATEGY.surfaceAwareness),
    retreatHpRatio: clamp(
      finite(input?.retreatHpRatio, DEFAULT_COMBAT_AI_STRATEGY.retreatHpRatio),
      0,
      1,
    ),
  };
}

function nonNegative(value: number | undefined, fallback: number): number {
  return Math.max(0, finite(value, fallback));
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function endTurnCandidate(): CombatAiEndTurnCandidate {
  return {
    id: "end-turn",
    kind: "end-turn",
    intent: "end-turn",
    score: 0,
    reasons: ["no-legal-action"],
  };
}

function candidateComparator(seed: string | number) {
  return (left: CombatAiCandidate, right: CombatAiCandidate): number =>
    right.score - left.score ||
    seededRank(right.id, seed) - seededRank(left.id, seed) ||
    left.id.localeCompare(right.id);
}

function seededRank(value: string, seed: string | number): number {
  let hash = 2166136261;
  const input = `${String(seed)}:${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const result: T[][] = [];
  const visit = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]);
      visit(index + 1, current);
      current.pop();
    }
  };
  visit(0, []);
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function roundedScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
