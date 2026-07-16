/**
 * Deterministic, server-authoritative tactical rules.
 *
 * This module deliberately has no database, network, or random-number
 * dependencies. Callers can persist the returned state/events through the
 * existing game event bus without letting presentation code decide rules.
 */

export const DEFAULT_TACTICAL_COLUMNS = 16;
export const DEFAULT_TACTICAL_ROWS = 16;

export type GridPoint = { x: number; y: number };

export type CoverLevel = "none" | "half" | "three-quarters" | "full";
export type CardinalDirection = "north" | "east" | "south" | "west";
export type TerrainKind = "normal" | "difficult" | "mud" | "rubble";
export type SurfaceType = "fire" | "water" | "ice" | "lightning";
export type SurfacePhase = "enter" | "end-turn";

export type ElevationCell = GridPoint & { elevation: number };
export type CoverCell = GridPoint & { level: CoverLevel };
export type CoverEdge = GridPoint & {
  direction: CardinalDirection;
  level: Exclude<CoverLevel, "none">;
};
export type TerrainCell = GridPoint & {
  kind: TerrainKind;
  movementCost: number;
};
export type SurfaceState = GridPoint & {
  type: SurfaceType;
  intensity: 1 | 2 | 3;
  /** Null means that the surface remains until another rule changes it. */
  duration: number | null;
  sourceId?: string;
};

export type TacticalObjectKind = "door" | "barrel" | "trap" | "destructible";
export type TacticalObjectState =
  | "open"
  | "closed"
  | "locked"
  | "intact"
  | "armed"
  | "disarmed"
  | "triggered"
  | "destroyed";
export type BarrelContent = "oil" | "water" | "volatile" | "empty";

export type TacticalObject = GridPoint & {
  id: string;
  name: string;
  kind: TacticalObjectKind;
  state: TacticalObjectState;
  hp: number;
  maxHp: number;
  blocksMovement: boolean;
  blocksSight: boolean;
  armorClass: number;
  content?: BarrelContent;
  detected?: boolean;
  disarmDC?: number;
  trapDamage?: number;
  trapDamageType?: string;
  trapCondition?: string;
};

export type TacticalGrid = {
  columns: number;
  rows: number;
  blocked: GridPoint[];
  elevations: ElevationCell[];
  coverCells: CoverCell[];
  coverEdges: CoverEdge[];
  terrain: TerrainCell[];
  surfaces: SurfaceState[];
  objects: TacticalObject[];
};

export type TacticalFailureCode =
  | "outside_grid"
  | "blocked_tile"
  | "occupied_tile"
  | "no_line_of_sight"
  | "full_cover"
  | "out_of_range"
  | "not_adjacent"
  | "invalid_distance"
  | "invalid_direction"
  | "insufficient_force"
  | "object_not_found"
  | "invalid_interaction"
  | "object_destroyed"
  | "object_locked"
  | "door_already_open"
  | "door_already_closed"
  | "trap_inactive"
  | "invalid_damage"
  | "target_hidden";

export type TacticalRuleFailure = {
  ok: false;
  code: TacticalFailureCode;
  reason: string;
};

export type TacticalRuleResult<T extends object> =
  | ({ ok: true } & T)
  | TacticalRuleFailure;

export type LineOfSightResult = {
  visible: boolean;
  ray: GridPoint[];
  blockedAt?: GridPoint;
  reason?: string;
};

export type CoverResult = {
  level: CoverLevel;
  /** Full cover cannot be attacked and therefore has no finite AC bonus. */
  acBonus: number | null;
  dexteritySaveBonus: number | null;
  sources: string[];
};

export type HeightModifier = {
  difference: number;
  attackRollModifier: -2 | 0 | 2;
  label: "low-ground" | "level" | "high-ground";
};

export type PositionModifiers = {
  cover: CoverResult;
  height: HeightModifier;
  totalAttackRollModifier: number | null;
};

export type ForcedMovementCollision =
  | "boundary"
  | "blocked"
  | "occupied"
  | "steep-ascent";

export type FallDamage = {
  dropLevels: number;
  feet: number;
  diceCount: number;
  dice: string | null;
  /** Deterministic average used by this rules layer: 3 damage per d6. */
  damage: number;
};

export type ForcedMovementResult = TacticalRuleResult<{
  destination: GridPoint;
  path: GridPoint[];
  distanceMoved: number;
  collision: ForcedMovementCollision | null;
  fall: FallDamage;
}>;

export type SurfaceTransformKind =
  | "created"
  | "intensified"
  | "transformed"
  | "extinguished";

export type SurfaceTransformResult = {
  kind: SurfaceTransformKind;
  surface: SurfaceState | null;
};

export type SurfaceEffect = {
  damage: number;
  damageType: string | null;
  conditions: string[];
  movementCost: number;
  save: {
    ability: "dexterity";
    dc: number;
    onFailure: string;
  } | null;
};

export type TacticalObjectAction =
  | "open"
  | "close"
  | "toggle"
  | "damage"
  | "ignite"
  | "trigger"
  | "disarm";

export type TacticalObjectEvent = {
  type:
    | "door_opened"
    | "door_closed"
    | "object_damaged"
    | "object_destroyed"
    | "barrel_ignited"
    | "trap_disarmed"
    | "trap_triggered";
  objectId: string;
  damage?: number;
  damageType?: string;
  condition?: string;
};

export type TacticalObjectInteractionResult = TacticalRuleResult<{
  grid: TacticalGrid;
  object: TacticalObject;
  events: TacticalObjectEvent[];
  outcome: "success" | "failed-check";
}>;

export type StealthActor = {
  id: string;
  position: GridPoint;
  team?: string | null;
  hidden: boolean;
  /** The already-resolved stealth check total. */
  stealth: number;
  /** Passive perception or an already-resolved active perception total. */
  perception: number;
  visionRange?: number;
};

export type VisibilityResult = {
  visible: boolean;
  reason: "self" | "visible" | "out-of-range" | "line-of-sight" | "hidden";
  distance: number;
  perceptionDC: number | null;
  observerScore: number;
};

