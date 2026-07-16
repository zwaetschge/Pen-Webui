/**
 * Presentation-free, deterministic combat rules.
 *
 * The module deliberately accepts `unknown` character-sheet JSON. It can read
 * today's lightweight `spells` and `features` entries and also supports an
 * optional `combat` object on either entry for richer, data-driven mechanics.
 * Random rolls and clocks are always supplied by the caller.
 */

export type AbilityScore = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type AbilityActivation =
  | "action"
  | "bonusAction"
  | "reaction"
  | "free"
  | "passive";
export type AbilitySource = "core" | "spell" | "feature";
export type LifeState = "active" | "downed" | "stable" | "dead";
export type AdvantageState = "normal" | "advantage" | "disadvantage";

export type ReactionTriggerKind =
  | "leaves_reach"
  | "enters_reach"
  | "targeted_by_attack"
  | "ally_targeted"
  | "spell_cast"
  | "takes_damage"
  | "fails_save"
  | "custom";

export type AbilityCost = {
  action?: number;
  bonusAction?: number;
  reaction?: number;
  movement?: number;
  resources?: Record<string, number>;
};

export type AbilityTargetKind = "none" | "self" | "ally" | "enemy" | "creature";

export type AbilityTargetRule = {
  kind: AbilityTargetKind;
  minTargets: number;
  maxTargets: number;
  range: number;
  requiresLineOfSight: boolean;
  includeSelf: boolean;
  allowDowned: boolean;
  allowDead: boolean;
};

export type EffectAmount = number | string;

export type AttackEffect = {
  kind: "attack";
  ability: AbilityScore;
  attackBonus: number;
  damage: EffectAmount;
  damageType: string;
};

export type SaveEffect = {
  kind: "save";
  ability: AbilityScore;
  dc: number;
  damage?: EffectAmount;
  damageType?: string;
  halfDamageOnSuccess?: boolean;
};

export type DamageEffect = {
  kind: "damage";
  amount: EffectAmount;
  damageType: string;
};

export type HealEffect = {
  kind: "heal";
  amount: EffectAmount;
};

export type StatusModifierInput = {
  attackRoll?: number;
  armorClass?: number;
  speedMultiplier?: number;
  movementCostMultiplier?: number;
  canAct?: boolean;
  canMove?: boolean;
  attackAdvantage?: AdvantageState;
  incomingAttackAdvantage?: AdvantageState;
  savingThrows?: Partial<Record<AbilityScore, number>>;
  saveAdvantage?: Partial<Record<AbilityScore, AdvantageState>>;
  autoFailSaves?: AbilityScore[];
  breaksConcentration?: boolean;
};

export type StatusEffect = {
  kind: "status";
  status: string;
  durationRounds?: number;
  modifiers?: StatusModifierInput;
};

export type ResourceEffect = {
  kind: "resource";
  resource: string;
  amount: number;
};

export type StabilizeEffect = { kind: "stabilize" };
export type ReviveEffect = { kind: "revive"; hitPoints: number };

export type AbilityEffect =
  | AttackEffect
  | SaveEffect
  | DamageEffect
  | HealEffect
  | StatusEffect
  | ResourceEffect
  | StabilizeEffect
  | ReviveEffect;

export type AbilityDefinition = {
  id: string;
  name: string;
  source: AbilitySource;
  sourceLabel?: string;
  level?: number;
  activation: AbilityActivation;
  cost: AbilityCost;
  target: AbilityTargetRule;
  effects: AbilityEffect[];
  concentration: boolean;
  reactionTriggers: ReactionTriggerKind[];
  requiresAdjudication: boolean;
};

export type CombatTurnResources = {
  action: number;
  bonusAction: number;
  reaction: number;
  movement: number;
  resources: Record<string, number>;
};

export type DeathSaveState = { successes: number; failures: number };

export type ConcentrationState = {
  abilityId: string;
  sourceId?: string;
  startedRound?: number;
  startedTurn?: number;
};

export type StatusInstance = {
  id: string;
  sourceAbilityId?: string;
  durationRounds?: number;
  stacks?: number;
  modifiers?: StatusModifierInput;
};

export type CombatantState = {
  id: string;
  team: string;
  hpCurrent: number;
  hpMax: number;
  temporaryHp: number;
  lifeState: LifeState;
  deathSaves: DeathSaveState;
  statuses: StatusInstance[];
  concentration: ConcentrationState | null;
};

export type ConcentrationEndReason =
  | "cancelled"
  | "failed_save"
  | "incapacitated"
  | "ability_ended";

export type ConcentrationTransition = {
  previous: ConcentrationState | null;
  current: ConcentrationState | null;
  reason: "started" | "replaced" | ConcentrationEndReason;
};

export type TargetCandidate = {
  id: string;
  team: string;
  distance: number;
  lineOfSight: boolean;
  lifeState: LifeState;
};

export type TargetValidationIssueCode =
  | "target_count"
  | "duplicate_target"
  | "invalid_relation"
  | "out_of_range"
  | "line_of_sight"
  | "downed_not_allowed"
  | "dead_not_allowed";

export type TargetValidationIssue = {
  code: TargetValidationIssueCode;
  targetId?: string;
};

export type StatusModifiers = {
  attackRoll: number;
  armorClass: number;
  speedMultiplier: number;
  movementCostMultiplier: number;
  canAct: boolean;
  canMove: boolean;
  attackAdvantage: AdvantageState;
  incomingAttackAdvantage: AdvantageState;
  savingThrows: Partial<Record<AbilityScore, number>>;
  saveAdvantage: Partial<Record<AbilityScore, AdvantageState>>;
  autoFailSaves: AbilityScore[];
  breaksConcentration: boolean;
};

export type ReactionTrigger = {
  id: string;
  kind: ReactionTriggerKind;
  actorId: string;
  targetIds: string[];
  round: number;
  turnIndex: number;
};

export type ReactionResponse = {
  combatantId: string;
  abilityId: string | null;
  respondedAt: number;
};

export type ReactionWindow = {
  id: string;
  trigger: ReactionTrigger;
  openedAt: number;
  expiresAt: number;
  status: "open" | "resolved" | "expired";
  eligible: Record<string, string[]>;
  responses: Record<string, ReactionResponse>;
  accepted: ReactionResponse | null;
};

