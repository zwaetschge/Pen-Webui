import { NextResponse } from "next/server";
import { z } from "zod";
import { rollDice, type DiceResult } from "@/lib/dice";
import { prisma } from "@/lib/db";
import { resolveAccess, type SessionAccess } from "./access";
import { publishEvent } from "./bus";
import { isActiveTurnForToken, activeInitiativeName } from "./combat-turn";
import {
  DEFAULT_TOKEN_MOVEMENT,
  movementRangeForToken,
  tileKey,
  tokenMovement,
  type MovementGrid,
  type MovementToken,
} from "./movement";
import { movementGridForSession } from "./movement-grid";
import { schedulePendingTurnDrain } from "./pending-turn-waker";
import {
  activeCombatStateForSession,
  combatResourcesForTurn,
} from "./tactical-state";
import { withSessionMutation } from "./session-mutation";
import {
  normalizeEncounterRuntime,
  withCompletedTurnMember,
  withPlannedAction,
  withoutPlannedAction,
  type EncounterRuntime,
} from "./encounter-runtime";
import {
  activeTurnGroup,
  remainingGroupTokenIds,
  tokenCanActInGroup,
} from "./turn-groups";
import {
  abilitiesForSheet,
  advanceStatuses,
  applyDamage,
  applyHealing,
  canPayAbilityCost,
  createTurnResources,
  resolveDeathSave,
  resolveConcentrationCheck,
  resolveSavingThrow,
  revive,
  startConcentration,
  stabilize,
  validateAbilityTargets,
  type AbilityDefinition,
  type CombatantState,
  type StatusInstance,
} from "./rules/combat";
import {
  interactWithObject,
  applySurface,
  lineOfSight,
  normalizeTacticalGrid,
  positionModifiersBetween,
  resolveShove,
  surfaceEffectAt,
  visibilityBetween,
  type TacticalGrid,
  type TacticalObjectAction,
} from "./rules/tactical";
import {
  loadPartyContext,
  partyStateForContext,
  persistPartyState,
  publishPartyEvent,
} from "./gameplay-api";
import {
  reducePartyState,
  type PartyDomainEvent,
  type PartyRuntimeState,
} from "./rules/party";
import {
  chooseCombatAiAction,
  combatAiIntentPayload,
  type CombatAiUnit,
} from "./combat-ai";

const ACTION_TYPES = [
  "attack",
  "bonus_action",
  "dash",
  "dodge",
  "disengage",
  "end_turn",
  "reaction",
  "use_ability",
  "plan_action",
  "respond_reaction",
  "hide",
  "shove",
  "interact",
  "death_save",
] as const;
const bodySchema = z.object({
  type: z.enum(ACTION_TYPES),
  actorTokenId: z.string().min(1).max(120).optional(),
  abilityId: z.string().min(1).max(180).optional(),
  targetTokenId: z.string().min(1).max(120).optional(),
  targetCell: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  reactionId: z.string().min(1).max(180).optional(),
  reactionChoice: z.string().min(1).max(180).optional(),
  objectId: z.string().min(1).max(180).optional(),
  objectAction: z
    .enum(["open", "close", "toggle", "damage", "ignite", "trigger", "disarm"])
    .optional(),
  requestId: z.string().min(8).max(120).optional(),
});

type Access = NonNullable<SessionAccess>;
type CombatAction = z.infer<typeof bodySchema>;
type CombatToken = MovementToken;

const DAMAGE_TYPES = new Set([
  "slashing",
  "piercing",
  "bludgeoning",
  "fire",
  "cold",
  "lightning",
  "thunder",
  "acid",
  "poison",
  "necrotic",
  "radiant",
  "psychic",
  "force",
]);

export async function handleCombatAction(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const inviteToken =
    inviteTokenOverride !== undefined
      ? inviteTokenOverride
      : new URL(req.url).searchParams.get("token");
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );
  }

  return withSessionMutation(sessionId, async () => {
    const duplicate = await existingMutationEvent(
      sessionId,
      body.data.requestId,
      ["combat_action_used", "combat_turn_ended"],
    );
    if (duplicate) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        eventId: duplicate.id,
      });
    }

    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { campaignId: true, endedAt: true },
    });
    if (!session || session.endedAt) {
      return NextResponse.json({ error: "session_closed" }, { status: 410 });
    }

    const encounter = await prisma.encounter.findFirst({
      where: { campaignId: session.campaignId, status: "active" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        initiative: true,
        activeTurn: true,
        round: true,
        locationId: true,
        runtime: true,
      },
    });
    if (!encounter) {
      return NextResponse.json({ error: "no_active_combat" }, { status: 409 });
    }

    const combatState = await activeCombatStateForSession(sessionId);
    const tokens = combatState?.tokens ?? [];
    const initiativeToken = activeTokenForTurn({
      initiative: encounter.initiative,
      turnIndex: encounter.activeTurn,
      tokens,
    });
    if (!initiativeToken) {
      return NextResponse.json(
        { error: "active_token_not_found" },
        { status: 409 },
      );
    }

    const encounterRuntime = normalizeEncounterRuntime(encounter.runtime);

    if (body.data.type === "respond_reaction") {
      return respondToPendingReaction({
        sessionId,
        campaignId: session.campaignId,
        encounter,
        combatStartedAt: combatState?.startedAt ?? new Date(),
        actionEvents: combatState?.actionEvents ?? [],
        tokens,
        activeToken: initiativeToken,
        access,
        requestId: body.data.requestId,
        encounterRuntime,
        turnGroup: activeTurnGroup(
          encounter.initiative,
          encounter.activeTurn,
          tokens,
        ),
        action: body.data,
      });
    }

    if (body.data.type === "plan_action") {
      return planCombatAction({
        sessionId,
        campaignId: session.campaignId,
        encounter,
        tokens,
        access,
        runtime: encounterRuntime,
        action: body.data,
      });
    }

    const group = activeTurnGroup(
      encounter.initiative,
      encounter.activeTurn,
      tokens,
    );
    const completedTokenIds =
      encounterRuntime.turnGroup?.round === encounter.round &&
      encounterRuntime.turnGroup.startIndex === group?.startIndex
        ? encounterRuntime.turnGroup.completedTokenIds
        : [];
    const requestedTokenId =
      body.data.actorTokenId ??
      (access.role === "player" ? access.characterId : null) ??
      initiativeToken.id;
    const activeToken =
      tokens.find(
        (token) =>
          token.id === requestedTokenId &&
          tokenCanActInGroup(token.id, group, completedTokenIds),
      ) ?? initiativeToken;

    if (
      !tokenCanActInGroup(activeToken.id, group, completedTokenIds) ||
      !(await canActWithToken({
        access,
        campaignId: session.campaignId,
        token: activeToken,
      }))
    ) {
      return NextResponse.json(
        {
          error: "not_your_turn",
          active: activeInitiativeName(
            encounter.initiative,
            encounter.activeTurn,
          ),
        },
        { status: 409 },
      );
    }

    const context = {
      sessionId,
      campaignId: session.campaignId,
      encounter,
      combatStartedAt: combatState?.startedAt ?? new Date(),
      actionEvents: combatState?.actionEvents ?? [],
      tokens,
      activeToken,
      access,
      requestId: body.data.requestId,
      encounterRuntime,
      turnGroup: group,
    };

    if (body.data.type === "end_turn") {
      const result = await endTurn(context);
      return NextResponse.json(result);
    }

    if (body.data.type === "death_save") {
      return resolvePlayerDeathSave(context);
    }

    if (tokenHp(activeToken) <= 0) {
      return NextResponse.json({ error: "character_downed" }, { status: 409 });
    }

    const resources = combatResourcesForTurn(context.actionEvents, {
      tokenId: activeToken.id,
      round: encounter.round,
      turnIndex: encounter.activeTurn,
    });

    if (body.data.type === "bonus_action") {
      if (resources.bonusActionUsed) {
        return NextResponse.json(
          { error: "bonus_action_spent" },
          { status: 409 },
        );
      }
      await markActionUsed(context, {
        actionType: "bonus_action",
        resource: "bonusAction",
      });
      return NextResponse.json({ ok: true, action: "bonus_action" });
    }

    if (body.data.type === "reaction") {
      if (resources.reactionUsed) {
        return NextResponse.json({ error: "reaction_spent" }, { status: 409 });
      }
      await markActionUsed(context, {
        actionType: "reaction",
        resource: "reaction",
      });
      return NextResponse.json({ ok: true, action: "reaction" });
    }

    // Ability costs are validated against their actual action economy inside
    // executeCombatAbility. A spent action must not block a still-available bonus
    // action or reaction ability.
    if (body.data.type === "use_ability") {
      return executeCombatAbility(context, body.data, resources);
    }

    if (resources.actionUsed) {
      return NextResponse.json({ error: "action_spent" }, { status: 409 });
    }

    if (body.data.type === "dash") {
      await markActionUsed(context, {
        actionType: "dash",
        movementBonus: tokenMovement(activeToken),
      });
      return NextResponse.json({ ok: true, action: "dash" });
    }

    if (body.data.type === "dodge" || body.data.type === "disengage") {
      await markActionUsed(context, { actionType: body.data.type });
      return NextResponse.json({ ok: true, action: body.data.type });
    }

    if (body.data.type === "hide") {
      return hideCombatant(context);
    }

    if (body.data.type === "shove") {
      return shoveCombatant(context, body.data);
    }

    if (body.data.type === "interact") {
      return interactWithEncounterObject(context, body.data);
    }

    const attack = await resolveAttack(context, body.data);
    if ("response" in attack) return attack.response;
    await markActionUsed(context, { actionType: "attack" });
    const result = await publishAttack(context, {
      actor: activeToken,
      target: attack.target,
      actorId: access.userId,
      attackRollModifier: attack.attackRollModifier,
    });
    const projectedTokens = applyProjectedDamage(tokens, result);
    const ended = await maybeEndCombat({
      sessionId,
      encounterId: encounter.id,
      tokens: projectedTokens,
    });

    return NextResponse.json({
      ok: true,
      action: "attack",
      hit: result.hit,
      critical: result.critical,
      damage: result.damage,
      combatEnded: ended,
    });
  });
}

async function resolveAttack(
  context: CombatContext,
  action: CombatAction,
): Promise<
  | { target: CombatToken; attackRollModifier: number }
  | { response: NextResponse }
> {
  if (!action.targetTokenId) {
    return {
      response: NextResponse.json(
        { error: "target_required" },
        { status: 400 },
      ),
    };
  }
  const target = context.tokens.find(
    (token) => token.id === action.targetTokenId,
  );
  if (!target || tokenHp(target) <= 0) {
    return {
      response: NextResponse.json(
        { error: "target_not_found" },
        { status: 404 },
      ),
    };
  }
  if (!areHostile(context.activeToken, target)) {
    return {
      response: NextResponse.json({ error: "invalid_target" }, { status: 422 }),
    };
  }
  const range = attackRange(context.activeToken);
  if (distance(context.activeToken, target) > range) {
    return {
      response: NextResponse.json(
        { error: "target_out_of_range", range },
        { status: 422 },
      ),
    };
  }
  const positioning = await basicAttackPosition(
    context,
    context.activeToken,
    target,
  );
  if (!positioning.visible || positioning.attackRollModifier === null) {
    return {
      response: NextResponse.json(
        { error: "target_not_visible", cover: positioning.cover },
        { status: 422 },
      ),
    };
  }
  return { target, attackRollModifier: positioning.attackRollModifier };
}

