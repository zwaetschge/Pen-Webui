import { prisma } from "../db";
import {
  combatResourceEvent,
  resourcesForTurn,
  type CombatResourceEvent,
  type CombatResourceState,
} from "./combat-resources";
import { BOOTSTRAP_EVENT_TYPES } from "./events";
import type { MovementTeam, MovementToken } from "./movement";

const COMBAT_CLOSE_EVENTS = [
  "combat_ended",
  "game_over",
  "session_ended",
  "scene_ended",
];
const SCENE_START_EVENTS = ["scene_set", ...BOOTSTRAP_EVENT_TYPES];

export type CombatMoveEvent = {
  tokenId: string;
  x: number;
  y: number;
  movementCost: number | null;
  round: number | null;
  turnIndex: number | null;
};

export type ActiveCombatState = {
  startedAt: Date;
  tokens: MovementToken[];
  moves: CombatMoveEvent[];
  actionEvents: CombatResourceEvent[];
};

export type ActiveExplorationState = {
  startedAt: Date | null;
  tokens: MovementToken[];
  moves: CombatMoveEvent[];
};

export async function activeCombatTokensForSession(
  sessionId: string,
): Promise<MovementToken[]> {
  return (await activeCombatStateForSession(sessionId))?.tokens ?? [];
}