export type SurpriseResult = {
  surprisedIds: string[];
  detections: Array<{
    observerId: string;
    initiatorId: string;
    visible: boolean;
  }>;
};

const COVER_RANK: Record<CoverLevel, number> = {
  none: 0,
  half: 1,
  "three-quarters": 2,
  full: 3,
};

const DEFAULT_TERRAIN_COST: Record<TerrainKind, number> = {
  normal: 1,
  difficult: 2,
  mud: 2,
  rubble: 2,
};

export function pointKey(point: GridPoint): string {
  return `${point.x}:${point.y}`;
}

/**
 * Accepts the legacy movement-grid shape as well as richer tactical data.
 * Invalid entries are ignored; valid data is canonicalised and sorted.
 */
export function normalizeTacticalGrid(
  value: unknown,
  defaults: Partial<Pick<TacticalGrid, "columns" | "rows">> = {},
): TacticalGrid {
  const record = asRecord(value);
  const columns =
    positiveInteger(record.columns) ??
    positiveInteger(record.cols) ??
    positiveInteger(defaults.columns) ??
    DEFAULT_TACTICAL_COLUMNS;
  const rows =
    positiveInteger(record.rows) ??
    positiveInteger(defaults.rows) ??
    DEFAULT_TACTICAL_ROWS;
  const bounds = { columns, rows };

  const blocked = uniquePoints(
    ["blocked", "blockedTiles", "obstacles", "walls"].flatMap((key) =>
      pointsFrom(record[key]),
    ),
  ).filter((point) => isInsideGrid(point, bounds));

  return {
    columns,
    rows,
    blocked,
    elevations: normalizeElevations(
      record.elevations ?? record.elevation,
      bounds,
    ),
    coverCells: normalizeCoverCells(record.coverCells ?? record.cover, bounds),
    coverEdges: normalizeCoverEdges(record.coverEdges, bounds),
    terrain: normalizeTerrain(record.terrain ?? record.terrainCells, bounds),
    surfaces: normalizeSurfaces(record.surfaces ?? record.surfaceCells, bounds),
    objects: normalizeObjects(
      record.objects ?? record.interactives ?? record.interactiveObjects,
      bounds,
    ),
  };
}

export function isInsideGrid(
  point: GridPoint,
  grid: Pick<TacticalGrid, "columns" | "rows">,
): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < grid.columns &&
    point.y < grid.rows
  );
}

export function elevationAt(grid: TacticalGrid, point: GridPoint): number {
  return (
    grid.elevations.find((cell) => cell.x === point.x && cell.y === point.y)
      ?.elevation ?? 0
  );
}

export function terrainAt(grid: TacticalGrid, point: GridPoint): TerrainCell {
  return (
    grid.terrain.find((cell) => cell.x === point.x && cell.y === point.y) ?? {
      ...point,
      kind: "normal",
      movementCost: 1,
    }
  );
}

export function surfaceAt(
  grid: TacticalGrid,
  point: GridPoint,
): SurfaceState | null {
  return (
    grid.surfaces.find(
      (surface) => surface.x === point.x && surface.y === point.y,
    ) ?? null
  );
}

export function objectAt(
  grid: TacticalGrid,
  point: GridPoint,
): TacticalObject | null {
  return (
    grid.objects.find(
      (object) => object.x === point.x && object.y === point.y,
    ) ?? null
  );
}

export function movementCostAt(grid: TacticalGrid, point: GridPoint): number {
  const terrainCost = terrainAt(grid, point).movementCost;
  const surface = surfaceAt(grid, point);
  if (!surface) return terrainCost;
  if (surface.type === "ice" || surface.type === "water") {
    return Math.max(terrainCost, 2);
  }
  return terrainCost;
}

export function isObjectDestroyed(object: TacticalObject): boolean {
  return object.state === "destroyed" || object.hp <= 0;
}

export function objectBlocksMovement(object: TacticalObject): boolean {
  if (isObjectDestroyed(object)) return false;
  if (object.kind === "door") return object.state !== "open";
  return object.blocksMovement;
}

export function objectBlocksSight(object: TacticalObject): boolean {
  if (isObjectDestroyed(object)) return false;
  if (object.kind === "door") return object.state !== "open";
  return object.blocksSight;
}

export function isCellBlocked(grid: TacticalGrid, point: GridPoint): boolean {
  if (!isInsideGrid(point, grid)) return true;
  if (grid.blocked.some((blocked) => samePoint(blocked, point))) return true;
  return grid.objects.some(
    (object) => samePoint(object, point) && objectBlocksMovement(object),
  );
}