type CombatContext = {
  sessionId: string;
  campaignId: string;
  encounter: {
    id: string;
    initiative: unknown;
    activeTurn: number;
    round: number;
    locationId: string | null;
    runtime?: unknown;
  };
  combatStartedAt: Date;
  actionEvents: NonNullable<
    Awaited<ReturnType<typeof activeCombatStateForSession>>
  >["actionEvents"];
  tokens: CombatToken[];
  activeToken: CombatToken;
  access: Access;
  requestId?: string;
  encounterRuntime: EncounterRuntime;
  turnGroup: ReturnType<typeof activeTurnGroup>;
};

async function canActWithToken(input: {
  access: Access;
  campaignId: string;
  token: CombatToken;
}) {
  if (input.access.role === "host") return true;
  if (input.token.team !== "player") return false;
  if (input.access.characterId === input.token.id) return true;
  if (!input.access.userId) return false;
  const character = await prisma.character.findFirst({
    where: {
      id: input.token.id,
      campaignId: input.campaignId,
      ownerId: input.access.userId,
    },
    select: { id: true },
  });
  return Boolean(character);
}

async function planCombatAction(input: {
  sessionId: string;
  campaignId: string;
  encounter: CombatContext["encounter"];
  tokens: CombatToken[];
  access: Access;
  runtime: EncounterRuntime;
  action: CombatAction;
}) {
  const actorTokenId =
    input.action.actorTokenId ??
    (input.access.role === "player" ? input.access.characterId : null);
  const abilityId = input.action.abilityId;
  if (!actorTokenId || !abilityId) {
    return NextResponse.json(
      { error: "actor_and_ability_required" },
      { status: 400 },
    );
  }
  const actor = input.tokens.find((token) => token.id === actorTokenId);
  if (
    !actor ||
    tokenHp(actor) <= 0 ||
    !(await canActWithToken({
      access: input.access,
      campaignId: input.campaignId,
      token: actor,
    }))
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const abilities = await abilitiesForActor(input.campaignId, actor);
  const ability = abilities.find((candidate) => candidate.id === abilityId);
  if (!ability) {
    return NextResponse.json({ error: "ability_not_found" }, { status: 404 });
  }
  const runtime = withPlannedAction(input.runtime, {
    actorTokenId,
    abilityId,
    ...(input.action.targetTokenId
      ? { targetTokenId: input.action.targetTokenId }
      : {}),
    ...(input.action.targetCell ? { targetCell: input.action.targetCell } : {}),
    createdAt: Date.now(),
  });
  await persistEncounterRuntime(input.encounter.id, runtime);
  await publishEvent(
    input.sessionId,
    "action_planned",
    {
      encounterId: input.encounter.id,
      actorTokenId,
      actorName: actor.name ?? actor.id,
      abilityId,
      abilityName: ability.name,
      targetTokenId: input.action.targetTokenId,
      targetCell: input.action.targetCell,
    },
    { actorId: input.access.userId },
  );
  return NextResponse.json({
    ok: true,
    action: "plan_action",
    plan: runtime.plans[actorTokenId],
  });
}

async function respondToPendingReaction(
  context: CombatContext & { action: CombatAction },
) {
  const reaction = context.encounterRuntime.reaction;
  if (!reaction || reaction.id !== context.action.reactionId) {
    return NextResponse.json({ error: "reaction_not_found" }, { status: 404 });
  }
  const reactor = context.tokens.find(
    (token) => token.id === reaction.reactorTokenId,
  );
  if (
    !reactor ||
    !(await canActWithToken({
      access: context.access,
      campaignId: context.campaignId,
      token: reactor,
    }))
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let choice = context.action.reactionChoice ?? "pass";
  if (Date.now() >= reaction.expiresAt) choice = "pass";
  if (!reaction.options.includes(choice)) {
    return NextResponse.json(
      { error: "invalid_reaction_choice" },
      { status: 422 },
    );
  }

  let runtime: EncounterRuntime = {
    ...context.encounterRuntime,
    reaction: null,
  };
  let armorClassBonus = 0;
  if (choice === "core:guard") {
    armorClassBonus = 2;
    runtime = {
      ...runtime,
      statuses: {
        ...runtime.statuses,
        [reactor.id]: [
          ...(runtime.statuses[reactor.id] ?? []).filter(
            (status) => status.id !== "guarded",
          ),
          {
            id: "guarded",
            sourceAbilityId: "core:guard",
            durationRounds: 1,
            modifiers: { armorClass: 2 },
          },
        ],
      },
    };
    await publishEvent(context.sessionId, "combat_action_used", {
      encounterId: context.encounter.id,
      tokenId: reactor.id,
      tokenName: reactor.name ?? reactor.id,
      actionType: "core:guard",
      resource: "reaction",
      movementBonus: 0,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    });
    await publishEvent(context.sessionId, "status_updated", {
      tokenId: reactor.id,
      status: "guarded",
      active: true,
      durationRounds: 1,
    });
  }
  await persistEncounterRuntime(context.encounter.id, runtime);
  await publishEvent(context.sessionId, "reaction_resolved", {
    encounterId: context.encounter.id,
    reactionId: reaction.id,
    reactorTokenId: reactor.id,
    choice,
    expired: Date.now() >= reaction.expiresAt,
  });

  const pending = reaction.pendingCommand;
  if (pending.kind !== "npc_attack") {
    return NextResponse.json({ ok: true, action: "respond_reaction", choice });
  }
  const actor = context.tokens.find(
    (token) => token.id === pending.actorTokenId,
  );
  const target = context.tokens.find(
    (token) => token.id === pending.targetTokenId,
  );
  if (!actor || !target || tokenHp(actor) <= 0 || tokenHp(target) <= 0) {
    return NextResponse.json({ ok: true, action: "respond_reaction", choice });
  }
  const attackContext = {
    ...context,
    activeToken: actor,
    encounterRuntime: runtime,
  };
  await publishEvent(context.sessionId, "combat_action_used", {
    encounterId: context.encounter.id,
    tokenId: actor.id,
    tokenName: actor.name ?? actor.id,
    actionType: "attack",
    resource: "action",
    movementBonus: 0,
    round: context.encounter.round,
    turnIndex: context.encounter.activeTurn,
  });
  const result = await publishAttack(attackContext, {
    actor,
    target,
    actorId: null,
    targetAcBonus: armorClassBonus,
    attackRollModifier: integerOr(pending.attackRollModifier, 0),
  });
  const projectedTokens = applyProjectedDamage(context.tokens, result);
  await publishEvent(context.sessionId, "combat_turn_ended", {
    encounterId: context.encounter.id,
    tokenId: actor.id,
    tokenName: actor.name ?? actor.id,
    round: context.encounter.round,
    turnIndex: context.encounter.activeTurn,
    automated: true,
  });
  const grid = await movementGridForSession({
    sessionId: context.sessionId,
    campaignId: context.campaignId,
    locationId: context.encounter.locationId,
  });
  const next = await advanceUntilPlayerTurn({
    ...attackContext,
    tokens: projectedTokens,
    grid,
  });
  return NextResponse.json({
    ok: true,
    action: "respond_reaction",
    choice,
    hit: result.hit,
    damage: result.damage,
    active: next.activeName,
    combatEnded: next.combatEnded,
  });
}

async function abilitiesForActor(campaignId: string, token: CombatToken) {
  if (token.team === "player") {
    const character = await prisma.character.findFirst({
      where: { id: token.id, campaignId },
      select: { sheet: true },
    });
    return abilitiesForSheet(character?.sheet);
  }
  const npc = await prisma.nPC.findFirst({
    where: { id: token.id, campaignId },
    select: { sheet: true },
  });
  return abilitiesForSheet(npc?.sheet);
}

async function persistEncounterRuntime(
  encounterId: string,
  runtime: EncounterRuntime,
) {
  await prisma.encounter.update({
    where: { id: encounterId },
    data: { runtime: runtime as never },
  });
}

async function executeCombatAbility(
  context: CombatContext,
  action: CombatAction,
  spentResources: ReturnType<typeof combatResourcesForTurn>,
) {
  if (!action.abilityId) {
    return NextResponse.json({ error: "ability_required" }, { status: 400 });
  }
  const ability = (
    await abilitiesForActor(context.campaignId, context.activeToken)
  ).find((candidate) => candidate.id === action.abilityId);
  if (!ability) {
    return NextResponse.json({ error: "ability_not_found" }, { status: 404 });
  }
  if (ability.id === "core:hide") {
    return hideCombatant(context);
  }
  if (ability.id === "core:shove") {
    return shoveCombatant(context, action);
  }
  if (ability.requiresAdjudication) {
    return NextResponse.json(
      { error: "ability_requires_dm", ability: ability.name },
      { status: 422 },
    );
  }

  const target = resolveAbilityTarget(context, ability, action.targetTokenId);
  if ("response" in target) return target.response;
  const grid = await tacticalGridForContext(context);
  const candidates = await Promise.all(
    target.tokens.map(async (candidate) => ({
      id: candidate.id,
      team: candidate.team ?? "monster",
      distance: tacticalDistance(context.activeToken, candidate),
      lineOfSight: lineOfSight(grid, context.activeToken, candidate).visible,
      lifeState:
        candidate.team === "player"
          ? (await combatantStateForToken(context.campaignId, candidate))
              .lifeState
          : lifeStateForToken(candidate),
    })),
  );
  const targetCheck = validateAbilityTargets(
    ability,
    { id: context.activeToken.id, team: context.activeToken.team ?? "monster" },
    candidates,
  );
  if (!targetCheck.ok) {
    return NextResponse.json(
      { error: "invalid_ability_target", issues: targetCheck.issues },
      { status: 422 },
    );
  }

  const partyContext =
    context.activeToken.team === "player" &&
    Object.keys(ability.cost.resources ?? {}).length > 0
      ? await loadPartyContext(context.sessionId)
      : null;
  let partyState = partyContext ? partyStateForContext(partyContext) : null;
  const resourcePool = partyState
    ? persistentResourcePool(partyState, context.activeToken.id)
    : {};
  const movementSpent = movementSpentForToken(
    context.actionEvents,
    context.activeToken.id,
    context.encounter.round,
    context.encounter.activeTurn,
  );
  const turnResources = createTurnResources({
    action: spentResources.actionUsed ? 0 : 1,
    bonusAction: spentResources.bonusActionUsed ? 0 : 1,
    reaction: spentResources.reactionUsed ? 0 : 1,
    movement: Math.max(0, tokenMovement(context.activeToken) - movementSpent),
    resources: resourcePool,
  });
  const payable = canPayAbilityCost(turnResources, ability.cost);
  if (!payable.ok) {
    return NextResponse.json(
      { error: "ability_resource_missing", missing: payable.missing },
      { status: 409 },
    );
  }

  if (partyContext && partyState) {
    const spent = spendPersistentResources({
      state: partyState,
      memberId: context.activeToken.id,
      costs: ability.cost.resources ?? {},
      requestId: context.requestId ?? `${Date.now()}:${ability.id}`,
    });
    if (!spent.ok) {
      return NextResponse.json({ error: spent.error }, { status: 409 });
    }
    partyState = spent.state;
    if (spent.events.length > 0) {
      await persistPartyState(partyContext, partyState);
      for (const event of spent.events) {
        await publishPartyEvent(
          context.sessionId,
          event,
          partyState,
          context.access,
        );
      }
    }
  }

  const resource = ability.cost.reaction
    ? "reaction"
    : ability.cost.bonusAction
      ? "bonusAction"
      : "action";
  await markActionUsed(context, {
    actionType: ability.id,
    resource,
    movementBonus: ability.effects.reduce(
      (total, effect) =>
        effect.kind === "resource" && effect.resource === "movement"
          ? total + effect.amount
          : total,
      0,
    ),
  });

  let runtime = withoutPlannedAction(
    context.encounterRuntime,
    context.activeToken.id,
  );
  const outcomes: Array<Record<string, unknown>> = [];
  for (const effect of ability.effects) {
    for (const effectTarget of target.tokens) {
      const result = await applyAbilityEffect({
        context,
        ability,
        effect,
        target: effectTarget,
        grid,
        runtime,
      });
      runtime = result.runtime;
      outcomes.push(result.outcome);
    }
  }

  if (ability.concentration && context.activeToken.team === "player") {
    const actorState = await combatantStateForToken(
      context.campaignId,
      context.activeToken,
    );
    const concentrated = startConcentration(actorState, {
      abilityId: ability.id,
      sourceId: context.activeToken.id,
      startedRound: context.encounter.round,
      startedTurn: context.encounter.activeTurn,
    });
    await persistPlayerCombatant(context.campaignId, concentrated.state);
    await publishEvent(context.sessionId, "concentration_changed", {
      characterId: context.activeToken.id,
      tokenId: context.activeToken.id,
      abilityId: ability.id,
      active: true,
      replacedAbilityId: concentrated.transition.previous?.abilityId ?? null,
    });
  }

  await persistEncounterRuntime(context.encounter.id, runtime);
  await publishEvent(
    context.sessionId,
    "ability_used",
    {
      encounterId: context.encounter.id,
      actorTokenId: context.activeToken.id,
      actorName: context.activeToken.name ?? context.activeToken.id,
      abilityId: ability.id,
      abilityName: ability.name,
      activation: ability.activation,
      targetTokenIds: target.tokens.map((candidate) => candidate.id),
      outcomes,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    },
    { actorId: context.access.userId },
  );
  return NextResponse.json({
    ok: true,
    action: "use_ability",
    abilityId: ability.id,
    outcomes,
  });
}

function resolveAbilityTarget(
  context: CombatContext,
  ability: AbilityDefinition,
  targetTokenId?: string,
): { tokens: CombatToken[] } | { response: NextResponse } {
  if (ability.target.kind === "none") return { tokens: [] };
  if (ability.target.kind === "self" && !targetTokenId) {
    return { tokens: [context.activeToken] };
  }
  const target = context.tokens.find(
    (candidate) => candidate.id === (targetTokenId ?? context.activeToken.id),
  );
  if (!target) {
    return {
      response: NextResponse.json(
        { error: "target_not_found" },
        { status: 404 },
      ),
    };
  }
  return { tokens: [target] };
}

async function tacticalGridForContext(context: CombatContext) {
  const movementGrid = await movementGridForSession({
    sessionId: context.sessionId,
    campaignId: context.campaignId,
    locationId: context.encounter.locationId,
  });
  return normalizeTacticalGrid({
    ...movementGrid,
    surfaces: context.encounterRuntime.surfaces,
    objects: context.encounterRuntime.objects,
  });
}

async function basicAttackPosition(
  context: CombatContext,
  actor: CombatToken,
  target: CombatToken,
) {
  const grid = await tacticalGridForContext(context);
  const visibility = lineOfSight(grid, actor, target);
  const position = positionModifiersBetween(grid, actor, target);
  return {
    visible: visibility.visible,
    cover: position.cover.level,
    attackRollModifier: position.totalAttackRollModifier,
  };
}

function persistentResourcePool(state: PartyRuntimeState, memberId: string) {
  return Object.fromEntries(
    Object.values(state.resources[memberId] ?? {}).flatMap((resource) => {
      const entries: Array<[string, number]> = [
        [resource.id, resource.current],
      ];
      if (resource.kind === "spell_slot" && resource.level) {
        entries.push([`spellSlot:${resource.level}`, resource.current]);
      }
      return entries;
    }),
  );
}

function spendPersistentResources(input: {
  state: PartyRuntimeState;
  memberId: string;
  costs: Record<string, number>;
  requestId: string;
}) {
  let state = input.state;
  const events: PartyDomainEvent[] = [];
  let index = 0;
  for (const [rawResourceId, amount] of Object.entries(input.costs)) {
    const resourceId = rawResourceId.replace(/^spellSlot:/, "spell-slot-");
    const result = reducePartyState(state, {
      type: "resource.spend",
      commandId: `${input.requestId}:resource:${index}`,
      memberId: input.memberId,
      resourceId,
      amount,
    });
    if (!result.ok) return { ok: false as const, error: result.error.code };
    state = result.state;
    events.push(...result.events);
    index += 1;
  }
  return { ok: true as const, state, events };
}

async function applyAbilityEffect(input: {
  context: CombatContext;
  ability: AbilityDefinition;
  effect: AbilityDefinition["effects"][number];
  target: CombatToken;
  grid: TacticalGrid;
  runtime: EncounterRuntime;
}): Promise<{ runtime: EncounterRuntime; outcome: Record<string, unknown> }> {
  const { context, ability, effect, target, grid } = input;
  if (effect.kind === "resource") {
    return {
      runtime: input.runtime,
      outcome: {
        kind: effect.kind,
        resource: effect.resource,
        amount: effect.amount,
      },
    };
  }

  if (effect.kind === "status") {
    const status = {
      id: effect.status,
      sourceAbilityId: ability.id,
      durationRounds: effect.durationRounds,
      modifiers: effect.modifiers,
    };
    const existing = input.runtime.statuses[target.id] ?? [];
    const runtime = {
      ...input.runtime,
      statuses: {
        ...input.runtime.statuses,
        [target.id]: [
          ...existing.filter((entry) => entry.id !== effect.status),
          status,
        ],
      },
    };
    await publishEvent(context.sessionId, "status_updated", {
      tokenId: target.id,
      status: effect.status,
      active: true,
      durationRounds: effect.durationRounds ?? null,
      sourceAbilityId: ability.id,
    });
    return {
      runtime,
      outcome: {
        kind: effect.kind,
        targetId: target.id,
        status: effect.status,
      },
    };
  }

  if (effect.kind === "stabilize") {
    const before = await combatantStateForToken(context.campaignId, target);
    const after = stabilize(before);
    await persistPlayerCombatant(context.campaignId, after);
    await publishEvent(context.sessionId, "character_stabilized", {
      characterId: target.id,
      tokenId: target.id,
      tokenName: target.name ?? target.id,
      sourceTokenId: context.activeToken.id,
    });
    return {
      runtime: input.runtime,
      outcome: {
        kind: effect.kind,
        targetId: target.id,
        lifeState: after.lifeState,
      },
    };
  }

  if (effect.kind === "revive") {
    const before = await combatantStateForToken(context.campaignId, target);
    const after = revive(before, effect.hitPoints);
    await persistPlayerCombatant(context.campaignId, after);
    await publishEvent(context.sessionId, "character_revived", {
      characterId: target.id,
      tokenId: target.id,
      tokenName: target.name ?? target.id,
      hp: after.hpCurrent,
      sourceTokenId: context.activeToken.id,
    });
    await publishEvent(context.sessionId, "healing_applied", {
      targetId: target.id,
      amount: after.hpCurrent,
      sourceTokenId: context.activeToken.id,
    });
    return {
      runtime: input.runtime,
      outcome: { kind: effect.kind, targetId: target.id, hp: after.hpCurrent },
    };
  }

  if (effect.kind === "heal") {
    const amount = rollEffectAmount(effect.amount, false);
    const before = await combatantStateForToken(context.campaignId, target);
    const healed = applyHealing(before, amount.total);
    await persistPlayerCombatant(context.campaignId, healed.state);
    if (amount.roll) {
      await publishEffectRoll(context, amount.roll, `${ability.name}: Heilung`);
    }
    await publishEvent(context.sessionId, "healing_applied", {
      targetId: target.id,
      amount: healed.hpRestored,
      sourceTokenId: context.activeToken.id,
      sourceName: context.activeToken.name ?? context.activeToken.id,
    });
    if (before.lifeState !== "active" && healed.state.lifeState === "active") {
      await publishEvent(context.sessionId, "character_revived", {
        characterId: target.id,
        tokenId: target.id,
        tokenName: target.name ?? target.id,
        hp: healed.state.hpCurrent,
        sourceTokenId: context.activeToken.id,
      });
    }
    return {
      runtime: input.runtime,
      outcome: {
        kind: effect.kind,
        targetId: target.id,
        amount: healed.hpRestored,
      },
    };
  }

  if (effect.kind === "attack") {
    const position = positionModifiersBetween(
      grid,
      context.activeToken,
      target,
    );
    if (position.totalAttackRollModifier === null) {
      return {
        runtime: input.runtime,
        outcome: {
          kind: effect.kind,
          targetId: target.id,
          blockedByCover: true,
        },
      };
    }
    const attackBonus = effect.attackBonus + position.totalAttackRollModifier;
    const attackRoll = rollDice(`1d20${signedModifier(attackBonus)}`);
    const natural = keptD20(attackRoll);
    const guarded = statusArmorBonus(input.runtime, target.id);
    const targetAc = tokenAc(target) + guarded;
    const hit =
      natural === 20 || (natural !== 1 && attackRoll.total >= targetAc);
    const amount = hit
      ? rollEffectAmount(effect.damage, natural === 20)
      : { total: 0, roll: null };
    await publishEffectRoll(
      context,
      attackRoll,
      `${ability.name}: ${context.activeToken.name ?? context.activeToken.id} -> ${target.name ?? target.id}`,
    );
    if (amount.roll) {
      await publishEffectRoll(context, amount.roll, `${ability.name}: Schaden`);
    }
    await publishEvent(context.sessionId, "attack_resolved", {
      encounterId: context.encounter.id,
      actorTokenId: context.activeToken.id,
      actorName: context.activeToken.name ?? context.activeToken.id,
      targetTokenId: target.id,
      targetName: target.name ?? target.id,
      abilityId: ability.id,
      attackTotal: attackRoll.total,
      attackBreakdown: attackRoll.breakdown,
      targetAc,
      hit,
      critical: natural === 20,
      cover: position.cover.level,
      height: position.height.label,
      damage: amount.total,
      damageType: effect.damageType,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    });
    if (amount.total > 0) {
      await applyDamageToToken(
        context,
        target,
        amount.total,
        effect.damageType,
        {
          critical: natural === 20,
        },
      );
    }
    const elementalRuntime =
      hit && amount.total > 0
        ? await applyElementalSurfaceEffect(
            context,
            input.runtime,
            grid,
            target,
            effect.damageType,
          )
        : input.runtime;
    return {
      runtime: elementalRuntime,
      outcome: {
        kind: effect.kind,
        targetId: target.id,
        hit,
        critical: natural === 20,
        damage: amount.total,
        cover: position.cover.level,
        height: position.height.label,
      },
    };
  }

  if (effect.kind === "save") {
    const modifier = await savingThrowModifier(
      context.campaignId,
      target,
      effect.ability,
    );
    const roll = rollDice(`1d20${signedModifier(modifier)}`);
    const resolved = resolveSavingThrow({
      roll: keptD20(roll),
      modifier,
      dc: effect.dc,
    });
    await publishEffectRoll(context, roll, `${ability.name}: Rettungswurf`);
    await publishEvent(context.sessionId, "saving_throw_resolved", {
      tokenId: target.id,
      ability: effect.ability,
      dc: effect.dc,
      total: resolved.total,
      success: resolved.success,
      sourceAbilityId: ability.id,
    });
    const rolledDamage =
      effect.damage === undefined
        ? { total: 0, roll: null }
        : rollEffectAmount(effect.damage, false);
    const damage = resolved.success
      ? effect.halfDamageOnSuccess
        ? Math.floor(rolledDamage.total / 2)
        : 0
      : rolledDamage.total;
    if (rolledDamage.roll) {
      await publishEffectRoll(
        context,
        rolledDamage.roll,
        `${ability.name}: Schaden`,
      );
    }
    if (damage > 0) {
      await applyDamageToToken(
        context,
        target,
        damage,
        effect.damageType ?? "untyped",
      );
    }
    const elementalRuntime =
      damage > 0
        ? await applyElementalSurfaceEffect(
            context,
            input.runtime,
            grid,
            target,
            effect.damageType ?? "untyped",
          )
        : input.runtime;
    return {
      runtime: elementalRuntime,
      outcome: {
        kind: effect.kind,
        targetId: target.id,
        success: resolved.success,
        damage,
      },
    };
  }

  const amount = rollEffectAmount(effect.amount, false);
  if (amount.roll) {
    await publishEffectRoll(context, amount.roll, `${ability.name}: Schaden`);
  }
  await applyDamageToToken(context, target, amount.total, effect.damageType);
  const elementalRuntime = await applyElementalSurfaceEffect(
    context,
    input.runtime,
    grid,
    target,
    effect.damageType,
  );
  return {
    runtime: elementalRuntime,
    outcome: { kind: effect.kind, targetId: target.id, damage: amount.total },
  };
}

function rollEffectAmount(amount: number | string, critical: boolean) {
  if (typeof amount === "number")
    return { total: Math.max(0, amount), roll: null };
  const notation = critical ? criticalDamageNotation(amount) : amount;
  const roll = rollDice(notation);
  return { total: Math.max(0, roll.total), roll };
}

async function publishEffectRoll(
  context: CombatContext,
  roll: DiceResult,
  reason: string,
) {
  await publishEvent(
    context.sessionId,
    "dice_roll",
    {
      notation: roll.notation,
      total: roll.total,
      breakdown: roll.breakdown,
      rolls: roll.rolls,
      reason,
      actor: context.activeToken.team === "player" ? "player" : "dm",
      displayName: context.activeToken.name ?? context.activeToken.id,
      characterId:
        context.activeToken.team === "player"
          ? context.activeToken.id
          : undefined,
    },
    { actorId: context.access.userId },
  );
}

async function applyDamageToToken(
  context: CombatContext,
  target: CombatToken,
  amount: number,
  damageType: string,
  options: { critical?: boolean; actorId?: string | null } = {},
) {
  const before = await combatantStateForToken(context.campaignId, target);
  const result = applyDamage(before, amount, options);
  let finalState = result.state;
  let concentrationTransition = result.concentrationTransition;
  if (
    target.team === "player" &&
    result.concentrationCheckRequired &&
    result.concentrationDc !== null &&
    result.state.lifeState === "active"
  ) {
    const modifier = await savingThrowModifier(
      context.campaignId,
      target,
      "con",
    );
    const roll = rollDice(`1d20${signedModifier(modifier)}`);
    const concentration = resolveConcentrationCheck(result.state, {
      damage: amount,
      roll: keptD20(roll),
      constitutionSaveModifier: modifier,
    });
    finalState = concentration.state;
    concentrationTransition = concentration.transition;
    await publishEvent(context.sessionId, "dice_roll", {
      notation: roll.notation,
      total: roll.total,
      breakdown: roll.breakdown,
      rolls: roll.rolls,
      reason: `Konzentration · SG ${concentration.dc}`,
      actor: "player",
      displayName: target.name ?? target.id,
      characterId: target.id,
    });
    await publishEvent(context.sessionId, "saving_throw_resolved", {
      tokenId: target.id,
      ability: "con",
      dc: concentration.dc,
      total: concentration.total,
      success: concentration.success,
      reason: "concentration",
    });
  }
  if (target.team === "player") {
    await persistPlayerCombatant(context.campaignId, finalState);
  }
  await publishEvent(
    context.sessionId,
    "damage_applied",
    {
      targetId: target.id,
      amount,
      type: damageType,
      sourceTokenId: context.activeToken.id,
      sourceName: context.activeToken.name ?? context.activeToken.id,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    },
    {
      actorId:
        options.actorId !== undefined ? options.actorId : context.access.userId,
    },
  );
  if (
    target.team === "player" &&
    before.lifeState === "active" &&
    finalState.lifeState === "downed"
  ) {
    await publishEvent(context.sessionId, "character_down", {
      encounterId: context.encounter.id,
      characterId: target.id,
      tokenId: target.id,
      tokenName: target.name ?? target.id,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    });
  }
  if (
    target.team === "player" &&
    finalState.lifeState === "dead" &&
    before.lifeState !== "dead"
  ) {
    await publishEvent(context.sessionId, "character_dead", {
      encounterId: context.encounter.id,
      characterId: target.id,
      tokenId: target.id,
      tokenName: target.name ?? target.id,
      reason: "massive_damage_or_failed_saves",
    });
  }
  if (concentrationTransition) {
    await publishEvent(context.sessionId, "concentration_changed", {
      characterId: target.id,
      tokenId: target.id,
      active: false,
      reason: concentrationTransition.reason,
    });
  }
  return { ...result, state: finalState, concentrationTransition };
}

async function applyElementalSurfaceEffect(
  context: CombatContext,
  runtime: EncounterRuntime,
  grid: TacticalGrid,
  target: CombatToken,
  damageType: string,
) {
  const normalized = damageType.trim().toLowerCase();
  const surfaceType =
    normalized === "fire"
      ? "fire"
      : normalized === "cold" || normalized === "ice"
        ? "ice"
        : normalized === "lightning"
          ? "lightning"
          : null;
  if (!surfaceType) return runtime;
  const currentGrid = {
    ...grid,
    surfaces: runtime.surfaces as TacticalGrid["surfaces"],
  };
  const applied = applySurface(currentGrid, {
    x: target.x,
    y: target.y,
    type: surfaceType,
    intensity: 1,
    duration: 2,
    sourceId: context.activeToken.id,
  });
  const next = { ...runtime, surfaces: applied.grid.surfaces };
  await publishEvent(context.sessionId, "surface_changed", {
    x: target.x,
    y: target.y,
    ...(applied.transform.surface
      ? { surface: applied.transform.surface }
      : { surface: { x: target.x, y: target.y, removed: true } }),
    transform: applied.transform.kind,
    sourceTokenId: context.activeToken.id,
    sourceDamageType: damageType,
  });
  return next;
}

function tacticalDistance(a: CombatToken, b: CombatToken) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function lifeStateForToken(token: CombatToken): CombatantState["lifeState"] {
  return tokenHp(token) > 0
    ? "active"
    : token.team === "player"
      ? "downed"
      : "dead";
}

function statusArmorBonus(runtime: EncounterRuntime, tokenId: string) {
  return (runtime.statuses[tokenId] ?? []).reduce((total, raw) => {
    const modifiers = recordPayload(raw.modifiers);
    return total + integerOr(modifiers.armorClass, 0);
  }, 0);
}

function movementSpentForToken(
  events: CombatContext["actionEvents"],
  tokenId: string,
  round: number,
  turnIndex: number,
) {
  return events.reduce((total, event) => {
    const raw = event as unknown as Record<string, unknown>;
    if (
      raw.tokenId !== tokenId ||
      raw.round !== round ||
      raw.turnIndex !== turnIndex
    ) {
      return total;
    }
    return total + Math.max(0, integerOr(raw.movementCost, 0));
  }, 0);
}

async function savingThrowModifier(
  campaignId: string,
  token: CombatToken,
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha",
) {
  const entity =
    token.team === "player"
      ? await prisma.character.findFirst({
          where: { id: token.id, campaignId },
          select: { sheet: true },
        })
      : await prisma.nPC.findFirst({
          where: { id: token.id, campaignId },
          select: { sheet: true },
        });
  const sheet = recordPayload(entity?.sheet);
  const scores = recordPayload(sheet.abilities);
  const explicit = recordPayload(sheet.savingThrows);
  return integerOr(
    explicit[ability],
    abilityMod(integerOr(scores[ability], 10)),
  );
}

async function combatantStateForToken(
  campaignId: string,
  token: CombatToken,
): Promise<CombatantState> {
  let sheet: Record<string, unknown> = {};
  let runtime: Record<string, unknown> = {};
  if (token.team === "player") {
    const character = await prisma.character.findFirst({
      where: { id: token.id, campaignId },
      select: { sheet: true, runtime: true },
    });
    sheet = recordPayload(character?.sheet);
    runtime = recordPayload(character?.runtime);
  }
  const combat = recordPayload(runtime.combat);
  const deathSaves = recordPayload(combat.deathSaves);
  const hpCurrent = tokenHp(token);
  const storedLifeState = combat.lifeState;
  const lifeState: CombatantState["lifeState"] =
    hpCurrent > 0
      ? "active"
      : storedLifeState === "stable" || storedLifeState === "dead"
        ? storedLifeState
        : token.team === "player"
          ? "downed"
          : "dead";
  return {
    id: token.id,
    team: token.team ?? "monster",
    hpCurrent,
    hpMax: Math.max(
      1,
      integerOr(token.maxHp, integerOr(sheet.hpMax, Math.max(1, hpCurrent))),
    ),
    temporaryHp: Math.max(0, integerOr(combat.temporaryHp, 0)),
    lifeState,
    deathSaves: {
      successes: Math.max(0, Math.min(3, integerOr(deathSaves.successes, 0))),
      failures: Math.max(0, Math.min(3, integerOr(deathSaves.failures, 0))),
    },
    statuses: normalizeStatusInstances(combat.statuses),
    concentration: normalizeConcentration(combat.concentration),
  };
}

function normalizeStatusInstances(value: unknown): StatusInstance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const status = recordPayload(raw);
    if (typeof status.id !== "string" || !status.id.trim()) return [];
    return [
      {
        id: status.id,
        ...(typeof status.sourceAbilityId === "string"
          ? { sourceAbilityId: status.sourceAbilityId }
          : {}),
        ...(typeof status.durationRounds === "number"
          ? { durationRounds: Math.max(0, Math.floor(status.durationRounds)) }
          : {}),
        ...(status.modifiers && typeof status.modifiers === "object"
          ? { modifiers: status.modifiers as StatusInstance["modifiers"] }
          : {}),
      },
    ];
  });
}

