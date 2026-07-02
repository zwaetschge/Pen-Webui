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
import {
  activeCombatStateForSession,
  combatResourcesForTurn,
} from "./tactical-state";
import { withSessionMutation } from "./session-mutation";

const ACTION_TYPES = [
  "attack",
  "bonus_action",
  "dash",
  "dodge",
  "disengage",
  "end_turn",
  "reaction",
] as const;
const bodySchema = z.object({
  type: z.enum(ACTION_TYPES),
  targetTokenId: z.string().min(1).max(120).optional(),
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
      },
    });
    if (!encounter) {
      return NextResponse.json({ error: "no_active_combat" }, { status: 409 });
    }

    const combatState = await activeCombatStateForSession(sessionId);
    const tokens = combatState?.tokens ?? [];
    const activeToken = activeTokenForTurn({
      initiative: encounter.initiative,
      turnIndex: encounter.activeTurn,
      tokens,
    });
    if (!activeToken) {
      return NextResponse.json(
        { error: "active_token_not_found" },
        { status: 409 },
      );
    }

    if (
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
    };

    if (body.data.type === "end_turn") {
      const result = await endTurn(context);
      return NextResponse.json(result);
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

    const attack = await resolveAttack(context, body.data);
    if ("response" in attack) return attack.response;
    await markActionUsed(context, { actionType: "attack" });
    const result = await publishAttack(context, {
      actor: activeToken,
      target: attack.target,
      actorId: access.userId,
    });
    const projectedTokens = applyProjectedDamage(tokens, result);
    await publishPlayerDefeatEvents(context, tokens, projectedTokens);
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
): Promise<{ target: CombatToken } | { response: NextResponse }> {
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
  return { target };
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
  };
  combatStartedAt: Date;
  actionEvents: NonNullable<
    Awaited<ReturnType<typeof activeCombatStateForSession>>
  >["actionEvents"];
  tokens: CombatToken[];
  activeToken: CombatToken;
  access: Access;
  requestId?: string;
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
  context: Pick<
    CombatContext,
    "sessionId" | "campaignId" | "encounter" | "actionEvents"
  >,
  input: {
    actor: CombatToken;
    target: CombatToken;
    actorId: string | null;
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
    stats.attackBonus,
  )}`;
  const attackRoll = rollDice(attackNotation);
  const natural = keptD20(attackRoll);
  const critical = natural === 20;
  const automaticMiss = natural === 1;
  const targetAc = tokenAc(input.target);
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
      damage,
      damageType: stats.damageType,
      damageBreakdown: damageRoll?.breakdown ?? null,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    },
    { actorId: input.actorId },
  );

  if (damage > 0) {
    await publishEvent(
      context.sessionId,
      "damage_applied",
      {
        targetId: input.target.id,
        amount: damage,
        type: stats.damageType,
        sourceTokenId: input.actor.id,
        sourceName: input.actor.name ?? input.actor.id,
        round: context.encounter.round,
        turnIndex: context.encounter.activeTurn,
      },
      { actorId: input.actorId },
    );
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

  const ended = await maybeEndCombat({
    sessionId: context.sessionId,
    encounterId: context.encounter.id,
    tokens: context.tokens,
  });
  if (ended) return { ok: true, action: "end_turn", combatEnded: true };

  const next = await advanceUntilPlayerTurn({
    ...context,
    grid,
    tokens: context.tokens,
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
    await setEncounterTurn({
      sessionId: input.sessionId,
      encounterId: input.encounter.id,
      turnIndex: activeTurn,
      round,
      activeToken,
    });

    if (activeToken.team === "player") {
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
    });
    tokens = npcResult.tokens;

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
  const target = nearestLivingEnemy(actor, tokens);
  if (!target) return { tokens };

  if (distance(actor, target) > attackRange(actor)) {
    const destination = bestMoveTowardTarget({
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
    });
    const projectedTokens = applyProjectedDamage(tokens, result);
    await publishPlayerDefeatEvents(input, tokens, projectedTokens);
    tokens = projectedTokens;
  }

  await publishEvent(input.sessionId, "combat_turn_ended", {
    encounterId: input.encounter.id,
    tokenId: actor.id,
    tokenName: actor.name ?? actor.id,
    round: input.encounter.round,
    turnIndex: input.encounter.activeTurn,
    automated: true,
  });

  return { tokens };
}

async function setEncounterTurn(input: {
  sessionId: string;
  encounterId: string;
  turnIndex: number;
  round: number;
  activeToken: CombatToken;
}) {
  await prisma.encounter.update({
    where: { id: input.encounterId },
    data: { activeTurn: input.turnIndex, round: input.round },
  });
  await publishEvent(input.sessionId, "combat_turn_set", {
    encounterId: input.encounterId,
    turnIndex: input.turnIndex,
    round: input.round,
    name: input.activeToken.name ?? input.activeToken.id,
  });
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
    if (token && tokenHp(token) > 0) return { turnIndex, round, token };
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

async function publishPlayerDefeatEvents(
  context: Pick<CombatContext, "sessionId" | "encounter">,
  before: CombatToken[],
  after: CombatToken[],
) {
  const previousHp = new Map(before.map((token) => [token.id, tokenHp(token)]));
  for (const token of after) {
    if (token.team !== "player") continue;
    const beforeHp = previousHp.get(token.id) ?? 0;
    if (beforeHp <= 0 || tokenHp(token) > 0) continue;
    const payload = {
      encounterId: context.encounter.id,
      tokenId: token.id,
      characterId: token.id,
      tokenName: token.name ?? token.id,
      round: context.encounter.round,
      turnIndex: context.encounter.activeTurn,
    };
    await publishEvent(context.sessionId, "character_down", payload);
    await publishEvent(context.sessionId, "character_dead", {
      ...payload,
      reason: "reduced_to_zero_hp",
    });
  }
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

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