/** Inclusive integer Bresenham ray. */
export function bresenhamLine(from: GridPoint, to: GridPoint): GridPoint[] {
  const points: GridPoint[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let error = dx - dy;

  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const doubledError = error * 2;
    if (doubledError > -dy) {
      error -= dy;
      x += sx;
    }
    if (doubledError < dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

export function lineOfSight(
  grid: TacticalGrid,
  from: GridPoint,
  to: GridPoint,
): LineOfSightResult {
  const ray = bresenhamLine(from, to);
  if (!isInsideGrid(from, grid) || !isInsideGrid(to, grid)) {
    return {
      visible: false,
      ray,
      blockedAt: !isInsideGrid(from, grid) ? from : to,
      reason: invalidActionReason("outside_grid"),
    };
  }

  for (let index = 1; index < ray.length; index++) {
    const previous = ray[index - 1];
    const current = ray[index];
    const crossedEdges = coverEdgesCrossed(grid, previous, current);
    if (crossedEdges.some((edge) => edge.level === "full")) {
      return {
        visible: false,
        ray,
        blockedAt: current,
        reason: invalidActionReason("no_line_of_sight"),
      };
    }

    // A target can stand beside/on a low obstacle, so only intermediate cells
    // hard-block the ray. Full cover on the target is handled by coverBetween.
    if (index === ray.length - 1) continue;
    if (
      grid.blocked.some((point) => samePoint(point, current)) ||
      grid.objects.some(
        (object) => samePoint(object, current) && objectBlocksSight(object),
      ) ||
      coverCellAt(grid, current).level === "full"
    ) {
      return {
        visible: false,
        ray,
        blockedAt: current,
        reason: invalidActionReason("no_line_of_sight"),
      };
    }
  }

  return { visible: true, ray };
}

export function coverBetween(
  grid: TacticalGrid,
  attacker: GridPoint,
  target: GridPoint,
): CoverResult {
  const sight = lineOfSight(grid, attacker, target);
  if (!sight.visible) {
    return coverResult("full", ["line-of-sight"]);
  }

  let level: CoverLevel = "none";
  const sources: string[] = [];
  for (let index = 1; index < sight.ray.length; index++) {
    const previous = sight.ray[index - 1];
    const current = sight.ray[index];
    for (const edge of coverEdgesCrossed(grid, previous, current)) {
      if (COVER_RANK[edge.level] > COVER_RANK[level]) level = edge.level;
      sources.push(`edge:${edge.x}:${edge.y}:${edge.direction}:${edge.level}`);
    }
    const cell = coverCellAt(grid, current);
    if (COVER_RANK[cell.level] > COVER_RANK[level]) level = cell.level;
    if (cell.level !== "none") {
      sources.push(`cell:${cell.x}:${cell.y}:${cell.level}`);
    }
  }
  return coverResult(level, [...new Set(sources)]);
}

export function heightModifierBetween(
  grid: TacticalGrid,
  attacker: GridPoint,
  target: GridPoint,
  threshold = 2,
): HeightModifier {
  const difference = elevationAt(grid, attacker) - elevationAt(grid, target);
  if (difference >= Math.max(1, threshold)) {
    return { difference, attackRollModifier: 2, label: "high-ground" };
  }
  if (difference <= -Math.max(1, threshold)) {
    return { difference, attackRollModifier: -2, label: "low-ground" };
  }
  return { difference, attackRollModifier: 0, label: "level" };
}

export function positionModifiersBetween(
  grid: TacticalGrid,
  attacker: GridPoint,
  target: GridPoint,
): PositionModifiers {
  const cover = coverBetween(grid, attacker, target);
  const height = heightModifierBetween(grid, attacker, target);
  return {
    cover,
    height,
    totalAttackRollModifier:
      cover.acBonus === null ? null : height.attackRollModifier - cover.acBonus,
  };
}

export function gridDistance(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function validateTacticalAction(
  grid: TacticalGrid,
  input: {
    from: GridPoint;
    target: GridPoint;
    maxRange?: number;
    occupied?: GridPoint[];
    requiresLineOfSight?: boolean;
    allowBlockedTarget?: boolean;
    targetHidden?: boolean;
  },
): TacticalRuleResult<{ distance: number; modifiers: PositionModifiers }> {
  if (!isInsideGrid(input.from, grid) || !isInsideGrid(input.target, grid)) {
    return failure("outside_grid");
  }
  if (!input.allowBlockedTarget && isCellBlocked(grid, input.target)) {
    return failure("blocked_tile");
  }
  if ((input.occupied ?? []).some((point) => samePoint(point, input.target))) {
    return failure("occupied_tile");
  }
  const distance = gridDistance(input.from, input.target);
  if (input.maxRange !== undefined && distance > Math.max(0, input.maxRange)) {
    return failure("out_of_range", { range: Math.max(0, input.maxRange) });
  }
  if (input.targetHidden) return failure("target_hidden");
  const modifiers = positionModifiersBetween(grid, input.from, input.target);
  if (input.requiresLineOfSight !== false && modifiers.cover.level === "full") {
    return failure("no_line_of_sight");
  }
  return { ok: true, distance, modifiers };
}

export function fallDamageForDrop(
  dropLevels: number,
  options: { feetPerLevel?: number; maxDice?: number } = {},
): FallDamage {
  const safeDrop = Math.max(0, Math.floor(dropLevels));
  const feet = safeDrop * Math.max(1, options.feetPerLevel ?? 5);
  const diceCount = Math.min(
    Math.max(1, options.maxDice ?? 20),
    Math.floor(feet / 10),
  );
  return {
    dropLevels: safeDrop,
    feet,
    diceCount,
    dice: diceCount > 0 ? `${diceCount}d6` : null,
    damage: diceCount * 3,
  };
}

export function resolveForcedMovement(
  grid: TacticalGrid,
  input: {
    start: GridPoint;
    direction: GridPoint;
    distance: number;
    occupied?: GridPoint[];
    maxForcedAscent?: number;
  },
): ForcedMovementResult {
  if (!isInsideGrid(input.start, grid)) return failure("outside_grid");
  if (!Number.isInteger(input.distance) || input.distance <= 0) {
    return failure("invalid_distance");
  }
  const direction = {
    x: Math.sign(input.direction.x),
    y: Math.sign(input.direction.y),
  };
  if (direction.x === 0 && direction.y === 0) {
    return failure("invalid_direction");
  }

  const occupied = input.occupied ?? [];
  const path: GridPoint[] = [];
  let current = { ...input.start };
  let collision: ForcedMovementCollision | null = null;
  let greatestDrop = 0;

  for (let step = 0; step < input.distance; step++) {
    const next = { x: current.x + direction.x, y: current.y + direction.y };
    if (!isInsideGrid(next, grid)) {
      collision = "boundary";
      break;
    }
    if (isCellBlocked(grid, next)) {
      collision = "blocked";
      break;
    }
    if (occupied.some((point) => samePoint(point, next))) {
      collision = "occupied";
      break;
    }
    const elevationDelta = elevationAt(grid, next) - elevationAt(grid, current);
    if (elevationDelta > Math.max(0, input.maxForcedAscent ?? 1)) {
      collision = "steep-ascent";
      break;
    }
    if (elevationDelta < 0) {
      greatestDrop = Math.max(greatestDrop, -elevationDelta);
    }
    current = next;
    path.push(current);
  }

  return {
    ok: true,
    destination: current,
    path,
    distanceMoved: path.length,
    collision,
    fall: fallDamageForDrop(greatestDrop),
  };
}

export function resolveShove(
  grid: TacticalGrid,
  input: {
    source: GridPoint;
    target: GridPoint;
    distance?: number;
    force?: number;
    resistance?: number;
    occupied?: GridPoint[];
  },
): ForcedMovementResult {
  if (!isInsideGrid(input.source, grid) || !isInsideGrid(input.target, grid)) {
    return failure("outside_grid");
  }
  if (gridDistance(input.source, input.target) !== 1) {
    return failure("not_adjacent");
  }
  if (
    input.force !== undefined &&
    input.resistance !== undefined &&
    input.force <= input.resistance
  ) {
    return failure("insufficient_force");
  }
  return resolveForcedMovement(grid, {
    start: input.target,
    direction: {
      x: input.target.x - input.source.x,
      y: input.target.y - input.source.y,
    },
    distance: input.distance ?? 1,
    occupied: input.occupied,
  });
}

export function transformSurface(
  existing: SurfaceState | null,
  incoming: SurfaceState,
): SurfaceTransformResult {
  if (!existing) return { kind: "created", surface: { ...incoming } };
  const base = {
    x: incoming.x,
    y: incoming.y,
    intensity: clampIntensity(Math.max(existing.intensity, incoming.intensity)),
    duration: maxDuration(existing.duration, incoming.duration),
    ...(incoming.sourceId ? { sourceId: incoming.sourceId } : {}),
  };

  if (existing.type === incoming.type) {
    return {
      kind: "intensified",
      surface: {
        ...base,
        type: incoming.type,
        intensity: clampIntensity(existing.intensity + incoming.intensity),
      },
    };
  }

  const pair = new Set<SurfaceType>([existing.type, incoming.type]);
  if (pair.has("fire") && pair.has("water")) {
    return { kind: "extinguished", surface: null };
  }
  if (pair.has("fire") && pair.has("ice")) {
    return { kind: "transformed", surface: { ...base, type: "water" } };
  }
  if (pair.has("water") && pair.has("ice")) {
    return { kind: "transformed", surface: { ...base, type: "ice" } };
  }
  if (pair.has("lightning") && (pair.has("water") || pair.has("ice"))) {
    return {
      kind: "transformed",
      surface: {
        ...base,
        type: "lightning",
        intensity: clampIntensity(Math.max(2, base.intensity)),
      },
    };
  }

  return {
    kind: "transformed",
    surface: { ...base, type: incoming.type },
  };
}

export function applySurface(
  grid: TacticalGrid,
  incoming: SurfaceState,
): { grid: TacticalGrid; transform: SurfaceTransformResult } {
  if (!isInsideGrid(incoming, grid)) {
    return {
      grid,
      transform: { kind: "extinguished", surface: null },
    };
  }
  const existing = surfaceAt(grid, incoming);
  const transform = transformSurface(existing, incoming);
  const surfaces = grid.surfaces.filter(
    (surface) => !samePoint(surface, incoming),
  );
  if (transform.surface) surfaces.push(transform.surface);
  return {
    grid: { ...grid, surfaces: sortPoints(surfaces) },
    transform,
  };
}

export function tickSurfaceDurations(grid: TacticalGrid): TacticalGrid {
  return {
    ...grid,
    surfaces: grid.surfaces.flatMap((surface) => {
      if (surface.duration === null) return [{ ...surface }];
      if (surface.duration <= 1) return [];
      return [{ ...surface, duration: surface.duration - 1 }];
    }),
  };
}

export function surfaceEffectForPhase(
  surface: SurfaceState | null,
  phase: SurfacePhase,
): SurfaceEffect {
  if (!surface) return emptySurfaceEffect();
  if (surface.type === "fire") {
    return {
      damage: surface.intensity * (phase === "end-turn" ? 3 : 2),
      damageType: "fire",
      conditions: phase === "end-turn" ? ["burning"] : [],
      movementCost: 1,
      save: null,
    };
  }
  if (surface.type === "water") {
    return {
      damage: 0,
      damageType: null,
      conditions: ["wet"],
      movementCost: 2,
      save: null,
    };
  }
  if (surface.type === "ice") {
    return {
      damage: 0,
      damageType: null,
      conditions: [],
      movementCost: 2,
      save: {
        ability: "dexterity",
        dc: 10 + surface.intensity,
        onFailure: "prone",
      },
    };
  }
  return {
    damage: surface.intensity * (phase === "end-turn" ? 3 : 2),
    damageType: "lightning",
    conditions: ["shocked"],
    movementCost: 1,
    save: null,
  };
}

export function surfaceEffectAt(
  grid: TacticalGrid,
  point: GridPoint,
  phase: SurfacePhase,
): SurfaceEffect {
  return surfaceEffectForPhase(surfaceAt(grid, point), phase);
}

export function interactWithObject(
  grid: TacticalGrid,
  input: {
    objectId: string;
    action: TacticalObjectAction;
    amount?: number;
    damageType?: string;
    checkTotal?: number;
  },
): TacticalObjectInteractionResult {
  const object = grid.objects.find(
    (candidate) => candidate.id === input.objectId,
  );
  if (!object) return failure("object_not_found", { objectId: input.objectId });
  if (isObjectDestroyed(object) && input.action !== "damage") {
    return failure("object_destroyed", { object: object.name });
  }

  if (
    input.action === "open" ||
    input.action === "close" ||
    input.action === "toggle"
  ) {
    return interactWithDoor(grid, object, input.action);
  }
  if (input.action === "damage") {
    return damageObject(grid, object, input.amount, input.damageType);
  }
  if (input.action === "ignite") {
    return igniteBarrel(grid, object);
  }
  if (input.action === "trigger") {
    return triggerTrap(grid, object);
  }
  if (input.action === "disarm") {
    return disarmTrap(grid, object, input.checkTotal);
  }
  return failure("invalid_interaction");
}

export function visibilityBetween(
  grid: TacticalGrid,
  observer: StealthActor,
  target: StealthActor,
): VisibilityResult {
  const distance = gridDistance(observer.position, target.position);
  if (observer.id === target.id) {
    return {
      visible: true,
      reason: "self",
      distance,
      perceptionDC: null,
      observerScore: observer.perception,
    };
  }
  const visionRange = Math.max(0, observer.visionRange ?? 12);
  if (distance > visionRange) {
    return {
      visible: false,
      reason: "out-of-range",
      distance,
      perceptionDC: null,
      observerScore: observer.perception,
    };
  }
  if (!lineOfSight(grid, observer.position, target.position).visible) {
    return {
      visible: false,
      reason: "line-of-sight",
      distance,
      perceptionDC: null,
      observerScore: observer.perception,
    };
  }
  if (!target.hidden) {
    return {
      visible: true,
      reason: "visible",
      distance,
      perceptionDC: null,
      observerScore: observer.perception,
    };
  }

  const cover = coverBetween(grid, observer.position, target.position);
  const coverStealthBonus =
    cover.level === "half" ? 2 : cover.level === "three-quarters" ? 5 : 0;
  const rangeStealthBonus = Math.floor(distance / 6);
  const highGroundBonus = Math.max(
    0,
    Math.floor(
      (elevationAt(grid, target.position) -
        elevationAt(grid, observer.position)) /
        2,
    ),
  );
  const perceptionDC =
    target.stealth + coverStealthBonus + rangeStealthBonus + highGroundBonus;
  const visible = observer.perception >= perceptionDC;
  return {
    visible,
    reason: visible ? "visible" : "hidden",
    distance,
    perceptionDC,
    observerScore: observer.perception,
  };
}

export function visibleActorsForObserver(
  grid: TacticalGrid,
  observer: StealthActor,
  actors: StealthActor[],
): StealthActor[] {
  return actors.filter(
    (actor) => visibilityBetween(grid, observer, actor).visible,
  );
}

/**
 * Defenders who fail to see every initiating attacker are surprised. This
 * keeps the decision deterministic while still allowing one alert defender
 * to avoid surprise independently of the rest of the group.
 */
export function determineSurprise(
  grid: TacticalGrid,
  actors: StealthActor[],
  initiatingIds: string[],
): SurpriseResult {
  const initiatorSet = new Set(initiatingIds);
  const initiators = actors.filter((actor) => initiatorSet.has(actor.id));
  const defenders = actors.filter((actor) => !initiatorSet.has(actor.id));
  if (initiators.length === 0) return { surprisedIds: [], detections: [] };
  const detections = defenders.flatMap((observer) =>
    initiators.map((initiator) => ({
      observerId: observer.id,
      initiatorId: initiator.id,
      visible: visibilityBetween(grid, observer, initiator).visible,
    })),
  );
  const surprisedIds = defenders
    .filter((defender) =>
      detections
        .filter((detection) => detection.observerId === defender.id)
        .every((detection) => !detection.visible),
    )
    .map((defender) => defender.id)
    .sort();
  return { surprisedIds, detections };
}

export function invalidActionReason(
  code: TacticalFailureCode,
  context: Record<string, string | number> = {},
): string {
  switch (code) {
    case "outside_grid":
      return "Das Ziel liegt ausserhalb der Karte.";
    case "blocked_tile":
      return "Dieses Feld ist blockiert.";
    case "occupied_tile":
      return "Dieses Feld ist bereits besetzt.";
    case "no_line_of_sight":
      return "Es besteht keine freie Sichtlinie zum Ziel.";
    case "full_cover":
      return "Das Ziel befindet sich in vollständiger Deckung.";
    case "out_of_range":
      return `Das Ziel ist ausser Reichweite${context.range !== undefined ? ` (maximal ${context.range} Felder)` : ""}.`;
    case "not_adjacent":
      return "Das Ziel muss angrenzend sein.";
    case "invalid_distance":
      return "Die Bewegungsdistanz muss mindestens ein Feld betragen.";
    case "invalid_direction":
      return "Für diese Bewegung fehlt eine gültige Richtung.";
    case "insufficient_force":
      return "Das Ziel widersteht dem Schub.";
    case "object_not_found":
      return `Das interaktive Objekt${context.objectId ? ` ${context.objectId}` : ""} wurde nicht gefunden.`;
    case "invalid_interaction":
      return "Diese Aktion ist für das gewählte Objekt nicht möglich.";
    case "object_destroyed":
      return `${context.object ?? "Das Objekt"} ist bereits zerstört.`;
    case "object_locked":
      return `${context.object ?? "Die Tür"} ist verschlossen.`;
    case "door_already_open":
      return "Die Tür ist bereits offen.";
    case "door_already_closed":
      return "Die Tür ist bereits geschlossen.";
    case "trap_inactive":
      return "Die Falle ist nicht mehr aktiv.";
    case "invalid_damage":
      return "Der Schaden muss grösser als null sein.";
    case "target_hidden":
      return "Das Ziel ist für diesen Charakter nicht sichtbar.";
  }
}

function interactWithDoor(
  grid: TacticalGrid,
  object: TacticalObject,
  action: "open" | "close" | "toggle",
): TacticalObjectInteractionResult {
  if (object.kind !== "door") return failure("invalid_interaction");
  const resolvedAction =
    action === "toggle" ? (object.state === "open" ? "close" : "open") : action;
  if (resolvedAction === "open") {
    if (object.state === "locked") {
      return failure("object_locked", { object: object.name });
    }
    if (object.state === "open") return failure("door_already_open");
    const next = { ...object, state: "open" as const };
    return objectSuccess(grid, next, [
      { type: "door_opened", objectId: object.id },
    ]);
  }
  if (object.state === "open") {
    const next = { ...object, state: "closed" as const };
    return objectSuccess(grid, next, [
      { type: "door_closed", objectId: object.id },
    ]);
  }
  return failure("door_already_closed");
}

function damageObject(
  grid: TacticalGrid,
  object: TacticalObject,
  amount: number | undefined,
  damageType: string | undefined,
): TacticalObjectInteractionResult {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return failure("invalid_damage");
  }
  if (isObjectDestroyed(object)) {
    return failure("object_destroyed", { object: object.name });
  }
  const damage = Math.floor(amount);
  const hp = Math.max(0, object.hp - damage);
  const destroyed = hp === 0;
  const next: TacticalObject = {
    ...object,
    hp,
    ...(destroyed ? { state: "destroyed" as const } : {}),
  };
  const events: TacticalObjectEvent[] = [
    { type: "object_damaged", objectId: object.id, damage },
  ];
  if (destroyed) events.push({ type: "object_destroyed", objectId: object.id });
  let nextGrid = replaceObject(grid, next);

  if (destroyed && object.kind === "barrel") {
    const type = object.content === "water" ? "water" : "fire";
    const applied = applySurface(nextGrid, {
      x: object.x,
      y: object.y,
      type,
      intensity: object.content === "volatile" ? 3 : 2,
      duration: type === "fire" ? 3 : null,
      sourceId: object.id,
    });
    nextGrid = applied.grid;
  }
  if (destroyed && object.kind === "trap" && object.state === "armed") {
    events.push(trapEvent(object));
  }
  if (damageType === "fire" && !destroyed && object.kind === "barrel") {
    return igniteBarrel(nextGrid, next);
  }
  return {
    ok: true,
    grid: nextGrid,
    object: next,
    events,
    outcome: "success",
  };
}

function igniteBarrel(
  grid: TacticalGrid,
  object: TacticalObject,
): TacticalObjectInteractionResult {
  if (
    object.kind !== "barrel" ||
    object.content === "water" ||
    object.content === "empty"
  ) {
    return failure("invalid_interaction");
  }
  if (isObjectDestroyed(object)) {
    return failure("object_destroyed", { object: object.name });
  }
  const next = { ...object, hp: 0, state: "destroyed" as const };
  const withObject = replaceObject(grid, next);
  const applied = applySurface(withObject, {
    x: object.x,
    y: object.y,
    type: "fire",
    intensity: object.content === "volatile" ? 3 : 2,
    duration: 3,
    sourceId: object.id,
  });
  return {
    ok: true,
    grid: applied.grid,
    object: next,
    events: [
      { type: "barrel_ignited", objectId: object.id },
      { type: "object_destroyed", objectId: object.id },
    ],
    outcome: "success",
  };
}

function triggerTrap(
  grid: TacticalGrid,
  object: TacticalObject,
): TacticalObjectInteractionResult {
  if (object.kind !== "trap") return failure("invalid_interaction");
  if (object.state !== "armed") return failure("trap_inactive");
  const next = { ...object, state: "triggered" as const };
  return objectSuccess(grid, next, [trapEvent(object)]);
}

function disarmTrap(
  grid: TacticalGrid,
  object: TacticalObject,
  checkTotal: number | undefined,
): TacticalObjectInteractionResult {
  if (object.kind !== "trap") return failure("invalid_interaction");
  if (object.state !== "armed") return failure("trap_inactive");
  const succeeded =
    typeof checkTotal === "number" && checkTotal >= (object.disarmDC ?? 10);
  const next = {
    ...object,
    state: succeeded ? ("disarmed" as const) : ("triggered" as const),
  };
  return {
    ok: true,
    grid: replaceObject(grid, next),
    object: next,
    events: succeeded
      ? [{ type: "trap_disarmed", objectId: object.id }]
      : [trapEvent(object)],
    outcome: succeeded ? "success" : "failed-check",
  };
}

function trapEvent(object: TacticalObject): TacticalObjectEvent {
  return {
    type: "trap_triggered",
    objectId: object.id,
    damage: object.trapDamage ?? 4,
    damageType: object.trapDamageType ?? "piercing",
    ...(object.trapCondition ? { condition: object.trapCondition } : {}),
  };
}

function objectSuccess(
  grid: TacticalGrid,
  object: TacticalObject,
  events: TacticalObjectEvent[],
): TacticalObjectInteractionResult {
  return {
    ok: true,
    grid: replaceObject(grid, object),
    object,
    events,
    outcome: "success",
  };
}

function replaceObject(
  grid: TacticalGrid,
  object: TacticalObject,
): TacticalGrid {
  return {
    ...grid,
    objects: grid.objects
      .map((candidate) => (candidate.id === object.id ? object : candidate))
      .sort(compareObjects),
  };
}

function coverResult(level: CoverLevel, sources: string[]): CoverResult {
  if (level === "full") {
    return {
      level,
      acBonus: null,
      dexteritySaveBonus: null,
      sources,
    };
  }
  const bonus = level === "half" ? 2 : level === "three-quarters" ? 5 : 0;
  return {
    level,
    acBonus: bonus,
    dexteritySaveBonus: bonus,
    sources,
  };
}

function coverCellAt(grid: TacticalGrid, point: GridPoint): CoverCell {
  return (
    grid.coverCells.find((cell) => samePoint(cell, point)) ?? {
      ...point,
      level: "none",
    }
  );
}

function coverEdgesCrossed(
  grid: TacticalGrid,
  from: GridPoint,
  to: GridPoint,
): CoverEdge[] {
  const candidates: Array<{
    point: GridPoint;
    direction: CardinalDirection;
  }> = [];
  if (to.x > from.x) {
    candidates.push(
      { point: from, direction: "east" },
      { point: to, direction: "west" },
    );
  } else if (to.x < from.x) {
    candidates.push(
      { point: from, direction: "west" },
      { point: to, direction: "east" },
    );
  }
  if (to.y > from.y) {
    candidates.push(
      { point: from, direction: "south" },
      { point: to, direction: "north" },
    );
  } else if (to.y < from.y) {
    candidates.push(
      { point: from, direction: "north" },
      { point: to, direction: "south" },
    );
  }
  return grid.coverEdges.filter((edge) =>
    candidates.some(
      (candidate) =>
        samePoint(edge, candidate.point) &&
        edge.direction === candidate.direction,
    ),
  );
}

function emptySurfaceEffect(): SurfaceEffect {
  return {
    damage: 0,
    damageType: null,
    conditions: [],
    movementCost: 1,
    save: null,
  };
}

function failure(
  code: TacticalFailureCode,
  context?: Record<string, string | number>,
): TacticalRuleFailure {
  return { ok: false, code, reason: invalidActionReason(code, context) };
}

function normalizeElevations(
  value: unknown,
  bounds: Pick<TacticalGrid, "columns" | "rows">,
): ElevationCell[] {
  const cells = entriesWithCoordinates(value).flatMap(
    ({ point, value: raw }) => {
      const record = asRecord(raw);
      const elevation =
        finiteInteger(record.elevation) ??
        finiteInteger(record.height) ??
        finiteInteger(record.z) ??
        finiteInteger(raw);
      return elevation === undefined ? [] : [{ ...point, elevation }];
    },
  );
  return uniqueByPoint(cells.filter((cell) => isInsideGrid(cell, bounds)));
}

function normalizeCoverCells(
  value: unknown,
  bounds: Pick<TacticalGrid, "columns" | "rows">,
): CoverCell[] {
  const cells = entriesWithCoordinates(value).flatMap(
    ({ point, value: raw }) => {
      const record = asRecord(raw);
      const level = coverLevel(record.level ?? record.cover ?? raw);
      return level === "none" ? [] : [{ ...point, level }];
    },
  );
  return uniqueByPoint(cells.filter((cell) => isInsideGrid(cell, bounds)));
}

function normalizeCoverEdges(
  value: unknown,
  bounds: Pick<TacticalGrid, "columns" | "rows">,
): CoverEdge[] {
  if (!Array.isArray(value)) return [];
  const edges = value.flatMap((raw) => {
    const record = asRecord(raw);
    const point = pointFrom(record);
    const direction = cardinalDirection(record.direction ?? record.edge);
    const level = coverLevel(record.level ?? record.cover);
    if (!point || !direction || level === "none") return [];
    return [{ ...point, direction, level } satisfies CoverEdge];
  });
  return [
    ...new Map(
      edges
        .filter((edge) => isInsideGrid(edge, bounds))
        .map((edge) => [`${pointKey(edge)}:${edge.direction}`, edge]),
    ).values(),
  ].sort(compareCoverEdges);
}

function normalizeTerrain(
  value: unknown,
  bounds: Pick<TacticalGrid, "columns" | "rows">,
): TerrainCell[] {
  const cells = entriesWithCoordinates(value).flatMap(
    ({ point, value: raw }) => {
      const record = asRecord(raw);
      const kind = terrainKind(record.kind ?? record.type ?? raw);
      if (!kind || kind === "normal") return [];
      const movementCost = Math.max(
        1,
        finiteInteger(record.movementCost) ?? DEFAULT_TERRAIN_COST[kind],
      );
      return [{ ...point, kind, movementCost }];
    },
  );
  return uniqueByPoint(cells.filter((cell) => isInsideGrid(cell, bounds)));
}

function normalizeSurfaces(
  value: unknown,
  bounds: Pick<TacticalGrid, "columns" | "rows">,
): SurfaceState[] {
  const cells = entriesWithCoordinates(value).flatMap(
    ({ point, value: raw }) => {
      const record = asRecord(raw);
      const type = surfaceType(record.type ?? record.surface ?? raw);
      if (!type) return [];
      const durationValue = finiteInteger(record.duration);
      const sourceId = nonEmptyString(record.sourceId);
      return [
        {
          ...point,
          type,
          intensity: clampIntensity(finiteInteger(record.intensity) ?? 1),
          duration:
            durationValue === undefined ? null : Math.max(0, durationValue),
          ...(sourceId ? { sourceId } : {}),
        },
      ];
    },
  );
  return uniqueByPoint(cells.filter((cell) => isInsideGrid(cell, bounds)));
}

function normalizeObjects(
  value: unknown,
  bounds: Pick<TacticalGrid, "columns" | "rows">,
): TacticalObject[] {
  if (!Array.isArray(value)) return [];
  const objects = value.flatMap((raw, index) => {
    const record = asRecord(raw);
    const point = pointFrom(record);
    const kind = tacticalObjectKind(record.kind ?? record.type);
    if (!point || !kind || !isInsideGrid(point, bounds)) return [];
    const id =
      nonEmptyString(record.id) ?? `${kind}-${point.x}-${point.y}-${index}`;
    const maxHp = Math.max(
      1,
      finiteInteger(record.maxHp) ?? defaultObjectHp(kind),
    );
    const hp = Math.max(0, Math.min(maxHp, finiteInteger(record.hp) ?? maxHp));
    const state = normalizeObjectState(kind, record.state, hp);
    const content = barrelContent(record.content);
    const name = nonEmptyString(record.name) ?? defaultObjectName(kind);
    return [
      {
        ...point,
        id,
        name,
        kind,
        state,
        hp,
        maxHp,
        blocksMovement:
          booleanValue(record.blocksMovement) ?? defaultMovementBlocking(kind),
        blocksSight:
          booleanValue(record.blocksSight) ?? defaultSightBlocking(kind),
        armorClass: Math.max(1, finiteInteger(record.armorClass) ?? 10),
        ...(kind === "barrel" ? { content: content ?? "oil" } : {}),
        ...(kind === "trap"
          ? {
              detected: booleanValue(record.detected) ?? false,
              disarmDC: Math.max(1, finiteInteger(record.disarmDC) ?? 10),
              trapDamage: Math.max(0, finiteInteger(record.trapDamage) ?? 4),
              trapDamageType:
                nonEmptyString(record.trapDamageType) ?? "piercing",
              ...(nonEmptyString(record.trapCondition)
                ? { trapCondition: nonEmptyString(record.trapCondition) }
                : {}),
            }
          : {}),
      } satisfies TacticalObject,
    ];
  });
  return [
    ...new Map(objects.map((object) => [object.id, object])).values(),
  ].sort(compareObjects);
}

function entriesWithCoordinates(
  value: unknown,
): Array<{ point: GridPoint; value: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((raw) => {
      const point = pointFrom(raw);
      return point ? [{ point, value: raw }] : [];
    });
  }
  const record = asRecord(value);
  return Object.entries(record).flatMap(([key, raw]) => {
    const point = pointFromKey(key);
    return point ? [{ point, value: raw }] : [];
  });
}

function pointsFrom(value: unknown): GridPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const record = asRecord(raw);
    if (Array.isArray(record.cells)) return pointsFrom(record.cells);
    const point = pointFrom(raw);
    if (!point) return [];
    const width =
      positiveInteger(record.width) ?? positiveInteger(record.w) ?? 1;
    const height =
      positiveInteger(record.height) ?? positiveInteger(record.h) ?? 1;
    const points: GridPoint[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        points.push({ x: point.x + x, y: point.y + y });
      }
    }
    return points;
  });
}

