import type { MovementToken } from "./movement";

export type InitiativeEntry = {
  name: string;
  roll: number;
  refId?: string | null;
};

export type TurnGroup = {
  team: "player" | "enemy";
  startIndex: number;
  endIndex: number;
  tokenIds: string[];
};

export type PlannedCombatAction = {
  actorTokenId: string;
  abilityId: string;
  targetTokenId?: string;
  targetCell?: { x: number; y: number };
  createdAt: number;
};

export function activeTurnGroup(
  initiative: unknown,
  activeTurn: number,
  tokens: MovementToken[],
): TurnGroup | null {
  const entries = initiativeEntries(initiative);
  if (entries.length === 0) return null;
  const startIndex = clampTurnIndex(activeTurn, entries.length);
  const tokenById = new Map(tokens.map((token) => [token.id, token]));
  const first = livingTokenForEntry(entries[startIndex], tokens, tokenById);
  if (!first) return null;
  const team = first.team === "player" ? "player" : "enemy";
  const tokenIds: string[] = [first.id];
  let endIndex = startIndex;

  for (let index = startIndex + 1; index < entries.length; index += 1) {
    const token = livingTokenForEntry(entries[index], tokens, tokenById);
    if (!token) continue;
    const tokenTeam = token.team === "player" ? "player" : "enemy";
    if (tokenTeam !== team) break;
    tokenIds.push(token.id);
    endIndex = index;
  }

  return { team, startIndex, endIndex, tokenIds };
}

export function tokenCanActInGroup(
  tokenId: string,
  group: TurnGroup | null,
  completedTokenIds: Iterable<string> = [],
): boolean {
  if (!group || !group.tokenIds.includes(tokenId)) return false;
  return !new Set(completedTokenIds).has(tokenId);
}

export function remainingGroupTokenIds(
  group: TurnGroup | null,
  completedTokenIds: Iterable<string>,
): string[] {
  if (!group) return [];
  const completed = new Set(completedTokenIds);
  return group.tokenIds.filter((tokenId) => !completed.has(tokenId));
}

export function normalizePlannedAction(value: unknown): PlannedCombatAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actorTokenId = nonEmptyString(record.actorTokenId);
  const abilityId = nonEmptyString(record.abilityId);
  if (!actorTokenId || !abilityId) {
    return null;
  }
  const targetCell = gridCell(record.targetCell);
  const targetTokenId = nonEmptyString(record.targetTokenId);
  const createdAt = finiteTimestamp(record.createdAt) ?? Date.now();
  return {
    actorTokenId,
    abilityId,
    ...(targetTokenId ? { targetTokenId } : {}),
    ...(targetCell ? { targetCell } : {}),
    createdAt,
  };
}

function initiativeEntries(value: unknown): InitiativeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    const name = nonEmptyString(entry.name);
    if (!name) return [];
    return [{
      name,
      roll: typeof entry.roll === "number" && Number.isFinite(entry.roll)
        ? entry.roll
        : 0,
      refId: nonEmptyString(entry.refId),
    }];
  });
}

function livingTokenForEntry(
  entry: InitiativeEntry,
  tokens: MovementToken[],
  tokenById: Map<string, MovementToken>,
) {
  const token =
    (entry.refId ? tokenById.get(entry.refId) : undefined) ??
    tokens.find((candidate) => candidate.name === entry.name);
  if (!token) return null;
  const hp = typeof token.hp === "number" ? token.hp : 1;
  // A player at 0 HP still owns an initiative turn for death saves,
  // stabilisation state and revival. NPCs at 0 HP leave initiative.
  return hp > 0 || token.team === "player" ? token : null;
}

function clampTurnIndex(index: number, length: number) {
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, length - 1);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function gridCell(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cell = value as Record<string, unknown>;
  return Number.isInteger(cell.x) && Number.isInteger(cell.y)
    ? { x: cell.x as number, y: cell.y as number }
    : null;
}