const ABILITY_SCORES: AbilityScore[] = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
];

const REACTION_TRIGGERS: ReactionTriggerKind[] = [
  "leaves_reach",
  "enters_reach",
  "targeted_by_attack",
  "ally_targeted",
  "spell_cast",
  "takes_damage",
  "fails_save",
  "custom",
];

const EMPTY_DEATH_SAVES: DeathSaveState = { successes: 0, failures: 0 };

export function abilitiesForSheet(sheet: unknown): AbilityDefinition[] {
  return abilitiesFromCharacterSheet(sheet);
}

export function abilitiesFromCharacterSheet(
  sheet: unknown,
): AbilityDefinition[] {
  const root = recordValue(sheet);
  const abilities = recordValue(root.abilities);
  const strength = integerValue(abilities.str, 10);
  const dexterity = integerValue(abilities.dex, 10);
  const proficiencyBonus = nonNegativeIntegerValue(root.proficiencyBonus, 2);
  const speedFeet = nonNegativeIntegerValue(root.speed, 30);
  const movement = Math.max(1, Math.floor(speedFeet / 5));
  const attackAbility: AbilityScore = dexterity > strength ? "dex" : "str";
  const attackModifier = abilityModifier(
    attackAbility === "dex" ? dexterity : strength,
  );
  const attackBonus = attackModifier + proficiencyBonus;
  const defaultAttack: AttackEffect = {
    kind: "attack",
    ability: attackAbility,
    attackBonus,
    damage: `1d8${signedModifier(attackModifier)}`,
    damageType: "slashing",
  };

  const result: AbilityDefinition[] = [
    {
      id: "core:attack",
      name: "Angriff",
      source: "core",
      activation: "action",
      cost: { action: 1 },
      target: targetRule("enemy", { range: 1 }),
      effects: [defaultAttack],
      concentration: false,
      reactionTriggers: [],
      requiresAdjudication: false,
    },
    {
      id: "core:dash",
      name: "Sprint",
      source: "core",
      activation: "action",
      cost: { action: 1 },
      target: targetRule("self"),
      effects: [{ kind: "resource", resource: "movement", amount: movement }],
      concentration: false,
      reactionTriggers: [],
      requiresAdjudication: false,
    },
    {
      id: "core:disengage",
      name: "Lösen",
      source: "core",
      activation: "action",
      cost: { action: 1 },
      target: targetRule("self"),
      effects: [{ kind: "status", status: "disengaged", durationRounds: 1 }],
      concentration: false,
      reactionTriggers: [],
      requiresAdjudication: false,
    },
    {
      id: "core:dodge",
      name: "Ausweichen",
      source: "core",
      activation: "action",
      cost: { action: 1 },
      target: targetRule("self"),
      effects: [{ kind: "status", status: "dodge", durationRounds: 1 }],
      concentration: false,
      reactionTriggers: [],
      requiresAdjudication: false,
    },
    {
      id: "core:hide",
      name: "Verbergen",
      source: "core",
      activation: "action",
      cost: { action: 1 },
      target: targetRule("self"),
      effects: [{ kind: "status", status: "hidden", durationRounds: 1 }],
      concentration: false,
      reactionTriggers: [],
      requiresAdjudication: false,
    },
    {
      id: "core:shove",
      name: "Stoßen",
      source: "core",
      activation: "action",
      cost: { action: 1 },
      target: targetRule("enemy", { range: 1 }),
      effects: [{ kind: "status", status: "prone", durationRounds: 1 }],
      concentration: false,
      reactionTriggers: [],
      requiresAdjudication: false,
    },
    {
      id: "core:stabilize",
      name: "Stabilisieren",
      source: "core",
      activation: "action",
      cost: { action: 1 },
      target: targetRule("ally", {
        range: 1,
        includeSelf: true,
        allowDowned: true,
      }),
      effects: [{ kind: "stabilize" }],
      concentration: false,
      reactionTriggers: [],
      requiresAdjudication: false,
    },
    {
      id: "core:guard",
      name: "Schützen",
      source: "core",
      activation: "reaction",
      cost: { reaction: 1 },
      target: targetRule("self"),
      effects: [
        {
          kind: "status",
          status: "guarded",
          durationRounds: 1,
          modifiers: { armorClass: 2 },
        },
      ],
      concentration: false,
      reactionTriggers: ["targeted_by_attack"],
      requiresAdjudication: false,
    },
    {
      id: "core:opportunity-attack",
      name: "Gelegenheitsangriff",
      source: "core",
      activation: "reaction",
      cost: { reaction: 1 },
      target: targetRule("enemy", { range: 1 }),
      effects: [defaultAttack],
      concentration: false,
      reactionTriggers: ["leaves_reach"],
      requiresAdjudication: false,
    },
  ];

  for (const rawSpell of arrayValue(root.spells)) {
    const spell = recordValue(rawSpell);
    const name = stringValue(spell.name);
    if (!name || spell.prepared === false) continue;
    const level = clamp(nonNegativeIntegerValue(spell.level, 0), 0, 9);
    result.push(
      parseSheetAbility({
        entry: spell,
        source: "spell",
        name,
        level,
        proficiencyBonus,
        abilityScores: abilities,
      }),
    );
  }

  for (const rawFeature of arrayValue(root.features)) {
    const feature = recordValue(rawFeature);
    const name = stringValue(feature.name);
    if (!name) continue;
    result.push(
      parseSheetAbility({
        entry: feature,
        source: "feature",
        name,
        proficiencyBonus,
        abilityScores: abilities,
      }),
    );
  }

  const unique = new Map<string, AbilityDefinition>();
  for (const ability of result) {
    if (!unique.has(ability.id)) unique.set(ability.id, ability);
  }
  return [...unique.values()];
}

