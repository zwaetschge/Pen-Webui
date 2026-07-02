export type CombatActionResource = "action" | "bonusAction" | "reaction";

export type CombatResourceState = {
  actionUsed: boolean;
  bonusActionUsed: boolean;
  reactionUsed: boolean;
  movementBonus: number;
  dash: boolean;
  dodge: boolean;
  disengage: boolean;
};

export type CombatResourceEvent = {
  tokenId: string;
  actionType: string;
  resource: CombatActionResource | null;
  round: number | null;
  turnIndex: number | null;
  movementBonus: number;
};

export const EMPTY_COMBAT_RESOURCES: CombatResourceState = {
  actionUsed: false,
  bonusActionUsed: false,
  reactionUsed: false,
  movementBonus: 0,
  dash: false,
  dodge: false,
  disengage: false,
};

export function combatResourceEvent(raw: unknown): CombatResourceEvent | null {
  const payload = recordPayload(raw);
  const tokenId = stringField(payload.tokenId);
  const actionType = stringField(payload.actionType);
  if (!tokenId || !actionType) return null;

  return {
    tokenId,
    actionType,
    resource: resourceField(payload.resource),
    round: integerField(payload.round),
    turnIndex: integerField(payload.turnIndex),
    movementBonus: nonNegativeIntegerField(payload.movementBonus) ?? 0,
  };
}

export function resourcesForTurn(
  events: CombatResourceEvent[],
  input: {
    tokenId: string;
    round: number | null | undefined;
    turnIndex: number | null | undefined;
  },
): CombatResourceState {
  const round = integerField(input.round);
  const turnIndex = integerField(input.turnIndex);
  if (round === null || turnIndex === null) return EMPTY_COMBAT_RESOURCES;

  return events.reduce<CombatResourceState>(
    (state, event) => {
      if (event.tokenId !== input.tokenId) return state;
      if (event.round !== round || event.turnIndex !== turnIndex) return state;
      return applyCombatResourceEvent(state, event);
    },
    { ...EMPTY_COMBAT_RESOURCES },
  );
}

export function applyCombatResourceEvent(
  current: CombatResourceState | undefined,
  event: CombatResourceEvent,
): CombatResourceState {
  const next = { ...(current ?? EMPTY_COMBAT_RESOURCES) };
  if (event.resource === "action") next.actionUsed = true;
  if (event.resource === "bonusAction") next.bonusActionUsed = true;
  if (event.resource === "reaction") next.reactionUsed = true;
  next.movementBonus += event.movementBonus;
  if (event.actionType === "dash") next.dash = true;
  if (event.actionType === "dodge") next.dodge = true;
  if (event.actionType === "disengage") next.disengage = true;
  return next;
}

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonNegativeIntegerField(value: unknown): number | null {
  const valueAsInteger = integerField(value);
  return valueAsInteger !== null && valueAsInteger >= 0
    ? valueAsInteger
    : null;
}

function resourceField(value: unknown): CombatActionResource | null {
  if (value === "action" || value === "bonusAction" || value === "reaction") {
    return value;
  }
  return null;
}
