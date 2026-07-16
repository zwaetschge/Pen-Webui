import {
  normalizePlannedAction,
  type PlannedCombatAction,
} from "./turn-groups";

export const ENCOUNTER_RUNTIME_VERSION = 1 as const;

export type ReactionWindowState = {
  id: string;
  trigger: "attack" | "movement" | "spell";
  reactorTokenId: string;
  sourceTokenId: string;
  options: string[];
  pendingCommand: Record<string, unknown>;
  openedAt: number;
  expiresAt: number;
};

export type EncounterObjectiveState = {
  id: string;
  label: string;
  progress: number;
  target: number;
  status: "active" | "completed" | "failed";
};

export type EncounterRuntime = {
  version: typeof ENCOUNTER_RUNTIME_VERSION;
  turnGroup: {
    round: number;
    startIndex: number;
    completedTokenIds: string[];
  } | null;
  plans: Record<string, PlannedCombatAction>;
  reaction: ReactionWindowState | null;
  statuses: Record<string, Array<Record<string, unknown>>>;
  surfaces: Array<Record<string, unknown>>;
  objects: Array<Record<string, unknown>>;
  visibility: Record<string, Record<string, boolean>>;
  objectives: EncounterObjectiveState[];
};

export const EMPTY_ENCOUNTER_RUNTIME: EncounterRuntime = {
  version: ENCOUNTER_RUNTIME_VERSION,
  turnGroup: null,
  plans: {},
  reaction: null,
  statuses: {},
  surfaces: [],
  objects: [],
  visibility: {},
  objectives: [],
};

export function normalizeEncounterRuntime(value: unknown): EncounterRuntime {
  const record = objectRecord(value);
  const plans = Object.fromEntries(
    Object.entries(objectRecord(record.plans)).flatMap(([tokenId, raw]) => {
      const plan = normalizePlannedAction(raw);
      return plan && plan.actorTokenId === tokenId ? [[tokenId, plan]] : [];
    }),
  );
  return {
    version: ENCOUNTER_RUNTIME_VERSION,
    turnGroup: normalizeTurnGroup(record.turnGroup),
    plans,
    reaction: normalizeReactionWindow(record.reaction),
    statuses: normalizeRecordArrays(record.statuses),
    surfaces: recordArray(record.surfaces),
    objects: recordArray(record.objects),
    visibility: normalizeVisibility(record.visibility),
    objectives: normalizeObjectives(record.objectives),
  };
}

export function withPlannedAction(
  runtime: EncounterRuntime,
  plan: PlannedCombatAction,
): EncounterRuntime {
  return {
    ...runtime,
    plans: { ...runtime.plans, [plan.actorTokenId]: plan },
  };
}

export function withoutPlannedAction(
  runtime: EncounterRuntime,
  tokenId: string,
): EncounterRuntime {
  const plans = { ...runtime.plans };
  delete plans[tokenId];
  return { ...runtime, plans };
}

export function withCompletedTurnMember(
  runtime: EncounterRuntime,
  input: { round: number; startIndex: number; tokenId: string },
): EncounterRuntime {
  const current = runtime.turnGroup;
  const completed =
    current?.round === input.round && current.startIndex === input.startIndex
      ? current.completedTokenIds
      : [];
  return {
    ...withoutPlannedAction(runtime, input.tokenId),
    turnGroup: {
      round: input.round,
      startIndex: input.startIndex,
      completedTokenIds: [...new Set([...completed, input.tokenId])],
    },
  };
}

export function completedTurnMembers(
  runtime: EncounterRuntime,
  round: number,
  startIndex: number,
): string[] {
  return runtime.turnGroup?.round === round &&
    runtime.turnGroup.startIndex === startIndex
    ? runtime.turnGroup.completedTokenIds
    : [];
}

function normalizeTurnGroup(value: unknown): EncounterRuntime["turnGroup"] {
  const record = objectRecord(value);
  const round = nonNegativeInteger(record.round);
  const startIndex = nonNegativeInteger(record.startIndex);
  if (round === null || startIndex === null) return null;
  return {
    round,
    startIndex,
    completedTokenIds: stringArray(record.completedTokenIds),
  };
}

function normalizeReactionWindow(value: unknown): ReactionWindowState | null {
  const record = objectRecord(value);
  const id = stringField(record.id);
  const reactorTokenId = stringField(record.reactorTokenId);
  const sourceTokenId = stringField(record.sourceTokenId);
  const openedAt = nonNegativeInteger(record.openedAt);
  const expiresAt = nonNegativeInteger(record.expiresAt);
  const trigger =
    record.trigger === "attack" ||
    record.trigger === "movement" ||
    record.trigger === "spell"
      ? record.trigger
      : null;
  if (
    !id ||
    !reactorTokenId ||
    !sourceTokenId ||
    !trigger ||
    openedAt === null ||
    expiresAt === null ||
    expiresAt <= openedAt
  ) {
    return null;
  }
  return {
    id,
    reactorTokenId,
    sourceTokenId,
    trigger,
    options: stringArray(record.options),
    pendingCommand: objectRecord(record.pendingCommand),
    openedAt,
    expiresAt,
  };
}

function normalizeObjectives(value: unknown): EncounterObjectiveState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const objective = objectRecord(raw);
    const id = stringField(objective.id);
    const label = stringField(objective.label);
    const progress = nonNegativeInteger(objective.progress);
    const target = nonNegativeInteger(objective.target);
    const status =
      objective.status === "completed" || objective.status === "failed"
        ? objective.status
        : "active";
    if (!id || !label || progress === null || target === null || target < 1) {
      return [];
    }
    return [{ id, label, progress, target, status }];
  });
}

function normalizeRecordArrays(value: unknown) {
  return Object.fromEntries(
    Object.entries(objectRecord(value)).map(([key, raw]) => [
      key,
      recordArray(raw),
    ]),
  );
}

function normalizeVisibility(value: unknown) {
  return Object.fromEntries(
    Object.entries(objectRecord(value)).map(([viewerId, raw]) => [
      viewerId,
      Object.fromEntries(
        Object.entries(objectRecord(raw)).map(([tokenId, visible]) => [
          tokenId,
          visible === true,
        ]),
      ),
    ]),
  );
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.flatMap((item) => (stringField(item) ? [stringField(item)!] : [])))]
    : [];
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