function parseSheetAbility(input: {
  entry: Record<string, unknown>;
  source: "spell" | "feature";
  name: string;
  level?: number;
  proficiencyBonus: number;
  abilityScores: Record<string, unknown>;
}): AbilityDefinition {
  const combat = recordValue(input.entry.combat);
  const description = stringValue(input.entry.description) ?? "";
  const fallbackActivation =
    input.source === "spell"
      ? "action"
      : activationFromDescription(description);
  const activation = activationValue(combat.activation, fallbackActivation);
  const effects = parseEffects(
    combat.effects,
    input.proficiencyBonus,
    input.abilityScores,
  );
  const fallbackTargetKind: AbilityTargetKind =
    activation === "passive"
      ? "self"
      : input.source === "spell"
        ? "enemy"
        : "self";
  const target = parseTargetRule(combat.target, fallbackTargetKind);
  const cost = parseAbilityCost(combat, activation, input.level);
  const reactionTriggers = parseReactionTriggers(combat.reactionTriggers);

  return {
    id: `${input.source}:${slug(input.name)}`,
    name: input.name,
    source: input.source,
    sourceLabel:
      input.source === "feature"
        ? (stringValue(input.entry.source) ?? undefined)
        : undefined,
    level: input.level,
    activation,
    cost,
    target,
    effects,
    concentration: combat.concentration === true,
    reactionTriggers:
      activation === "reaction" && reactionTriggers.length === 0
        ? ["custom"]
        : reactionTriggers,
    requiresAdjudication: effects.length === 0,
  };
}

function parseAbilityCost(
  combat: Record<string, unknown>,
  activation: AbilityActivation,
  spellLevel?: number,
): AbilityCost {
  const explicit = recordValue(combat.cost);
  const cost: AbilityCost = activationCost(activation);
  for (const field of [
    "action",
    "bonusAction",
    "reaction",
    "movement",
  ] as const) {
    const value = optionalNonNegativeInteger(explicit[field]);
    if (value !== null) cost[field] = value;
  }

  const resources = {
    ...resourceRecord(explicit.resources),
    ...resourceRecord(combat.resourceCosts),
  };
  if (
    spellLevel !== undefined &&
    spellLevel > 0 &&
    combat.consumeSpellSlot !== false
  ) {
    resources[`spellSlot:${spellLevel}`] = 1;
  }
  if (Object.keys(resources).length > 0) cost.resources = resources;
  return cost;
}

function parseTargetRule(
  value: unknown,
  fallbackKind: AbilityTargetKind,
): AbilityTargetRule {
  const input = recordValue(value);
  const kind = targetKindValue(input.kind, fallbackKind);
  const defaults = targetRule(kind, {
    range: kind === "enemy" || kind === "creature" ? 12 : 0,
  });
  const minTargets = optionalNonNegativeInteger(input.minTargets);
  const maxTargets = optionalNonNegativeInteger(input.maxTargets);
  const max = Math.max(
    minTargets ?? defaults.minTargets,
    maxTargets ?? defaults.maxTargets,
  );
  return {
    ...defaults,
    minTargets: Math.min(minTargets ?? defaults.minTargets, max),
    maxTargets: max,
    range: optionalNonNegativeNumber(input.range) ?? defaults.range,
    requiresLineOfSight:
      typeof input.requiresLineOfSight === "boolean"
        ? input.requiresLineOfSight
        : defaults.requiresLineOfSight,
    includeSelf:
      typeof input.includeSelf === "boolean"
        ? input.includeSelf
        : defaults.includeSelf,
    allowDowned:
      typeof input.allowDowned === "boolean"
        ? input.allowDowned
        : defaults.allowDowned,
    allowDead:
      typeof input.allowDead === "boolean"
        ? input.allowDead
        : defaults.allowDead,
  };
}

function parseEffects(
  value: unknown,
  proficiencyBonus: number,
  abilityScores: Record<string, unknown>,
): AbilityEffect[] {
  const effects: AbilityEffect[] = [];
  const spellcastingAbility = strongestAbility(abilityScores, [
    "int",
    "wis",
    "cha",
  ]);
  const spellcastingModifier = abilityModifier(
    integerValue(abilityScores[spellcastingAbility], 10),
  );

  for (const rawEffect of arrayValue(value)) {
    const effect = recordValue(rawEffect);
    const kind = stringValue(effect.kind);
    if (kind === "attack") {
      const ability = abilityScoreValue(effect.ability, spellcastingAbility);
      const abilityMod = abilityModifier(
        integerValue(abilityScores[ability], 10),
      );
      effects.push({
        kind,
        ability,
        attackBonus: integerValue(
          effect.attackBonus,
          abilityMod + proficiencyBonus,
        ),
        damage: effectAmount(effect.damage, "1d8"),
        damageType: stringValue(effect.damageType) ?? "untyped",
      });
      continue;
    }
    if (kind === "save") {
      const ability = abilityScoreValue(effect.ability, "dex");
      const damage = optionalEffectAmount(effect.damage);
      effects.push({
        kind,
        ability,
        dc: nonNegativeIntegerValue(
          effect.dc,
          8 + proficiencyBonus + spellcastingModifier,
        ),
        ...(damage === undefined ? {} : { damage }),
        ...(stringValue(effect.damageType)
          ? { damageType: stringValue(effect.damageType) as string }
          : {}),
        ...(effect.halfDamageOnSuccess === true
          ? { halfDamageOnSuccess: true }
          : {}),
      });
      continue;
    }
    if (kind === "damage") {
      effects.push({
        kind,
        amount: effectAmount(effect.amount, 0),
        damageType: stringValue(effect.damageType) ?? "untyped",
      });
      continue;
    }
    if (kind === "heal") {
      effects.push({ kind, amount: effectAmount(effect.amount, 0) });
      continue;
    }
    if (kind === "status") {
      const status = stringValue(effect.status);
      if (!status) continue;
      const durationRounds = optionalNonNegativeInteger(effect.durationRounds);
      effects.push({
        kind,
        status: normalizedStatusId(status),
        ...(durationRounds === null ? {} : { durationRounds }),
        ...(effect.modifiers
          ? { modifiers: parseStatusModifierInput(effect.modifiers) }
          : {}),
      });
      continue;
    }
    if (kind === "resource") {
      const resource = stringValue(effect.resource);
      if (!resource) continue;
      effects.push({
        kind,
        resource,
        amount: integerValue(effect.amount, 0),
      });
      continue;
    }
    if (kind === "stabilize") effects.push({ kind });
    if (kind === "revive") {
      effects.push({
        kind,
        hitPoints: Math.max(1, integerValue(effect.hitPoints, 1)),
      });
    }
  }
  return effects;
}