function normalizeConcentration(
  value: unknown,
): CombatantState["concentration"] {
  const concentration = recordPayload(value);
  if (typeof concentration.abilityId !== "string") return null;
  return {
    abilityId: concentration.abilityId,
    ...(typeof concentration.sourceId === "string"
      ? { sourceId: concentration.sourceId }
      : {}),
    ...(typeof concentration.startedRound === "number"
      ? { startedRound: Math.floor(concentration.startedRound) }
      : {}),
    ...(typeof concentration.startedTurn === "number"
      ? { startedTurn: Math.floor(concentration.startedTurn) }
      : {}),
  };
}

async function persistPlayerCombatant(
  campaignId: string,
  state: CombatantState,
) {
  const character = await prisma.character.findFirst({
    where: { id: state.id, campaignId },
    select: { runtime: true },
  });
  if (!character) return;
  const runtime = recordPayload(character.runtime);
  await prisma.character.update({
    where: { id: state.id },
    data: {
      runtime: {
        ...runtime,
        combat: {
          lifeState: state.lifeState,
          deathSaves: state.deathSaves,
          temporaryHp: state.temporaryHp,
          statuses: state.statuses,
          concentration: state.concentration,
        },
      } as never,
    },
  });
}

async function resolvePlayerDeathSave(context: CombatContext) {
  if (
    context.activeToken.team !== "player" ||
    tokenHp(context.activeToken) > 0
  ) {
    return NextResponse.json(
      { error: "death_save_not_available" },
      { status: 409 },
    );
  }
  const before = await combatantStateForToken(
    context.campaignId,
    context.activeToken,
  );
  if (before.lifeState !== "downed") {
    return NextResponse.json(
      { error: `character_${before.lifeState}` },
      { status: 409 },
    );
  }
  const roll = rollDice("1d20");
  const resolved = resolveDeathSave(before, keptD20(roll));
  await persistPlayerCombatant(context.campaignId, resolved.state);
  await publishEffectRoll(context, roll, "Todesrettungswurf");
  await publishEvent(context.sessionId, "death_save_updated", {
    characterId: context.activeToken.id,
    tokenId: context.activeToken.id,
    tokenName: context.activeToken.name ?? context.activeToken.id,
    roll: resolved.roll,
    outcome: resolved.outcome,
    successes: resolved.state.deathSaves.successes,
    failures: resolved.state.deathSaves.failures,
    lifeState: resolved.state.lifeState,
  });
  if (resolved.outcome === "stabilized") {
    await publishEvent(context.sessionId, "character_stabilized", {
      characterId: context.activeToken.id,
      tokenId: context.activeToken.id,
      tokenName: context.activeToken.name ?? context.activeToken.id,
    });
  }
  if (resolved.outcome === "revived") {
    await publishEvent(context.sessionId, "character_revived", {
      characterId: context.activeToken.id,
      tokenId: context.activeToken.id,
      tokenName: context.activeToken.name ?? context.activeToken.id,
      hp: resolved.state.hpCurrent,
    });
    await publishEvent(context.sessionId, "healing_applied", {
      targetId: context.activeToken.id,
      amount: resolved.state.hpCurrent,
      sourceName: "Todesrettungswurf",
    });
  }
  if (resolved.outcome === "dead") {
    await publishEvent(context.sessionId, "character_dead", {
      encounterId: context.encounter.id,
      characterId: context.activeToken.id,
      tokenId: context.activeToken.id,
      tokenName: context.activeToken.name ?? context.activeToken.id,
      reason: "failed_death_saves",
    });
  }
  await markActionUsed(context, { actionType: "death_save" });
  const turn = await endTurn(context);
  return NextResponse.json({
    ...turn,
    action: "death_save",
    outcome: resolved.outcome,
    successes: resolved.state.deathSaves.successes,
    failures: resolved.state.deathSaves.failures,
  });
}