function pointFrom(value: unknown): GridPoint | null {
  if (typeof value === "string") return pointFromKey(value);
  if (Array.isArray(value)) {
    const x = finiteInteger(value[0]);
    const y = finiteInteger(value[1]);
    return x === undefined || y === undefined ? null : { x, y };
  }
  const record = asRecord(value);
  const x = finiteInteger(record.x);
  const y = finiteInteger(record.y);
  return x === undefined || y === undefined ? null : { x, y };
}

function pointFromKey(key: string): GridPoint | null {
  const match = key.trim().match(/^(-?\d+)\s*[:,]\s*(-?\d+)$/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function coverLevel(value: unknown): CoverLevel {
  if (typeof value === "number") {
    if (value >= 1) return "full";
    if (value >= 0.75) return "three-quarters";
    if (value > 0) return "half";
    return "none";
  }
  if (typeof value !== "string") return "none";
  const normalized = value.toLowerCase().trim().replaceAll("_", "-");
  if (normalized === "half" || normalized === "partial") return "half";
  if (
    normalized === "three-quarters" ||
    normalized === "threequarters" ||
    normalized === "heavy"
  ) {
    return "three-quarters";
  }
  if (normalized === "full" || normalized === "total") return "full";
  return "none";
}

function cardinalDirection(value: unknown): CardinalDirection | null {
  if (typeof value !== "string") return null;
  switch (value.toLowerCase().trim()) {
    case "n":
    case "north":
      return "north";
    case "e":
    case "east":
      return "east";
    case "s":
    case "south":
      return "south";
    case "w":
    case "west":
      return "west";
    default:
      return null;
  }
}

function terrainKind(value: unknown): TerrainKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  return normalized === "normal" ||
    normalized === "difficult" ||
    normalized === "mud" ||
    normalized === "rubble"
    ? normalized
    : null;
}

function surfaceType(value: unknown): SurfaceType | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  return normalized === "fire" ||
    normalized === "water" ||
    normalized === "ice" ||
    normalized === "lightning"
    ? normalized
    : null;
}