export function createTurnResources(
  input: Partial<Omit<CombatTurnResources, "resources">> & {
    resources?: Record<string, number>;
  } = {},
): CombatTurnResources {
  return {
    action: nonNegativeIntegerValue(input.action, 1),
    bonusAction: nonNegativeIntegerValue(input.bonusAction, 1),
    reaction: nonNegativeIntegerValue(input.reaction, 1),
    movement: nonNegativeIntegerValue(input.movement, 0),
    resources: resourceRecord(input.resources),
  };
}

export function canPayAbilityCost(
  state: CombatTurnResources,
  cost: AbilityCost,
):
  | { ok: true; missing: Record<string, never> }
  | {
      ok: false;
      missing: Record<string, number>;
    } {
  const missing: Record<string, number> = {};
  for (const field of [
    "action",
    "bonusAction",
    "reaction",
    "movement",
  ] as const) {
    const required = nonNegativeIntegerValue(cost[field], 0);
    const available = nonNegativeIntegerValue(state[field], 0);
    if (required > available) missing[field] = required - available;
  }
  for (const [resource, requiredRaw] of Object.entries(cost.resources ?? {})) {
    const required = nonNegativeIntegerValue(requiredRaw, 0);
    const available = nonNegativeIntegerValue(state.resources[resource], 0);
    if (required > available) missing[resource] = required - available;
  }
  if (Object.keys(missing).length > 0) return { ok: false, missing };
  return { ok: true, missing: {} };
}

export function spendAbilityCost(
  state: CombatTurnResources,
  cost: AbilityCost,
):
  | { ok: true; state: CombatTurnResources }
  | {
      ok: false;
      state: CombatTurnResources;
      missing: Record<string, number>;
    } {
  const payment = canPayAbilityCost(state, cost);
  if (!payment.ok) return { ok: false, state, missing: payment.missing };

  const resources = { ...state.resources };
  for (const [resource, amount] of Object.entries(cost.resources ?? {})) {
    resources[resource] =
      nonNegativeIntegerValue(resources[resource], 0) -
      nonNegativeIntegerValue(amount, 0);
  }
  return {
    ok: true,
    state: {
      action: state.action - nonNegativeIntegerValue(cost.action, 0),
      bonusAction:
        state.bonusAction - nonNegativeIntegerValue(cost.bonusAction, 0),
      reaction: state.reaction - nonNegativeIntegerValue(cost.reaction, 0),
      movement: state.movement - nonNegativeIntegerValue(cost.movement, 0),
      resources,
    },
  };
}