async function hideCombatant(context: CombatContext) {
  const grid = await tacticalGridForContext(context);
  const stealthModifier = await skillModifierForToken(
    context.campaignId,
    context.activeToken,
    "stealth",
    "dex",
  );
  const roll = rollDice(`1d20${signedModifier(stealthModifier)}`);
  const stealth = roll.total;
  const observers = context.tokens.filter(
    (token) => areHostile(context.activeToken, token) && tokenHp(token) > 0,
  );
  const visibility = { ...context.encounterRuntime.visibility };
  const revealedBy: string[] = [];
  for (const observer of observers) {
    const observerScore =
      10 +
      (await skillModifierForToken(
        context.campaignId,
        observer,
        "perception",
        "wis",
      ));
    const result = visibilityBetween(
      grid,
      {
        id: observer.id,
        position: observer,
        team: observer.team,
        hidden: false,
        stealth: 0,
        perception: observerScore,
      },
      {
        id: context.activeToken.id,
        position: context.activeToken,
        team: context.activeToken.team,
        hidden: true,
        stealth,
        perception: 0,
      },
    );
    visibility[observer.id] = {
      ...(visibility[observer.id] ?? {}),
      [context.activeToken.id]: result.visible,
    };
    if (result.visible) revealedBy.push(observer.id);
  }
  const hidden = revealedBy.length === 0;
  const runtime = {
    ...context.encounterRuntime,
    visibility,
    statuses: {
      ...context.encounterRuntime.statuses,
      [context.activeToken.id]: hidden
        ? [
            ...(
              context.encounterRuntime.statuses[context.activeToken.id] ?? []
            ).filter((status) => status.id !== "hidden"),
            { id: "hidden", sourceAbilityId: "core:hide", durationRounds: 1 },
          ]
        : (
            context.encounterRuntime.statuses[context.activeToken.id] ?? []
          ).filter((status) => status.id !== "hidden"),
    },
  };
  await markActionUsed(context, { actionType: "hide" });
  await publishEffectRoll(context, roll, "Verbergen");
  await persistEncounterRuntime(context.encounter.id, runtime);
  await publishEvent(context.sessionId, "stealth_changed", {
    tokenId: context.activeToken.id,
    hidden,
    revealedBy,
  });
  await publishEvent(
    context.sessionId,
    "private_clue",
    {
      characterId: context.activeToken.id,
      title: hidden ? "Unentdeckt" : "Beobachtet",
      text: hidden
        ? "Kein sichtbarer Gegner hat dein Versteck durchschaut."
        : `${revealedBy.length} Gegner haben dich entdeckt.`,
    },
    { scope: `character:${context.activeToken.id}` },
  );
  return NextResponse.json({ ok: true, action: "hide", hidden, revealedBy });
}

