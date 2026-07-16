import type { MovementToken } from "./movement";

export type InitiativeEntry = {
  name?: string | null;
  refId?: string | null;
  id?: string | null;
  tokenId?: string | null;
};

export function activeInitiativeEntry(
  initiative: unknown,
  turnIndex: number | null | undefined,
): InitiativeEntry | null {
  if (!Array.isArray(initiative) || initiative.length === 0) return null;
  const index =
    typeof turnIndex === "number" && Number.isInteger(turnIndex)
      ? Math.max(0, Math.min(initiative.length - 1, turnIndex))
      : 0;
  const entry = initiative[index];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return entry as InitiativeEntry;
}

export function isActiveTurnForToken(input: {
  initiative: unknown;
  turnIndex: number | null | undefined;
  token: Pick<MovementToken, "id" | "name">;
}): boolean {
  const entry = activeInitiativeEntry(input.initiative, input.turnIndex);
  return entry ? initiativeEntryMatchesToken(entry, input.token) : false;
}

export function isTurnAvailableForToken(input: {
  initiative: unknown;
  turnIndex: number | null | undefined;
  token: Pick<MovementToken, "id" | "name">;
  turnGroup?: {
    tokenIds: string[];
    completedTokenIds: string[];
  } | null;
}): boolean {
  if (input.turnGroup?.tokenIds.length) {
    return (
      input.turnGroup.tokenIds.includes(input.token.id) &&
      !input.turnGroup.completedTokenIds.includes(input.token.id)
    );
  }
  return isActiveTurnForToken(input);
}

export function isActiveTurnForCharacter(input: {
  initiative: unknown;
  turnIndex: number | null | undefined;
  characterId: string | null | undefined;
  characterName?: string | null;
}): boolean {
  if (!input.characterId) return false;
  const entry = activeInitiativeEntry(input.initiative, input.turnIndex);
  if (!entry) return false;
  return initiativeEntryMatchesToken(entry, {
    id: input.characterId,
    name: input.characterName,
  });
}

export function activeInitiativeName(
  initiative: unknown,
  turnIndex: number | null | undefined,
): string | null {
  const entry = activeInitiativeEntry(initiative, turnIndex);
  return typeof entry?.name === "string" && entry.name.trim()
    ? entry.name
    : null;
}

function initiativeEntryMatchesToken(
  entry: InitiativeEntry,
  token: Pick<MovementToken, "id" | "name">,
): boolean {
  const refs = [entry.refId, entry.id, entry.tokenId]
    .filter((ref): ref is string => typeof ref === "string")
    .map((ref) => ref.trim())
    .filter(Boolean);
  if (refs.includes(token.id)) return true;

  const entryName = normalizeName(entry.name);
  const tokenName = normalizeName(token.name);
  return Boolean(entryName && tokenName && entryName === tokenName);
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || null;
}