export function validateAbilityTargets(
  ability: Pick<AbilityDefinition, "target">,
  actor: { id: string; team: string },
  targets: readonly TargetCandidate[],
): { ok: boolean; issues: TargetValidationIssue[] } {
  const rule = ability.target;
  const issues: TargetValidationIssue[] = [];
  if (targets.length < rule.minTargets || targets.length > rule.maxTargets) {
    issues.push({ code: "target_count" });
  }

  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) {
      issues.push({ code: "duplicate_target", targetId: target.id });
      continue;
    }
    seen.add(target.id);
    if (!isValidTargetRelation(rule, actor, target)) {
      issues.push({ code: "invalid_relation", targetId: target.id });
    }
    if (target.distance > rule.range) {
      issues.push({ code: "out_of_range", targetId: target.id });
    }
    if (rule.requiresLineOfSight && !target.lineOfSight) {
      issues.push({ code: "line_of_sight", targetId: target.id });
    }
    if (
      (target.lifeState === "downed" || target.lifeState === "stable") &&
      !rule.allowDowned
    ) {
      issues.push({ code: "downed_not_allowed", targetId: target.id });
    }
    if (target.lifeState === "dead" && !rule.allowDead) {
      issues.push({ code: "dead_not_allowed", targetId: target.id });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function resolveAttack(input: {
  roll: number;
  attackBonus: number;
  targetArmorClass: number;
  criticalOn?: number;
}): {
  roll: number;
  total: number;
  hit: boolean;
  critical: boolean;
  automaticMiss: boolean;
} {
  const roll = d20(input.roll);
  const total = roll + integerValue(input.attackBonus, 0);
  const automaticMiss = roll === 1;
  const critical =
    !automaticMiss && roll >= clamp(integerValue(input.criticalOn, 20), 2, 20);
  const hit = !automaticMiss && (critical || total >= input.targetArmorClass);
  return { roll, total, hit, critical, automaticMiss };
}

export function resolveSavingThrow(input: {
  roll: number;
  modifier: number;
  dc: number;
}): { roll: number; total: number; dc: number; success: boolean } {
  const roll = d20(input.roll);
  const dc = nonNegativeIntegerValue(input.dc, 0);
  const total = roll + integerValue(input.modifier, 0);
  return { roll, total, dc, success: total >= dc };
}

export function applyDamage(
  current: CombatantState,
  rawDamage: number,
  options: { critical?: boolean } = {},
): {
  state: CombatantState;
  absorbedByTemporaryHp: number;
  hpLost: number;
  overflow: number;
  deathSaveFailures: number;
  concentrationCheckRequired: boolean;
  concentrationDc: number | null;
  concentrationTransition: ConcentrationTransition | null;
} {
  const damage = nonNegativeIntegerValue(rawDamage, 0);
  if (damage === 0 || current.lifeState === "dead") {
    return damageResult(current);
  }

  const temporaryHp = nonNegativeIntegerValue(current.temporaryHp, 0);
  const absorbedByTemporaryHp = Math.min(temporaryHp, damage);
  const remaining = damage - absorbedByTemporaryHp;
  let state = copyCombatant(current);
  state.temporaryHp = temporaryHp - absorbedByTemporaryHp;
  if (remaining === 0) {
    const concentrationCheckRequired = Boolean(
      state.lifeState === "active" && state.concentration,
    );
    return {
      ...damageResult(state),
      absorbedByTemporaryHp,
      concentrationCheckRequired,
      concentrationDc: concentrationCheckRequired
        ? concentrationCheckDc(damage)
        : null,
    };
  }

  if (state.lifeState === "downed" || state.lifeState === "stable") {
    const instantDeath = remaining >= Math.max(1, state.hpMax);
    const addedFailures = options.critical ? 2 : 1;
    const previousSaves =
      state.lifeState === "stable" ? EMPTY_DEATH_SAVES : state.deathSaves;
    const failures = clamp(previousSaves.failures + addedFailures, 0, 3);
    state.deathSaves = { ...previousSaves, failures };
    state.lifeState = instantDeath || failures >= 3 ? "dead" : "downed";
    state.hpCurrent = 0;
    state = withUnconsciousStatus(state, state.lifeState !== "dead");
    return {
      ...damageResult(state),
      absorbedByTemporaryHp,
      overflow: remaining,
      deathSaveFailures: addedFailures,
    };
  }

  const hpBefore = clamp(state.hpCurrent, 0, Math.max(1, state.hpMax));
  const hpLost = Math.min(hpBefore, remaining);
  const overflow = Math.max(0, remaining - hpBefore);
  state.hpCurrent = Math.max(0, hpBefore - remaining);
  let concentrationTransition: ConcentrationTransition | null = null;

  if (state.hpCurrent === 0) {
    state.lifeState = overflow >= Math.max(1, state.hpMax) ? "dead" : "downed";
    state.deathSaves = { ...EMPTY_DEATH_SAVES };
    state = withUnconsciousStatus(state, state.lifeState !== "dead");
    if (state.concentration) {
      const ended = endConcentration(state, "incapacitated");
      state = ended.state;
      concentrationTransition = ended.transition;
    }
  }

  const concentrationCheckRequired = Boolean(
    state.lifeState === "active" && state.concentration,
  );
  return {
    state,
    absorbedByTemporaryHp,
    hpLost,
    overflow,
    deathSaveFailures: 0,
    concentrationCheckRequired,
    concentrationDc: concentrationCheckRequired
      ? concentrationCheckDc(damage)
      : null,
    concentrationTransition,
  };
}

export function applyHealing(
  current: CombatantState,
  rawHealing: number,
): { state: CombatantState; hpRestored: number } {
  const healing = nonNegativeIntegerValue(rawHealing, 0);
  if (healing === 0 || current.lifeState === "dead") {
    return { state: current, hpRestored: 0 };
  }
  const state = copyCombatant(current);
  const before = clamp(state.hpCurrent, 0, Math.max(1, state.hpMax));
  state.hpCurrent = Math.min(Math.max(1, state.hpMax), before + healing);
  if (state.hpCurrent > 0) {
    state.lifeState = "active";
    state.deathSaves = { ...EMPTY_DEATH_SAVES };
    state.statuses = state.statuses.filter(
      (status) => normalizedStatusId(status.id) !== "unconscious",
    );
  }
  return { state, hpRestored: state.hpCurrent - before };
}

export function resolveDeathSave(
  current: CombatantState,
  rawRoll: number,
): {
  state: CombatantState;
  roll: number;
  outcome:
    | "ignored"
    | "success"
    | "failure"
    | "stabilized"
    | "dead"
    | "revived";
} {
  const roll = d20(rawRoll);
  if (current.lifeState !== "downed") {
    return { state: current, roll, outcome: "ignored" };
  }
  if (roll === 20) {
    return { state: revive(current, 1), roll, outcome: "revived" };
  }

  const state = copyCombatant(current);
  if (roll === 1) {
    state.deathSaves.failures = clamp(state.deathSaves.failures + 2, 0, 3);
  } else if (roll >= 10) {
    state.deathSaves.successes = clamp(state.deathSaves.successes + 1, 0, 3);
  } else {
    state.deathSaves.failures = clamp(state.deathSaves.failures + 1, 0, 3);
  }

  if (state.deathSaves.failures >= 3) {
    state.lifeState = "dead";
    state.statuses = state.statuses.filter(
      (status) => normalizedStatusId(status.id) !== "unconscious",
    );
    return { state, roll, outcome: "dead" };
  }
  if (state.deathSaves.successes >= 3) {
    state.lifeState = "stable";
    state.deathSaves = { ...EMPTY_DEATH_SAVES };
    state.statuses = withStatus(state.statuses, { id: "unconscious" });
    return { state, roll, outcome: "stabilized" };
  }
  return {
    state,
    roll,
    outcome: roll >= 10 ? "success" : "failure",
  };
}

export function stabilize(current: CombatantState): CombatantState {
  if (current.lifeState !== "downed" && current.lifeState !== "stable") {
    return current;
  }
  const state = copyCombatant(current);
  state.lifeState = "stable";
  state.hpCurrent = 0;
  state.deathSaves = { ...EMPTY_DEATH_SAVES };
  state.statuses = withStatus(state.statuses, { id: "unconscious" });
  return state;
}

export function revive(current: CombatantState, hitPoints = 1): CombatantState {
  const state = copyCombatant(current);
  state.hpCurrent = clamp(
    Math.max(1, integerValue(hitPoints, 1)),
    1,
    Math.max(1, state.hpMax),
  );
  state.lifeState = "active";
  state.deathSaves = { ...EMPTY_DEATH_SAVES };
  state.statuses = state.statuses.filter(
    (status) => normalizedStatusId(status.id) !== "unconscious",
  );
  state.concentration = null;
  return state;
}

export function startConcentration(
  current: CombatantState,
  concentration: ConcentrationState,
): { state: CombatantState; transition: ConcentrationTransition } {
  const state = copyCombatant(current);
  const previous = state.concentration ? { ...state.concentration } : null;
  state.concentration = { ...concentration };
  return {
    state,
    transition: {
      previous,
      current: { ...concentration },
      reason: previous ? "replaced" : "started",
    },
  };
}

export function endConcentration(
  current: CombatantState,
  reason: ConcentrationEndReason,
): { state: CombatantState; transition: ConcentrationTransition } {
  const state = copyCombatant(current);
  const previous = state.concentration ? { ...state.concentration } : null;
  state.concentration = null;
  return {
    state,
    transition: { previous, current: null, reason },
  };
}

export function concentrationCheckDc(damage: number): number {
  return Math.max(10, Math.floor(nonNegativeIntegerValue(damage, 0) / 2));
}

export function resolveConcentrationCheck(
  current: CombatantState,
  input: { damage: number; roll: number; constitutionSaveModifier: number },
): {
  state: CombatantState;
  required: boolean;
  success: boolean;
  dc: number;
  total: number;
  transition: ConcentrationTransition | null;
} {
  const dc = concentrationCheckDc(input.damage);
  const save = resolveSavingThrow({
    roll: input.roll,
    modifier: input.constitutionSaveModifier,
    dc,
  });
  if (!current.concentration) {
    return {
      state: current,
      required: false,
      success: true,
      dc,
      total: save.total,
      transition: null,
    };
  }
  if (save.success) {
    return {
      state: current,
      required: true,
      success: true,
      dc,
      total: save.total,
      transition: null,
    };
  }
  const ended = endConcentration(current, "failed_save");
  return {
    state: ended.state,
    required: true,
    success: false,
    dc,
    total: save.total,
    transition: ended.transition,
  };
}

export function applyStatusEffect(
  current: CombatantState,
  effect: StatusEffect,
  sourceAbilityId?: string,
): {
  state: CombatantState;
  concentrationTransition: ConcentrationTransition | null;
} {
  let state = copyCombatant(current);
  state.statuses = withStatus(state.statuses, {
    id: normalizedStatusId(effect.status),
    ...(sourceAbilityId ? { sourceAbilityId } : {}),
    ...(effect.durationRounds === undefined
      ? {}
      : { durationRounds: nonNegativeIntegerValue(effect.durationRounds, 0) }),
    ...(effect.modifiers ? { modifiers: { ...effect.modifiers } } : {}),
  });
  let concentrationTransition: ConcentrationTransition | null = null;
  if (
    state.concentration &&
    deriveStatusModifiers(state.statuses).breaksConcentration
  ) {
    const ended = endConcentration(state, "incapacitated");
    state = ended.state;
    concentrationTransition = ended.transition;
  }
  return { state, concentrationTransition };
}

export function advanceStatuses(
  statuses: readonly StatusInstance[],
  rounds = 1,
): StatusInstance[] {
  const elapsed = Math.max(0, nonNegativeIntegerValue(rounds, 1));
  return statuses.flatMap((status) => {
    if (status.durationRounds === undefined) return [{ ...status }];
    const durationRounds = status.durationRounds - elapsed;
    return durationRounds > 0 ? [{ ...status, durationRounds }] : [];
  });
}

export function deriveStatusModifiers(
  statuses: readonly StatusInstance[],
  context: { incomingAttackDistance?: number } = {},
): StatusModifiers {
  const aggregate: StatusModifiers & {
    attackAdvantageScore: number;
    incomingAttackAdvantageScore: number;
    saveAdvantageScores: Partial<Record<AbilityScore, number>>;
  } = {
    attackRoll: 0,
    armorClass: 0,
    speedMultiplier: 1,
    movementCostMultiplier: 1,
    canAct: true,
    canMove: true,
    attackAdvantage: "normal",
    incomingAttackAdvantage: "normal",
    savingThrows: {},
    saveAdvantage: {},
    autoFailSaves: [],
    breaksConcentration: false,
    attackAdvantageScore: 0,
    incomingAttackAdvantageScore: 0,
    saveAdvantageScores: {},
  };

  for (const status of statuses) {
    const id = normalizedStatusId(status.id);
    if (id === "poisoned" || id === "blinded" || id === "restrained") {
      aggregate.attackAdvantageScore -= 1;
    }
    if (id === "blinded" || id === "restrained") {
      aggregate.incomingAttackAdvantageScore += 1;
    }
    if (id === "invisible" || id === "hidden") {
      aggregate.attackAdvantageScore += 1;
      aggregate.incomingAttackAdvantageScore -= 1;
    }
    if (id === "dodge") {
      aggregate.incomingAttackAdvantageScore -= 1;
      addSaveAdvantage(aggregate.saveAdvantageScores, "dex", 1);
    }
    if (id === "prone") {
      aggregate.attackAdvantageScore -= 1;
      aggregate.movementCostMultiplier *= 2;
      if (context.incomingAttackDistance !== undefined) {
        aggregate.incomingAttackAdvantageScore +=
          context.incomingAttackDistance <= 1 ? 1 : -1;
      }
    }
    if (id === "restrained") {
      aggregate.speedMultiplier = 0;
      addSaveAdvantage(aggregate.saveAdvantageScores, "dex", -1);
    }
    if (id === "slowed") aggregate.speedMultiplier *= 0.5;
    if (id === "shielded") aggregate.armorClass += 5;
    if (id === "stunned" || id === "unconscious") {
      aggregate.canAct = false;
      aggregate.canMove = false;
      aggregate.speedMultiplier = 0;
      aggregate.incomingAttackAdvantageScore += 1;
      aggregate.autoFailSaves.push("str", "dex");
      aggregate.breaksConcentration = true;
    }
    applyCustomStatusModifiers(aggregate, status.modifiers);
  }

  aggregate.attackAdvantage = advantageFromScore(
    aggregate.attackAdvantageScore,
  );
  aggregate.incomingAttackAdvantage = advantageFromScore(
    aggregate.incomingAttackAdvantageScore,
  );
  for (const ability of ABILITY_SCORES) {
    const score = aggregate.saveAdvantageScores[ability];
    if (score) aggregate.saveAdvantage[ability] = advantageFromScore(score);
  }
  aggregate.autoFailSaves = ABILITY_SCORES.filter((ability) =>
    aggregate.autoFailSaves.includes(ability),
  );
  return {
    attackRoll: aggregate.attackRoll,
    armorClass: aggregate.armorClass,
    speedMultiplier: aggregate.speedMultiplier,
    movementCostMultiplier: aggregate.movementCostMultiplier,
    canAct: aggregate.canAct,
    canMove: aggregate.canMove,
    attackAdvantage: aggregate.attackAdvantage,
    incomingAttackAdvantage: aggregate.incomingAttackAdvantage,
    savingThrows: aggregate.savingThrows,
    saveAdvantage: aggregate.saveAdvantage,
    autoFailSaves: aggregate.autoFailSaves,
    breaksConcentration: aggregate.breaksConcentration,
  };
}

export function reactionAbilitiesForTrigger(
  abilities: readonly AbilityDefinition[],
  trigger: ReactionTriggerKind,
  resources: CombatTurnResources,
): AbilityDefinition[] {
  return abilities.filter(
    (ability) =>
      ability.activation === "reaction" &&
      ability.reactionTriggers.includes(trigger) &&
      canPayAbilityCost(resources, ability.cost).ok,
  );
}

export function createReactionWindow(input: {
  id: string;
  trigger: ReactionTrigger;
  openedAt: number;
  expiresAt: number;
  eligible: Record<string, string[]>;
}): ReactionWindow {
  const eligible = Object.fromEntries(
    Object.entries(input.eligible).map(([combatantId, abilityIds]) => [
      combatantId,
      [...new Set(abilityIds.filter(Boolean))],
    ]),
  );
  const hasEligibleResponse = Object.values(eligible).some(
    (abilities) => abilities.length > 0,
  );
  return {
    id: input.id,
    trigger: {
      ...input.trigger,
      targetIds: [...input.trigger.targetIds],
    },
    openedAt: input.openedAt,
    expiresAt: Math.max(input.openedAt, input.expiresAt),
    status: hasEligibleResponse ? "open" : "resolved",
    eligible,
    responses: {},
    accepted: null,
  };
}

export function respondToReactionWindow(
  current: ReactionWindow,
  response: ReactionResponse,
): {
  ok: boolean;
  window: ReactionWindow;
  error?:
    | "window_closed"
    | "window_expired"
    | "ineligible_combatant"
    | "ineligible_ability"
    | "already_responded";
} {
  if (current.status !== "open") {
    return { ok: false, window: current, error: "window_closed" };
  }
  if (response.respondedAt >= current.expiresAt) {
    return {
      ok: false,
      window: expireReactionWindow(current, response.respondedAt),
      error: "window_expired",
    };
  }
  const eligible = current.eligible[response.combatantId];
  if (!eligible || eligible.length === 0) {
    return { ok: false, window: current, error: "ineligible_combatant" };
  }
  if (current.responses[response.combatantId]) {
    return { ok: false, window: current, error: "already_responded" };
  }
  if (response.abilityId !== null && !eligible.includes(response.abilityId)) {
    return { ok: false, window: current, error: "ineligible_ability" };
  }

  const accepted = response.abilityId === null ? null : { ...response };
  const responses = {
    ...current.responses,
    [response.combatantId]: { ...response },
  };
  const allPassed = Object.entries(current.eligible)
    .filter(([, options]) => options.length > 0)
    .every(([combatantId]) => responses[combatantId]?.abilityId === null);
  return {
    ok: true,
    window: {
      ...current,
      responses,
      accepted,
      status: accepted || allPassed ? "resolved" : "open",
    },
  };
}

export function expireReactionWindow(
  current: ReactionWindow,
  now: number,
): ReactionWindow {
  if (current.status !== "open" || now < current.expiresAt) return current;
  return { ...current, status: "expired" };
}

function isValidTargetRelation(
  rule: AbilityTargetRule,
  actor: { id: string; team: string },
  target: Pick<TargetCandidate, "id" | "team">,
): boolean {
  if (rule.kind === "none") return false;
  if (rule.kind === "self") return target.id === actor.id;
  if (!rule.includeSelf && target.id === actor.id) return false;
  if (rule.kind === "ally") return target.team === actor.team;
  if (rule.kind === "enemy") return target.team !== actor.team;
  return true;
}

function targetRule(
  kind: AbilityTargetKind,
  overrides: Partial<Omit<AbilityTargetRule, "kind">> = {},
): AbilityTargetRule {
  const none = kind === "none";
  return {
    kind,
    minTargets: none ? 0 : 1,
    maxTargets: none ? 0 : 1,
    range: 0,
    requiresLineOfSight: kind !== "none" && kind !== "self",
    includeSelf: kind === "self",
    allowDowned: false,
    allowDead: false,
    ...overrides,
  };
}

function activationCost(activation: AbilityActivation): AbilityCost {
  if (activation === "action") return { action: 1 };
  if (activation === "bonusAction") return { bonusAction: 1 };
  if (activation === "reaction") return { reaction: 1 };
  return {};
}

function activationFromDescription(description: string): AbilityActivation {
  const normalized = description.toLowerCase();
  if (normalized.includes("reaction")) return "reaction";
  if (normalized.includes("bonus action")) return "bonusAction";
  if (normalized.includes(" action")) return "action";
  return "passive";
}

function activationValue(
  value: unknown,
  fallback: AbilityActivation,
): AbilityActivation {
  if (
    value === "action" ||
    value === "bonusAction" ||
    value === "reaction" ||
    value === "free" ||
    value === "passive"
  ) {
    return value;
  }
  return fallback;
}

function targetKindValue(
  value: unknown,
  fallback: AbilityTargetKind,
): AbilityTargetKind {
  if (
    value === "none" ||
    value === "self" ||
    value === "ally" ||
    value === "enemy" ||
    value === "creature"
  ) {
    return value;
  }
  return fallback;
}

function parseReactionTriggers(value: unknown): ReactionTriggerKind[] {
  return [
    ...new Set(
      arrayValue(value).flatMap((entry) => {
        const trigger = stringValue(entry) as ReactionTriggerKind | null;
        return trigger && REACTION_TRIGGERS.includes(trigger) ? [trigger] : [];
      }),
    ),
  ];
}

function parseStatusModifierInput(value: unknown): StatusModifierInput {
  const input = recordValue(value);
  const result: StatusModifierInput = {};
  for (const field of ["attackRoll", "armorClass"] as const) {
    const parsed = optionalInteger(input[field]);
    if (parsed !== null) result[field] = parsed;
  }
  for (const field of ["speedMultiplier", "movementCostMultiplier"] as const) {
    const parsed = optionalNonNegativeNumber(input[field]);
    if (parsed !== null) result[field] = parsed;
  }
  for (const field of ["canAct", "canMove", "breaksConcentration"] as const) {
    if (typeof input[field] === "boolean") result[field] = input[field];
  }
  for (const field of ["attackAdvantage", "incomingAttackAdvantage"] as const) {
    const parsed = advantageValue(input[field]);
    if (parsed) result[field] = parsed;
  }
  const savingThrows = abilityNumberRecord(input.savingThrows);
  if (Object.keys(savingThrows).length) result.savingThrows = savingThrows;
  const saveAdvantage = abilityAdvantageRecord(input.saveAdvantage);
  if (Object.keys(saveAdvantage).length) result.saveAdvantage = saveAdvantage;
  const autoFailSaves = arrayValue(input.autoFailSaves).flatMap((entry) => {
    const ability = abilityScoreValue(entry, null);
    return ability ? [ability] : [];
  });
  if (autoFailSaves.length) result.autoFailSaves = [...new Set(autoFailSaves)];
  return result;
}

function applyCustomStatusModifiers(
  aggregate: StatusModifiers & {
    attackAdvantageScore: number;
    incomingAttackAdvantageScore: number;
    saveAdvantageScores: Partial<Record<AbilityScore, number>>;
  },
  modifiers: StatusModifierInput | undefined,
) {
  if (!modifiers) return;
  aggregate.attackRoll += integerValue(modifiers.attackRoll, 0);
  aggregate.armorClass += integerValue(modifiers.armorClass, 0);
  aggregate.speedMultiplier *= nonNegativeNumberValue(
    modifiers.speedMultiplier,
    1,
  );
  aggregate.movementCostMultiplier *= nonNegativeNumberValue(
    modifiers.movementCostMultiplier,
    1,
  );
  if (modifiers.canAct === false) aggregate.canAct = false;
  if (modifiers.canMove === false) aggregate.canMove = false;
  aggregate.attackAdvantageScore += advantageScore(modifiers.attackAdvantage);
  aggregate.incomingAttackAdvantageScore += advantageScore(
    modifiers.incomingAttackAdvantage,
  );
  for (const ability of ABILITY_SCORES) {
    const savingThrow = modifiers.savingThrows?.[ability];
    if (savingThrow !== undefined) {
      aggregate.savingThrows[ability] =
        (aggregate.savingThrows[ability] ?? 0) + savingThrow;
    }
    addSaveAdvantage(
      aggregate.saveAdvantageScores,
      ability,
      advantageScore(modifiers.saveAdvantage?.[ability]),
    );
  }
  aggregate.autoFailSaves.push(...(modifiers.autoFailSaves ?? []));
  if (modifiers.breaksConcentration) aggregate.breaksConcentration = true;
}

function addSaveAdvantage(
  values: Partial<Record<AbilityScore, number>>,
  ability: AbilityScore,
  amount: number,
) {
  if (amount === 0) return;
  values[ability] = (values[ability] ?? 0) + amount;
}

function advantageScore(value: AdvantageState | undefined): number {
  if (value === "advantage") return 1;
  if (value === "disadvantage") return -1;
  return 0;
}

function advantageFromScore(score: number): AdvantageState {
  if (score > 0) return "advantage";
  if (score < 0) return "disadvantage";
  return "normal";
}

function damageResult(state: CombatantState) {
  return {
    state,
    absorbedByTemporaryHp: 0,
    hpLost: 0,
    overflow: 0,
    deathSaveFailures: 0,
    concentrationCheckRequired: false,
    concentrationDc: null,
    concentrationTransition: null,
  };
}

function copyCombatant(state: CombatantState): CombatantState {
  return {
    ...state,
    deathSaves: { ...state.deathSaves },
    statuses: state.statuses.map((status) => ({
      ...status,
      modifiers: status.modifiers ? { ...status.modifiers } : undefined,
    })),
    concentration: state.concentration ? { ...state.concentration } : null,
  };
}

function withUnconsciousStatus(
  state: CombatantState,
  unconscious: boolean,
): CombatantState {
  return {
    ...state,
    statuses: unconscious
      ? withStatus(state.statuses, { id: "unconscious" })
      : state.statuses.filter(
          (status) => normalizedStatusId(status.id) !== "unconscious",
        ),
  };
}

function withStatus(
  statuses: readonly StatusInstance[],
  next: StatusInstance,
): StatusInstance[] {
  const id = normalizedStatusId(next.id);
  return [
    ...statuses.filter((status) => normalizedStatusId(status.id) !== id),
    { ...next, id },
  ];
}

function normalizedStatusId(value: string): string {
  return slug(value).replaceAll("-", "_");
}

function strongestAbility(
  scores: Record<string, unknown>,
  abilities: AbilityScore[],
): AbilityScore {
  return abilities.reduce((best, ability) =>
    integerValue(scores[ability], 10) > integerValue(scores[best], 10)
      ? ability
      : best,
  );
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function signedModifier(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return "";
}

function d20(value: number): number {
  return clamp(integerValue(value, 1), 1, 20);
}

function resourceRecord(value: unknown): Record<string, number> {
  const input = recordValue(value);
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, raw]) => {
      const amount = optionalNonNegativeInteger(raw);
      return key.trim() && amount !== null ? [[key.trim(), amount]] : [];
    }),
  );
}