function tacticalObjectKind(value: unknown): TacticalObjectKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  return normalized === "door" ||
    normalized === "barrel" ||
    normalized === "trap" ||
    normalized === "destructible"
    ? normalized
    : null;
}

function barrelContent(value: unknown): BarrelContent | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  return normalized === "oil" ||
    normalized === "water" ||
    normalized === "volatile" ||
    normalized === "empty"
    ? normalized
    : null;
}

function normalizeObjectState(
  kind: TacticalObjectKind,
  raw: unknown,
  hp: number,
): TacticalObjectState {
  if (hp <= 0) return "destroyed";
  if (typeof raw === "string") {
    const state = raw.toLowerCase().trim();
    if (
      state === "open" ||
      state === "closed" ||
      state === "locked" ||
      state === "intact" ||
      state === "armed" ||
      state === "disarmed" ||
      state === "triggered" ||
      state === "destroyed"
    ) {
      return state;
    }
  }
  if (kind === "door") return "closed";
  if (kind === "trap") return "armed";
  return "intact";
}

function defaultObjectHp(kind: TacticalObjectKind): number {
  if (kind === "door") return 15;
  if (kind === "barrel") return 6;
  if (kind === "trap") return 1;
  return 10;
}

function defaultMovementBlocking(kind: TacticalObjectKind): boolean {
  return kind === "door" || kind === "barrel" || kind === "destructible";
}