async function shoveCombatant(context: CombatContext, action: CombatAction) {
  const target = context.tokens.find(
    (candidate) => candidate.id === action.targetTokenId,
  );
  if (
    !target ||
    !areHostile(context.activeToken, target) ||
    tokenHp(target) <= 0
  ) {
    return NextResponse.json({ error: "invalid_target" }, { status: 422 });
  }
  const grid = await tacticalGridForContext(context);
  const sourceModifier = await skillModifierForToken(
    context.campaignId,
    context.activeToken,
    "athletics",
    "str",
  );
  const targetModifier = Math.max(
    await skillModifierForToken(context.campaignId, target, "athletics", "str"),
    await skillModifierForToken(
      context.campaignId,
      target,
      "acrobatics",
      "dex",
    ),
  );
  const sourceRoll = rollDice(`1d20${signedModifier(sourceModifier)}`);
  const targetRoll = rollDice(`1d20${signedModifier(targetModifier)}`);
  const result = resolveShove(grid, {
    source: context.activeToken,
    target,
    distance: 2,
    force: sourceRoll.total,
    resistance: targetRoll.total,
    occupied: context.tokens
      .filter((token) => token.id !== target.id && tokenHp(token) > 0)
      .map((token) => ({ x: token.x, y: token.y })),
  });
  await markActionUsed(context, { actionType: "shove" });
  await publishEffectRoll(context, sourceRoll, "Stoßen: Athletik");
  await publishEffectRoll(context, targetRoll, "Stoßen: Widerstand");
  if (!result.ok) {
    return NextResponse.json({
      ok: true,
      action: "shove",
      success: false,
      reason: result.code,
    });
  }
  await publishEvent(context.sessionId, "token_forced_moved", {
    tokenId: target.id,
    fromX: target.x,
    fromY: target.y,
    x: result.destination.x,
    y: result.destination.y,
    path: result.path,
    distance: result.distanceMoved,
    collision: result.collision,
    sourceTokenId: context.activeToken.id,
  });
  if (result.fall.damage > 0) {
    await applyDamageToToken(
      context,
      target,
      result.fall.damage,
      "bludgeoning",
    );
  }
  return NextResponse.json({
    ok: true,
    action: "shove",
    success: result.distanceMoved > 0,
    destination: result.destination,
    fallDamage: result.fall.damage,
  });
}