function abilityNumberRecord(
  value: unknown,
): Partial<Record<AbilityScore, number>> {
  const input = recordValue(value);
  const result: Partial<Record<AbilityScore, number>> = {};
  for (const ability of ABILITY_SCORES) {
    const parsed = optionalInteger(input[ability]);
    if (parsed !== null) result[ability] = parsed;
  }
  return result;
}

function abilityAdvantageRecord(
  value: unknown,
): Partial<Record<AbilityScore, AdvantageState>> {
  const input = recordValue(value);
  const result: Partial<Record<AbilityScore, AdvantageState>> = {};
  for (const ability of ABILITY_SCORES) {
    const parsed = advantageValue(input[ability]);
    if (parsed) result[ability] = parsed;
  }
  return result;
}

function advantageValue(value: unknown): AdvantageState | null {
  return value === "normal" || value === "advantage" || value === "disadvantage"
    ? value
    : null;
}

function abilityScoreValue<T extends AbilityScore | null>(
  value: unknown,
  fallback: T,
): AbilityScore | T {
  return ABILITY_SCORES.includes(value as AbilityScore)
    ? (value as AbilityScore)
    : fallback;
}

function effectAmount(value: unknown, fallback: EffectAmount): EffectAmount {
  return optionalEffectAmount(value) ?? fallback;
}

function optionalEffectAmount(value: unknown): EffectAmount | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  const notation = stringValue(value);
  if (notation && /^(?:\d+d\d+|\d+)(?:[+-]\d+)?$/i.test(notation)) {
    return notation.toLowerCase();
  }
  return undefined;
}

function slug(value: string): string {
  const slugged = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slugged || "unnamed";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function nonNegativeIntegerValue(value: unknown, fallback: number): number {
  const parsed = optionalInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : fallback;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  const parsed = optionalInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function nonNegativeNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function optionalNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