function defaultSightBlocking(kind: TacticalObjectKind): boolean {
  return kind === "door" || kind === "destructible";
}

function defaultObjectName(kind: TacticalObjectKind): string {
  if (kind === "door") return "Tür";
  if (kind === "barrel") return "Fass";
  if (kind === "trap") return "Falle";
  return "Hindernis";
}

function samePoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function uniquePoints(points: GridPoint[]): GridPoint[] {
  return [
    ...new Map(points.map((point) => [pointKey(point), point])).values(),
  ].sort(comparePoints);
}

function uniqueByPoint<T extends GridPoint>(items: T[]): T[] {
  return [
    ...new Map(items.map((item) => [pointKey(item), item])).values(),
  ].sort(comparePoints);
}

function sortPoints<T extends GridPoint>(points: T[]): T[] {
  return [...points].sort(comparePoints);
}

function comparePoints(a: GridPoint, b: GridPoint): number {
  return a.y - b.y || a.x - b.x;
}

function compareObjects(a: TacticalObject, b: TacticalObject): number {
  return comparePoints(a, b) || a.id.localeCompare(b.id);
}

function compareCoverEdges(a: CoverEdge, b: CoverEdge): number {
  return comparePoints(a, b) || a.direction.localeCompare(b.direction);
}

function clampIntensity(value: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(3, Math.floor(value))) as 1 | 2 | 3;
}

function maxDuration(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value)
    ? value
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