async function interactWithEncounterObject(
  context: CombatContext,
  action: CombatAction,
) {
  if (!action.objectId) {
    return NextResponse.json({ error: "object_required" }, { status: 400 });
  }
  const grid = await tacticalGridForContext(context);
  const object = grid.objects.find(
    (candidate) => candidate.id === action.objectId,
  );
  if (!object || tacticalDistance(context.activeToken, object) > 1) {
    return NextResponse.json(
      { error: object ? "object_out_of_range" : "object_not_found" },
      { status: object ? 422 : 404 },
    );
  }
  const objectAction = (action.objectAction ??
    "toggle") as TacticalObjectAction;
  const check = objectAction === "disarm" ? rollDice("1d20") : null;
  const result = interactWithObject(grid, {
    objectId: action.objectId,
    action: objectAction,
    amount: objectAction === "damage" ? 5 : undefined,
    damageType: objectAction === "damage" ? "bludgeoning" : undefined,
    checkTotal: check?.total,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, reason: result.reason },
      { status: 422 },
    );
  }
  await markActionUsed(context, { actionType: `interact:${objectAction}` });
  if (check)
    await publishEffectRoll(context, check, `Interaktion: ${object.name}`);
  const runtime = {
    ...context.encounterRuntime,
    objects: result.grid.objects,
    surfaces: result.grid.surfaces,
  };
  await persistEncounterRuntime(context.encounter.id, runtime);
  for (const event of result.events) {
    await publishEvent(context.sessionId, "object_changed", {
      ...event,
      object: result.object,
      actorTokenId: context.activeToken.id,
    });
    if (event.damage && event.damage > 0 && event.type === "trap_triggered") {
      await applyDamageToToken(
        context,
        context.activeToken,
        event.damage,
        event.damageType ?? "piercing",
      );
    }
  }
  if (result.grid.surfaces !== grid.surfaces) {
    await publishEvent(context.sessionId, "surface_changed", {
      surfaces: result.grid.surfaces,
      sourceObjectId: action.objectId,
    });
  }
  return NextResponse.json({
    ok: true,
    action: "interact",
    object: result.object,
    outcome: result.outcome,
  });
}

async function skillModifierForToken(
  campaignId: string,
  token: CombatToken,
  skill: string,
  ability: "str" | "dex" | "wis",
) {
  const entity =
    token.team === "player"
      ? await prisma.character.findFirst({
          where: { id: token.id, campaignId },
          select: { sheet: true },
        })
      : await prisma.nPC.findFirst({
          where: { id: token.id, campaignId },
          select: { sheet: true },
        });
  const sheet = recordPayload(entity?.sheet);
  const skills = recordPayload(sheet.skills);
  if (typeof skills[skill] === "number")
    return Math.floor(skills[skill] as number);
  const scores = recordPayload(sheet.abilities);
  return abilityMod(integerOr(scores[ability], 10));
}

async function markActionUsed(
  context: CombatContext,
  input: {
    actionType: string;
    movementBonus?: number;
    resource?: "action" | "bonusAction" | "reaction";
  },
) {
  await publishEvent(
    context.sessionId,
    "combat_action_used",
    {
      encounterId: context.encounter.id,
      tokenId: context.activeToken.id,
      tokenName: context.activeToken.name ?? context.activeToken.id,
      actionType: input.actionType,
      resource: input.resource ?? "action",
      movementBonus: input.movementBonus ?? 0,
      requestId: context.requestId,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    },
    { actorId: context.access.userId },
  );
}

async function existingMutationEvent(
  sessionId: string,
  requestId: string | undefined,
  types: string[],
) {
  if (!requestId) return null;
  return prisma.eventLog.findFirst({
    where: {
      sessionId,
      type: { in: types },
      payload: { path: ["requestId"], equals: requestId },
    },
    orderBy: [{ ts: "desc" }, { id: "desc" }],
    select: { id: true, type: true },
  });
}

async function publishAttack(
  context: CombatContext,
  input: {
    actor: CombatToken;
    target: CombatToken;
    actorId: string | null;
    targetAcBonus?: number;
    attackRollModifier?: number;
  },
) {
  const stats = await attackStatsForToken(context.campaignId, input.actor);
  const targetDodging = isDodging({
    tokenId: input.target.id,
    events: context.actionEvents,
    round: context.encounter.round,
    turnIndex: context.encounter.activeTurn,
  });
  const attackNotation = `1d20${targetDodging ? "dis" : ""}${signedModifier(
    stats.attackBonus + (input.attackRollModifier ?? 0),
  )}`;
  const attackRoll = rollDice(attackNotation);
  const natural = keptD20(attackRoll);
  const critical = natural === 20;
  const automaticMiss = natural === 1;
  const targetAc =
    tokenAc(input.target) + Math.max(0, input.targetAcBonus ?? 0);
  const hit = critical || (!automaticMiss && attackRoll.total >= targetAc);
  const damageNotation = critical
    ? criticalDamageNotation(stats.damageDice)
    : stats.damageDice;
  const damageRoll = hit ? rollDice(damageNotation) : null;
  const damage = damageRoll?.total ?? 0;

  await publishEvent(
    context.sessionId,
    "dice_roll",
    {
      notation: attackNotation,
      total: attackRoll.total,
      breakdown: attackRoll.breakdown,
      rolls: attackRoll.rolls,
      reason: `Angriff: ${input.actor.name ?? input.actor.id} -> ${
        input.target.name ?? input.target.id
      }`,
      actor: input.actor.team === "player" ? "player" : "dm",
      displayName: input.actor.name ?? input.actor.id,
      characterId: input.actor.team === "player" ? input.actor.id : undefined,
    },
    { actorId: input.actorId },
  );

  if (damageRoll) {
    await publishEvent(
      context.sessionId,
      "dice_roll",
      {
        notation: damageNotation,
        total: damageRoll.total,
        breakdown: damageRoll.breakdown,
        rolls: damageRoll.rolls,
        reason: `Schaden: ${input.target.name ?? input.target.id}`,
        actor: input.actor.team === "player" ? "player" : "dm",
        displayName: input.actor.name ?? input.actor.id,
        characterId: input.actor.team === "player" ? input.actor.id : undefined,
      },
      { actorId: input.actorId },
    );
  }

  await publishEvent(
    context.sessionId,
    "attack_resolved",
    {
      encounterId: context.encounter.id,
      actorTokenId: input.actor.id,
      actorName: input.actor.name ?? input.actor.id,
      targetTokenId: input.target.id,
      targetName: input.target.name ?? input.target.id,
      attackTotal: attackRoll.total,
      attackBreakdown: attackRoll.breakdown,
      targetAc,
      hit,
      critical,
      disadvantage: targetDodging,
      positionModifier: input.attackRollModifier ?? 0,
      damage,
      damageType: stats.damageType,
      damageBreakdown: damageRoll?.breakdown ?? null,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    },
    { actorId: input.actorId },
  );

  if (damage > 0) {
    await applyDamageToToken(context, input.target, damage, stats.damageType, {
      critical,
      actorId: input.actorId,
    });
  }

  return { hit, critical, damage, targetTokenId: input.target.id };
}

async function endTurn(context: CombatContext) {
  await publishEvent(
    context.sessionId,
    "combat_turn_ended",
    {
      encounterId: context.encounter.id,
      tokenId: context.activeToken.id,
      tokenName: context.activeToken.name ?? context.activeToken.id,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
      requestId: context.requestId,
    },
    { actorId: context.access.userId },
  );

  const grid = await movementGridForSession({
    sessionId: context.sessionId,
    campaignId: context.campaignId,
    locationId: context.encounter.locationId,
  });

  let turnTokens = context.tokens;
  const tacticalGrid = normalizeTacticalGrid({
    ...grid,
    surfaces: context.encounterRuntime.surfaces,
    objects: context.encounterRuntime.objects,
  });
  const surface = surfaceEffectAt(
    tacticalGrid,
    context.activeToken,
    "end-turn",
  );
  if (surface.damage > 0) {
    await applyDamageToToken(
      context,
      context.activeToken,
      surface.damage,
      surface.damageType ?? "untyped",
    );
    turnTokens = applyProjectedDamage(turnTokens, {
      targetTokenId: context.activeToken.id,
      damage: surface.damage,
    });
  }
  if (surface.conditions.length > 0) {
    const runtime = {
      ...context.encounterRuntime,
      statuses: {
        ...context.encounterRuntime.statuses,
        [context.activeToken.id]: [
          ...(context.encounterRuntime.statuses[context.activeToken.id] ?? []),
          ...surface.conditions.map((id) => ({
            id,
            sourceAbilityId: "surface",
            durationRounds: 1,
          })),
        ],
      },
    };
    context.encounterRuntime = runtime;
    await persistEncounterRuntime(context.encounter.id, runtime);
    for (const condition of surface.conditions) {
      await publishEvent(context.sessionId, "status_updated", {
        tokenId: context.activeToken.id,
        status: condition,
        active: true,
        durationRounds: 1,
        source: "surface",
      });
    }
  }

  const ended = await maybeEndCombat({
    sessionId: context.sessionId,
    encounterId: context.encounter.id,
    tokens: turnTokens,
  });
  if (ended) return { ok: true, action: "end_turn", combatEnded: true };

  if (context.turnGroup?.team === "player") {
    const runtime = withCompletedTurnMember(context.encounterRuntime, {
      round: context.encounter.round,
      startIndex: context.turnGroup.startIndex,
      tokenId: context.activeToken.id,
    });
    const remaining = remainingGroupTokenIds(
      context.turnGroup,
      runtime.turnGroup?.completedTokenIds ?? [],
    );
    await persistEncounterRuntime(context.encounter.id, runtime);
    await publishEvent(context.sessionId, "turn_member_completed", {
      encounterId: context.encounter.id,
      tokenId: context.activeToken.id,
      groupTokenIds: context.turnGroup.tokenIds,
      remainingTokenIds: remaining,
      round: context.encounter.round,
    });
    if (remaining.length > 0) {
      await publishEvent(context.sessionId, "turn_group_set", {
        encounterId: context.encounter.id,
        team: context.turnGroup.team,
        tokenIds: context.turnGroup.tokenIds,
        completedTokenIds: runtime.turnGroup?.completedTokenIds ?? [],
        round: context.encounter.round,
        startIndex: context.turnGroup.startIndex,
        endIndex: context.turnGroup.endIndex,
      });
      return {
        ok: true,
        action: "end_turn",
        combatEnded: false,
        active: remaining[0] ?? null,
      };
    }
    context.encounter.activeTurn = context.turnGroup.endIndex;
    context.encounterRuntime = { ...runtime, turnGroup: null };
    await persistEncounterRuntime(
      context.encounter.id,
      context.encounterRuntime,
    );
  }

  const next = await advanceUntilPlayerTurn({
    ...context,
    grid,
    tokens: turnTokens,
  });
  return {
    ok: true,
    action: "end_turn",
    combatEnded: next.combatEnded,
    active: next.activeName,
  };
}