export async function activeCombatStateForSession(
  sessionId: string,
): Promise<ActiveCombatState | null> {
  const combatStart = await prisma.eventLog.findFirst({
    where: { sessionId, type: "combat_started" },
    orderBy: [{ ts: "desc" }, { id: "desc" }],
    select: { id: true, payload: true, ts: true },
  });
  if (!combatStart) return null;

  const closed = await prisma.eventLog.findFirst({
    where: {
      sessionId,
      type: { in: COMBAT_CLOSE_EVENTS },
      ts: { gte: combatStart.ts },
    },
    orderBy: [{ ts: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (closed) return null;

  const tokens = new Map<string, MovementToken>();
  for (const token of tokensFromCombatPayload(combatStart.payload)) {
    tokens.set(token.id, token);
  }

  const liveEvents = await prisma.eventLog.findMany({
    where: {
      sessionId,
      type: { in: ["token_moved", "damage_applied", "combat_action_used"] },
      ts: { gte: combatStart.ts },
    },
    orderBy: [{ ts: "asc" }, { id: "asc" }],
    select: { type: true, payload: true },
  });
  const moveEvents: CombatMoveEvent[] = [];
  const actionEvents: CombatResourceEvent[] = [];

  for (const liveEvent of liveEvents) {
    if (liveEvent.type === "token_moved") {
      const move = combatMoveEvent(liveEvent.payload);
      if (!move) continue;
      moveEvents.push(move);
      const token = tokens.get(move.tokenId);
      if (!token) continue;
      tokens.set(move.tokenId, { ...token, x: move.x, y: move.y });
    }
    if (liveEvent.type === "damage_applied") {
      const damage = combatDamageEvent(liveEvent.payload);
      if (!damage) continue;
      const token = tokens.get(damage.targetId);
      if (!token) continue;
      const currentHp =
        typeof token.hp === "number" && Number.isFinite(token.hp)
          ? token.hp
          : 0;
      tokens.set(damage.targetId, {
        ...token,
        hp: Math.max(0, currentHp - damage.amount),
      });
    }
    if (liveEvent.type === "combat_action_used") {
      const action = combatResourceEvent(liveEvent.payload);
      if (action) actionEvents.push(action);
    }
  }

  return {
    startedAt: combatStart.ts,
    tokens: [...tokens.values()],
    moves: moveEvents,
    actionEvents,
  };
}

export async function activeExplorationStateForSession(
  sessionId: string,
  campaignId: string,
): Promise<ActiveExplorationState> {
  const sceneStart = await prisma.eventLog.findFirst({
    where: { sessionId, type: { in: SCENE_START_EVENTS } },
    orderBy: [{ ts: "desc" }, { id: "desc" }],
    select: { id: true, ts: true },
  });

  if (sceneStart) {
    const sceneClosed = await prisma.eventLog.findFirst({
      where: {
        sessionId,
        type: "scene_ended",
        ts: { gte: sceneStart.ts },
      },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (sceneClosed) {
      return { startedAt: sceneStart.ts, tokens: [], moves: [] };
    }
  }

  const characters = await prisma.character.findMany({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, sheet: true },
  });
  const tokens = new Map<string, MovementToken>();
  characters.forEach((character, index) => {
    tokens.set(character.id, {
      id: character.id,
      name: character.name,
      x: 2,
      y: Math.min(13, 2 + index),
      team: "player",
      movement: movementFromSheet(character.sheet),
    });
  });

  const moves = await prisma.eventLog.findMany({
    where: {
      sessionId,
      type: "token_moved",
      ...(sceneStart ? { ts: { gte: sceneStart.ts } } : {}),
    },
    orderBy: [{ ts: "asc" }, { id: "asc" }],
    select: { payload: true },
  });
  const moveEvents = moves.flatMap((move) => {
    const event = combatMoveEvent(move.payload);
    return event ? [event] : [];
  });

  for (const move of moveEvents) {
    const token = tokens.get(move.tokenId);
    if (!token) continue;
    tokens.set(move.tokenId, { ...token, x: move.x, y: move.y });
  }

  return {
    startedAt: sceneStart?.ts ?? null,
    tokens: [...tokens.values()],
    moves: moveEvents,
  };
}

export function movementSpentForTurn(
  moves: CombatMoveEvent[],
  input: {
    tokenId: string;
    round: number | null | undefined;
    turnIndex: number | null | undefined;
  },
): number {
  const round = integerField(input.round);
  const turnIndex = integerField(input.turnIndex);
  if (round === null || turnIndex === null) return 0;
  return moves.reduce((spent, move) => {
    if (move.tokenId !== input.tokenId) return spent;
    if (move.round !== round || move.turnIndex !== turnIndex) return spent;
    return spent + (move.movementCost ?? 0);
  }, 0);
}

export function combatResourcesForTurn(
  events: CombatResourceEvent[],
  input: {
    tokenId: string;
    round: number | null | undefined;
    turnIndex: number | null | undefined;
  },
): CombatResourceState {
  return resourcesForTurn(events, input);
}

function tokensFromCombatPayload(payload: unknown): MovementToken[] {
  const record = recordPayload(payload);
  const tokens = record.tokens;
  if (!Array.isArray(tokens)) return [];
  return tokens.flatMap((raw) => {
    const token = movementToken(raw);
    return token ? [token] : [];
  });
}

function movementToken(raw: unknown): MovementToken | null {
  const record = recordPayload(raw);
  const id = stringField(record.id);
  const x = integerField(record.x);
  const y = integerField(record.y);
  if (!id || x === null || y === null) return null;
  const token: MovementToken = {
    id,
    name: stringField(record.name),
    x,
    y,
    team: teamField(record.team),
  };
  assignIfPresent(token, "hp", integerField(record.hp));
  assignIfPresent(token, "maxHp", integerField(record.maxHp));
  assignIfPresent(token, "ac", integerField(record.ac));
  assignIfPresent(token, "movement", integerField(record.movement));
  assignIfPresent(token, "attackBonus", integerField(record.attackBonus));
  assignIfPresent(token, "damageDice", stringField(record.damageDice));
  assignIfPresent(token, "damageType", stringField(record.damageType));
  assignIfPresent(token, "attackRange", integerField(record.attackRange));
  return token;
}

function combatMoveEvent(raw: unknown): CombatMoveEvent | null {
  const payload = recordPayload(raw);
  const tokenId = stringField(payload.tokenId);
  const x = integerField(payload.x);
  const y = integerField(payload.y);
  if (!tokenId || x === null || y === null) return null;
  return {
    tokenId,
    x,
    y,
    movementCost: nonNegativeIntegerField(payload.movementCost),
    round: integerField(payload.round),
    turnIndex: integerField(payload.turnIndex),
  };
}

function combatDamageEvent(
  raw: unknown,
): { targetId: string; amount: number } | null {
  const payload = recordPayload(raw);
  const targetId = stringField(payload.targetId);
  const amount = nonNegativeIntegerField(payload.amount);
  if (!targetId || amount === null) return null;
  return { targetId, amount };
}

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function integerField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonNegativeIntegerField(value: unknown): number | null {
  const number = integerField(value);
  return number !== null && number >= 0 ? number : null;
}

function teamField(value: unknown): MovementTeam | null {
  if (value === "player" || value === "monster" || value === "npc") {
    return value;
  }
  return null;
}

function movementFromSheet(sheet: unknown): number | null {
  const record = recordPayload(sheet);
  const speed = integerField(record.speed);
  if (speed === null || speed <= 0) return null;
  return Math.max(1, Math.floor(speed / 5));
}

function assignIfPresent<K extends keyof MovementToken>(
  token: MovementToken,
  key: K,
  value: MovementToken[K] | null,
) {
  if (value !== null) token[key] = value;
}