async function advanceUntilPlayerTurn(
  input: CombatContext & {
    grid: MovementGrid;
  },
) {
  const initiative = initiativeList(input.encounter.initiative);
  let activeTurn = input.encounter.activeTurn;
  let round = input.encounter.round;
  let tokens = input.tokens;
  const maxSteps = Math.max(initiative.length * 3, 1);

  for (let step = 0; step < maxSteps; step++) {
    const next = nextLivingTurn({
      initiative,
      tokens,
      activeTurn,
      round,
    });
    if (!next) {
      await maybeEndCombat({
        sessionId: input.sessionId,
        encounterId: input.encounter.id,
        tokens,
      });
      return { combatEnded: true, activeName: null };
    }

    activeTurn = next.turnIndex;
    round = next.round;
    const activeToken = next.token;
    const startedRuntime = await setEncounterTurn({
      sessionId: input.sessionId,
      encounterId: input.encounter.id,
      turnIndex: activeTurn,
      round,
      activeToken,
    });

    if (activeToken.team === "player") {
      const group = activeTurnGroup(initiative, activeTurn, tokens);
      if (group) {
        for (const tokenId of group.tokenIds) {
          if (tokenId !== activeToken.id) {
            await advanceEncounterStatusesForToken(
              input.sessionId,
              input.encounter.id,
              tokenId,
            );
          }
        }
        await publishEvent(input.sessionId, "turn_group_set", {
          encounterId: input.encounter.id,
          team: group.team,
          tokenIds: group.tokenIds,
          completedTokenIds: [],
          round,
          startIndex: group.startIndex,
          endIndex: group.endIndex,
        });
      }
      return {
        combatEnded: false,
        activeName: activeToken.name ?? activeToken.id,
      };
    }

    const npcResult = await runNpcTurn({
      ...input,
      encounter: {
        ...input.encounter,
        activeTurn,
        round,
      },
      tokens,
      activeToken,
      grid: input.grid,
      encounterRuntime: startedRuntime,
    });
    tokens = npcResult.tokens;
    if (npcResult.paused) {
      return {
        combatEnded: false,
        activeName: activeToken.name ?? activeToken.id,
      };
    }

    const ended = await maybeEndCombat({
      sessionId: input.sessionId,
      encounterId: input.encounter.id,
      tokens,
    });
    if (ended) return { combatEnded: true, activeName: null };
  }

  return { combatEnded: false, activeName: null };
}

async function runNpcTurn(input: CombatContext & { grid: MovementGrid }) {
  let tokens = input.tokens;
  let actor = input.activeToken;
  const tacticalGrid = normalizeTacticalGrid({
    ...input.grid,
    surfaces: input.encounterRuntime.surfaces,
    objects: input.encounterRuntime.objects,
  });
  const abilities = await abilitiesForActor(input.campaignId, actor);
  const unit = (token: CombatToken): CombatAiUnit => ({
    id: token.id,
    team: token.team ?? "monster",
    position: { x: token.x, y: token.y },
    hpCurrent: tokenHp(token),
    hpMax: Math.max(1, integerOr(token.maxHp, tokenHp(token))),
    armorClass: tokenAc(token),
    lifeState: lifeStateForToken(token),
    threat: Math.max(1, integerOr(recordPayload(token).threat, 1)),
  });
  const decision = chooseCombatAiAction({
    actor: unit(actor),
    allies: tokens
      .filter((token) => token.id !== actor.id && !areHostile(actor, token))
      .map(unit),
    enemies: tokens.filter((token) => areHostile(actor, token)).map(unit),
    abilities,
    turnResources: createTurnResources({
      action: 1,
      bonusAction: 1,
      reaction: 1,
      movement: tokenMovement(actor),
    }),
    grid: tacticalGrid,
    movementBudget: tokenMovement(actor),
    seed: `${input.encounter.id}:${input.encounter.round}:${input.encounter.activeTurn}`,
  });
  const intent = combatAiIntentPayload(actor.id, decision);
  await publishEvent(input.sessionId, "ai_intent", {
    encounterId: input.encounter.id,
    tokenId: actor.id,
    actorName: actor.name ?? actor.id,
    label: aiIntentLabel(decision.intent, actor.name ?? actor.id),
    targetTokenId:
      decision.kind === "ability" ? decision.targetIds[0] : undefined,
    ...intent,
  });

  if (decision.kind === "interact") {
    const interaction = interactWithObject(tacticalGrid, {
      objectId: decision.objectId,
      action: decision.action,
      checkTotal: 15,
    });
    if (interaction.ok) {
      const runtime = {
        ...input.encounterRuntime,
        objects: interaction.grid.objects,
        surfaces: interaction.grid.surfaces,
      };
      await persistEncounterRuntime(input.encounter.id, runtime);
      for (const event of interaction.events) {
        await publishEvent(input.sessionId, "object_changed", {
          ...event,
          object: interaction.object,
          actorTokenId: actor.id,
        });
      }
      await publishEvent(input.sessionId, "combat_action_used", {
        encounterId: input.encounter.id,
        tokenId: actor.id,
        tokenName: actor.name ?? actor.id,
        actionType: `interact:${decision.action}`,
        resource: "action",
        round: input.encounter.round,
        turnIndex: input.encounter.activeTurn,
      });
      await publishEvent(input.sessionId, "combat_turn_ended", {
        encounterId: input.encounter.id,
        tokenId: actor.id,
        tokenName: actor.name ?? actor.id,
        round: input.encounter.round,
        turnIndex: input.encounter.activeTurn,
        automated: true,
      });
      return { tokens, paused: false };
    }
  }

  if (decision.kind === "ability" && decision.abilityId !== "core:attack") {
    const spentResources = combatResourcesForTurn(input.actionEvents, {
      tokenId: actor.id,
      round: input.encounter.round,
      turnIndex: input.encounter.activeTurn,
    });
    const abilityResponse = await executeCombatAbility(
      { ...input, activeToken: actor },
      {
        type: "use_ability",
        actorTokenId: actor.id,
        abilityId: decision.abilityId,
        targetTokenId: decision.targetIds[0],
        requestId: `ai:${input.encounter.id}:${input.encounter.round}:${input.encounter.activeTurn}`,
      },
      spentResources,
    );
    if (abilityResponse.ok) {
      const refreshed = await activeCombatStateForSession(input.sessionId);
      tokens = refreshed?.tokens ?? tokens;
      await publishEvent(input.sessionId, "combat_turn_ended", {
        encounterId: input.encounter.id,
        tokenId: actor.id,
        tokenName: actor.name ?? actor.id,
        round: input.encounter.round,
        turnIndex: input.encounter.activeTurn,
        automated: true,
      });
      return { tokens, paused: false };
    }
  }

  if (decision.kind === "end-turn") {
    await publishEvent(input.sessionId, "combat_turn_ended", {
      encounterId: input.encounter.id,
      tokenId: actor.id,
      tokenName: actor.name ?? actor.id,
      round: input.encounter.round,
      turnIndex: input.encounter.activeTurn,
      automated: true,
    });
    return { tokens, paused: false };
  }

  const preferredTargetId =
    decision.kind === "ability" ? decision.targetIds[0] : null;
  const target =
    (preferredTargetId
      ? tokens.find(
          (token) =>
            token.id === preferredTargetId &&
            areHostile(actor, token) &&
            tokenHp(token) > 0,
        )
      : null) ?? nearestLivingEnemy(actor, tokens);
  if (!target) return { tokens };

  if (
    distance(actor, target) > attackRange(actor) ||
    decision.kind === "move"
  ) {
    const destination =
      decision.kind === "move"
        ? {
            x: decision.destination.x,
            y: decision.destination.y,
            cost: decision.movementCost,
          }
        : bestMoveTowardTarget({
            actor,
            target,
            tokens,
            grid: input.grid,
          });
    if (destination) {
      const movement = tokenMovement(actor);
      await publishEvent(input.sessionId, "token_moved", {
        mode: "combat",
        tokenId: actor.id,
        fromX: actor.x,
        fromY: actor.y,
        x: destination.x,
        y: destination.y,
        movementCost: destination.cost,
        movement,
        movementSpent: destination.cost,
        movementRemaining: Math.max(0, movement - destination.cost),
        movedBy: "Combat AI",
        round: input.encounter.round,
        turnIndex: input.encounter.activeTurn,
      });
      actor = { ...actor, x: destination.x, y: destination.y };
      tokens = tokens.map((token) => (token.id === actor.id ? actor : token));
    }
  }

  const refreshedTarget =
    tokens.find((token) => token.id === target.id) ?? target;
  if (distance(actor, refreshedTarget) <= attackRange(actor)) {
    const positioning = await basicAttackPosition(
      input,
      actor,
      refreshedTarget,
    );
    if (!positioning.visible || positioning.attackRollModifier === null) {
      await publishEvent(input.sessionId, "ai_intent", {
        encounterId: input.encounter.id,
        tokenId: actor.id,
        actorName: actor.name ?? actor.id,
        label: "Kein freies Schussfeld",
        intent: "reposition",
        targetTokenId: refreshedTarget.id,
      });
    } else if (refreshedTarget.team === "player") {
      const reaction = {
        id: `reaction:${input.encounter.id}:${input.encounter.round}:${input.encounter.activeTurn}:${refreshedTarget.id}`,
        trigger: "attack" as const,
        reactorTokenId: refreshedTarget.id,
        sourceTokenId: actor.id,
        options: ["core:guard", "pass"],
        pendingCommand: {
          kind: "npc_attack",
          actorTokenId: actor.id,
          targetTokenId: refreshedTarget.id,
          attackRollModifier: positioning.attackRollModifier,
          round: input.encounter.round,
          turnIndex: input.encounter.activeTurn,
        },
        openedAt: Date.now(),
        expiresAt: Date.now() + 8_000,
      };
      const runtime = { ...input.encounterRuntime, reaction };
      await persistEncounterRuntime(input.encounter.id, runtime);
      await publishEvent(
        input.sessionId,
        "reaction_opened",
        {
          encounterId: input.encounter.id,
          ...reaction,
          sourceName: actor.name ?? actor.id,
          targetName: refreshedTarget.name ?? refreshedTarget.id,
        },
        { scope: `character:${refreshedTarget.id}` },
      );
      return { tokens, paused: true };
    } else {
      await publishEvent(input.sessionId, "combat_action_used", {
        encounterId: input.encounter.id,
        tokenId: actor.id,
        tokenName: actor.name ?? actor.id,
        actionType: "attack",
        resource: "action",
        movementBonus: 0,
        round: input.encounter.round,
        turnIndex: input.encounter.activeTurn,
      });
      const result = await publishAttack(input, {
        actor,
        target: refreshedTarget,
        actorId: null,
        attackRollModifier: positioning.attackRollModifier,
      });
      const projectedTokens = applyProjectedDamage(tokens, result);
      tokens = projectedTokens;
    }
  }

  await publishEvent(input.sessionId, "combat_turn_ended", {
    encounterId: input.encounter.id,
    tokenId: actor.id,
    tokenName: actor.name ?? actor.id,
    round: input.encounter.round,
    turnIndex: input.encounter.activeTurn,
    automated: true,
  });

  return { tokens, paused: false };
}

async function setEncounterTurn(input: {
  sessionId: string;
  encounterId: string;
  turnIndex: number;
  round: number;
  activeToken: CombatToken;
}) {
  const encounter = await prisma.encounter.findUnique({
    where: { id: input.encounterId },
    select: { runtime: true },
  });
  const runtime = normalizeEncounterRuntime(encounter?.runtime);
  const previous = normalizeStatusInstances(
    runtime.statuses[input.activeToken.id] ?? [],
  );
  const advanced = advanceStatuses(previous, 1);
  const statuses = { ...runtime.statuses };
  if (advanced.length > 0) {
    statuses[input.activeToken.id] = advanced;
  } else {
    delete statuses[input.activeToken.id];
  }
  const nextRuntime = { ...runtime, statuses };
  await prisma.encounter.update({
    where: { id: input.encounterId },
    data: {
      activeTurn: input.turnIndex,
      round: input.round,
      runtime: nextRuntime as never,
    },
  });
  const remaining = new Set(advanced.map((status) => status.id));
  for (const status of previous) {
    if (!remaining.has(status.id)) {
      await publishEvent(input.sessionId, "status_updated", {
        tokenId: input.activeToken.id,
        status: status.id,
        active: false,
      });
    }
  }
  await publishEvent(input.sessionId, "combat_turn_set", {
    encounterId: input.encounterId,
    turnIndex: input.turnIndex,
    round: input.round,
    name: input.activeToken.name ?? input.activeToken.id,
  });
  return nextRuntime;
}

async function advanceEncounterStatusesForToken(
  sessionId: string,
  encounterId: string,
  tokenId: string,
) {
  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
    select: { runtime: true },
  });
  const runtime = normalizeEncounterRuntime(encounter?.runtime);
  const previous = normalizeStatusInstances(runtime.statuses[tokenId] ?? []);
  if (previous.length === 0) return runtime;
  const advanced = advanceStatuses(previous, 1);
  const statuses = { ...runtime.statuses };
  if (advanced.length > 0) statuses[tokenId] = advanced;
  else delete statuses[tokenId];
  const nextRuntime = { ...runtime, statuses };
  await persistEncounterRuntime(encounterId, nextRuntime);
  const remaining = new Set(advanced.map((status) => status.id));
  for (const status of previous) {
    if (!remaining.has(status.id)) {
      await publishEvent(sessionId, "status_updated", {
        tokenId,
        status: status.id,
        active: false,
      });
    }
  }
  return nextRuntime;
}

async function maybeEndCombat(input: {
  sessionId: string;
  encounterId: string;
  tokens: CombatToken[];
}) {
  const playersAlive = input.tokens.some(
    (token) => token.team === "player" && tokenHp(token) > 0,
  );
  const hostilesAlive = input.tokens.some(
    (token) => token.team !== "player" && tokenHp(token) > 0,
  );
  if (playersAlive && hostilesAlive) return false;

  if (!playersAlive && hostilesAlive) {
    const playerStates = await Promise.all(
      input.tokens
        .filter((token) => token.team === "player")
        .map((token) =>
          combatantStateForTokenForSession(input.sessionId, token),
        ),
    );
    if (
      playerStates.length === 0 ||
      playerStates.some((state) => state.lifeState !== "dead")
    ) {
      return false;
    }
  }

  const outcome = playersAlive ? "victory" : "defeat";
  const closed = await prisma.encounter.updateMany({
    where: { id: input.encounterId, status: "active" },
    data: { status: "resolved" },
  });
  if (closed.count === 0) return true;

  const defeatedPlayers = input.tokens.filter(
    (token) => token.team === "player" && tokenHp(token) <= 0,
  );
  const summary =
    outcome === "victory"
      ? "Kampf beendet: Sieg."
      : "Kampf beendet: Niederlage.";
  await publishEvent(input.sessionId, "combat_ended", {
    encounterId: input.encounterId,
    outcome,
    summary,
  });

  if (outcome === "defeat") {
    await publishEvent(input.sessionId, "party_defeated", {
      encounterId: input.encounterId,
      defeatedTokenIds: defeatedPlayers.map((token) => token.id),
      defeatedNames: defeatedPlayers.map((token) => token.name ?? token.id),
      summary: "Alle Spielerfiguren sind kampfunfähig.",
    });
    await publishEvent(input.sessionId, "game_over", {
      encounterId: input.encounterId,
      outcome: "defeat",
      reason: "party_defeated",
      title: "Game Over",
      summary: "Die Gruppe wurde besiegt.",
      defeatedTokenIds: defeatedPlayers.map((token) => token.id),
      defeatedNames: defeatedPlayers.map((token) => token.name ?? token.id),
    });
    await prisma.gameSession.updateMany({
      where: { id: input.sessionId, endedAt: null },
      data: {
        endedAt: new Date(),
        summary: "Game Over: Die Gruppe wurde im Kampf besiegt.",
      },
    });
    await publishEvent(input.sessionId, "session_ended", {
      outcome: "defeat",
      reason: "party_defeated",
      summary: "Session beendet: Game Over.",
    });
  }

  schedulePendingTurnDrain(input.sessionId);

  return true;
}

function activeTokenForTurn(input: {
  initiative: unknown;
  turnIndex: number;
  tokens: CombatToken[];
}) {
  return input.tokens.find((token) =>
    isActiveTurnForToken({
      initiative: input.initiative,
      turnIndex: input.turnIndex,
      token,
    }),
  );
}

function initiativeList(initiative: unknown): Array<Record<string, unknown>> {
  return Array.isArray(initiative)
    ? initiative.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function nextLivingTurn(input: {
  initiative: Array<Record<string, unknown>>;
  tokens: CombatToken[];
  activeTurn: number;
  round: number;
}) {
  if (input.initiative.length === 0) return null;
  for (let offset = 1; offset <= input.initiative.length; offset++) {
    const rawIndex = input.activeTurn + offset;
    const turnIndex = rawIndex % input.initiative.length;
    const round = input.round + Math.floor(rawIndex / input.initiative.length);
    const token = activeTokenForTurn({
      initiative: input.initiative,
      turnIndex,
      tokens: input.tokens,
    });
    if (token && (tokenHp(token) > 0 || token.team === "player")) {
      return { turnIndex, round, token };
    }
  }
  return null;
}

function nearestLivingEnemy(actor: CombatToken, tokens: CombatToken[]) {
  return tokens
    .filter((token) => areHostile(actor, token) && tokenHp(token) > 0)
    .sort((a, b) => distance(actor, a) - distance(actor, b))[0];
}

function bestMoveTowardTarget(input: {
  actor: CombatToken;
  target: CombatToken;
  tokens: CombatToken[];
  grid: MovementGrid;
}) {
  const movementTokens = input.tokens.map((token) =>
    token.id === input.actor.id
      ? { ...token, movement: tokenMovement(token) || DEFAULT_TOKEN_MOVEMENT }
      : token,
  );
  const currentDistance = distance(input.actor, input.target);
  return movementRangeForToken(input.actor.id, movementTokens, input.grid)
    .filter((tile) => tileKey(tile) !== tileKey(input.target))
    .sort((a, b) => {
      const aDistance = distance(a, input.target);
      const bDistance = distance(b, input.target);
      return aDistance - bDistance || a.cost - b.cost;
    })
    .find((tile) => distance(tile, input.target) < currentDistance);
}

function applyProjectedDamage(
  tokens: CombatToken[],
  result: { targetTokenId: string; damage: number },
) {
  if (result.damage <= 0) return tokens;
  return tokens.map((token) =>
    token.id === result.targetTokenId
      ? { ...token, hp: Math.max(0, tokenHp(token) - result.damage) }
      : token,
  );
}

async function combatantStateForTokenForSession(
  sessionId: string,
  token: CombatToken,
) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { campaignId: true },
  });
  return combatantStateForToken(session?.campaignId ?? "", token);
}

async function attackStatsForToken(campaignId: string, token: CombatToken) {
  if (token.attackBonus != null || token.damageDice) {
    return {
      attackBonus: integerOr(token.attackBonus, 4),
      damageDice: token.damageDice || "1d6+2",
      damageType: validDamageType(token.damageType) ?? "slashing",
    };
  }

  if (token.team === "player") {
    const character = await prisma.character.findFirst({
      where: { id: token.id, campaignId },
      select: { sheet: true },
    });
    const sheet = recordPayload(character?.sheet);
    const abilities = recordPayload(sheet.abilities);
    const strMod = abilityMod(integerOr(abilities.str, 10));
    const dexMod = abilityMod(integerOr(abilities.dex, 10));
    const attackMod = Math.max(strMod, dexMod);
    const proficiency = integerOr(sheet.proficiencyBonus, 2);
    return {
      attackBonus: attackMod + proficiency,
      damageDice: `1d8${signedModifier(attackMod)}`,
      damageType: "slashing",
    };
  }

  const npc = await prisma.nPC.findFirst({
    where: { id: token.id, campaignId },
    select: { sheet: true },
  });
  const sheet = recordPayload(npc?.sheet);
  return {
    attackBonus: integerOr(sheet.attackBonus, integerOr(sheet.toHit, 4)),
    damageDice: stringOr(sheet.damageDice, stringOr(sheet.damage, "1d6+2")),
    damageType: validDamageType(sheet.damageType) ?? "slashing",
  };
}

function isDodging(input: {
  tokenId: string;
  events: CombatContext["actionEvents"];
  round: number;
  turnIndex: number;
}) {
  return input.events.some((event) => {
    if (event.tokenId !== input.tokenId || event.actionType !== "dodge") {
      return false;
    }
    if (event.round === null || event.turnIndex === null) return false;
    if (event.round === input.round) return event.turnIndex < input.turnIndex;
    if (event.round === input.round - 1)
      return event.turnIndex > input.turnIndex;
    return false;
  });
}

function tokenHp(token: CombatToken) {
  return integerOr(token.hp, 0);
}

function tokenAc(token: CombatToken) {
  return integerOr(token.ac, 10);
}

function attackRange(token: CombatToken) {
  return Math.max(1, integerOr(token.attackRange, 1));
}

function areHostile(a: CombatToken, b: CombatToken) {
  if (a.id === b.id) return false;
  return (a.team ?? "monster") !== (b.team ?? "monster");
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function keptD20(result: DiceResult) {
  return (
    result.rolls.find((roll) => roll.die === 20 && !roll.dropped)?.value ??
    result.rolls.find((roll) => roll.die === 20)?.value ??
    0
  );
}

function criticalDamageNotation(notation: string) {
  return notation.replace(/(\d*)d(\d+)/gi, (_match, count, sides) => {
    const dice = count ? Number(count) : 1;
    return `${Math.max(1, dice * 2)}d${sides}`;
  });
}

function signedModifier(value: number) {
  if (value === 0) return "";
  return value > 0 ? `+${value}` : String(value);
}

function integerOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function validDamageType(value: unknown) {
  if (typeof value !== "string") return null;
  return DAMAGE_TYPES.has(value) ? value : null;
}

function abilityMod(score: number) {
  return Math.floor((score - 10) / 2);
}

function aiIntentLabel(intent: string, actorName: string) {
  const labels: Record<string, string> = {
    attack: `${actorName} greift an`,
    control: `${actorName} bereitet Kontrolle vor`,
    heal: `${actorName} will heilen`,
    stabilize: `${actorName} schützt einen Verbündeten`,
    defend: `${actorName} geht in Deckung`,
    retreat: `${actorName} sucht einen Fluchtweg`,
    reposition: `${actorName} wechselt die Position`,
    objective: `${actorName} verfolgt das Begegnungsziel`,
    interact: `${actorName} nutzt die Umgebung`,
    "end-turn": `${actorName} hält die Position`,
  };
  return labels[intent] ?? `${actorName} handelt`;
}

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
