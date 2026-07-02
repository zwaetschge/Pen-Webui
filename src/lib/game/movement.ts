export const TACTICAL_MAP_COLUMNS = 16;
export const TACTICAL_MAP_ROWS = 16;
export const DEFAULT_TOKEN_MOVEMENT = 6;

const ORTHOGONAL_DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

export type MovementTeam = "player" | "monster" | "npc";

export type MovementToken = {
  id: string;
  name?: string | null;
  x: number;
  y: number;
  hp?: number | null;
  maxHp?: number | null;
  ac?: number | null;
  team?: MovementTeam | null;
  movement?: number | null;
  attackBonus?: number | null;
  damageDice?: string | null;
  damageType?: string | null;
  attackRange?: number | null;
};

export type MovementTile = {
  x: number;
  y: number;
  cost: number;
};

export type MovementGrid = {
  columns?: number;
  rows?: number;
  blocked?: Array<{ x: number; y: number }>;
};

export function tileKey(tile: { x: number; y: number }): string {
  return `${tile.x}:${tile.y}`;
}

export function tokenMovement(token: MovementToken): number {
  if (typeof token.movement !== "number" || !Number.isFinite(token.movement)) {
    return DEFAULT_TOKEN_MOVEMENT;
  }
  return Math.max(0, Math.floor(token.movement));
}

export function isInsideTacticalGrid(
  tile: { x: number; y: number },
  grid: MovementGrid = {},
): boolean {
  const columns = grid.columns ?? TACTICAL_MAP_COLUMNS;
  const rows = grid.rows ?? TACTICAL_MAP_ROWS;
  return tile.x >= 0 && tile.y >= 0 && tile.x < columns && tile.y < rows;
}

export function normalizeMovementGrid(
  value: unknown,
): MovementGrid | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const columns =
    positiveInteger(record.columns) ?? positiveInteger(record.cols);
  const rows = positiveInteger(record.rows);
  const blocked = [
    ...blockedTilesFrom(record.blocked),
    ...blockedTilesFrom(record.blockedTiles),
    ...blockedTilesFrom(record.obstacles),
    ...blockedTilesFrom(record.walls),
  ];
  const grid: MovementGrid = {};
  if (columns) grid.columns = columns;
  if (rows) grid.rows = rows;
  if (blocked.length > 0) {
    const unique = new Map(blocked.map((tile) => [tileKey(tile), tile]));
    grid.blocked = [...unique.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  }
  return Object.keys(grid).length > 0 ? grid : undefined;
}

export function blockedTilesForGrid(grid: MovementGrid = {}): MovementTile[] {
  const blocked = grid.blocked ?? [];
  return blocked
    .filter((tile) => isInsideTacticalGrid(tile, grid))
    .map((tile) => ({ x: tile.x, y: tile.y, cost: 0 }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function movementRangeForToken(
  tokenId: string,
  tokens: MovementToken[],
  grid: MovementGrid = {},
): MovementTile[] {
  const selected = tokens.find((token) => token.id === tokenId);
  if (!selected) return [];

  const occupiedDestinations = new Set<string>();
  const pathBlockers = new Set<string>();
  const blockedTiles = new Set(
    blockedTilesForGrid(grid).map((tile) => tileKey(tile)),
  );
  for (const token of tokens) {
    if (token.id === selected.id) continue;
    const key = tileKey(token);
    occupiedDestinations.add(key);
    if (token.team !== selected.team) {
      pathBlockers.add(key);
    }
  }

  const allowance = tokenMovement(selected);
  const startKey = tileKey(selected);
  blockedTiles.delete(startKey);
  const seen = new Map<string, MovementTile>([
    [startKey, { x: selected.x, y: selected.y, cost: 0 }],
  ]);
  const queue: MovementTile[] = [{ x: selected.x, y: selected.y, cost: 0 }];

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    for (const direction of ORTHOGONAL_DIRECTIONS) {
      const next = {
        x: current.x + direction.x,
        y: current.y + direction.y,
      };
      const nextCost = current.cost + 1;
      const key = tileKey(next);
      if (nextCost > allowance) continue;
      if (!isInsideTacticalGrid(next, grid)) continue;
      if (blockedTiles.has(key)) continue;
      if (pathBlockers.has(key)) continue;

      const previous = seen.get(key);
      if (previous && previous.cost <= nextCost) continue;

      const tile = { ...next, cost: nextCost };
      seen.set(key, tile);
      queue.push(tile);
    }
  }

  return [...seen.values()]
    .filter((tile) => tile.cost > 0 && !occupiedDestinations.has(tileKey(tile)))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function freeMovementTilesForToken(
  tokenId: string,
  tokens: MovementToken[],
  grid: MovementGrid = {},
): MovementTile[] {
  const selected = tokens.find((token) => token.id === tokenId);
  if (!selected) return [];

  const columns = grid.columns ?? TACTICAL_MAP_COLUMNS;
  const rows = grid.rows ?? TACTICAL_MAP_ROWS;
  const blockedTiles = new Set(
    blockedTilesForGrid(grid).map((tile) => tileKey(tile)),
  );
  const occupiedDestinations = new Set(
    tokens
      .filter((token) => token.id !== selected.id)
      .map((token) => tileKey(token)),
  );
  const startKey = tileKey(selected);
  const tiles: MovementTile[] = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const key = tileKey({ x, y });
      if (key === startKey) continue;
      if (blockedTiles.has(key) || occupiedDestinations.has(key)) continue;
      tiles.push({
        x,
        y,
        cost: Math.abs(selected.x - x) + Math.abs(selected.y - y),
      });
    }
  }

  return tiles.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function freeMovementCostForTokenMove(
  tokenId: string,
  tokens: MovementToken[],
  destination: { x: number; y: number },
  grid: MovementGrid = {},
): number | null {
  const tile = freeMovementTilesForToken(tokenId, tokens, grid).find(
    (candidate) =>
      candidate.x === destination.x && candidate.y === destination.y,
  );
  return tile?.cost ?? null;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function blockedTilesFrom(value: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const expanded = expandedObstacle(item);
    return expanded.length > 0 ? expanded : tileFrom(item);
  });
}

function expandedObstacle(value: unknown): Array<{ x: number; y: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.cells)) return blockedTilesFrom(record.cells);
  const x = integer(record.x);
  const y = integer(record.y);
  if (x === undefined || y === undefined) return [];
  const width = positiveInteger(record.width) ?? positiveInteger(record.w) ?? 1;
  const height =
    positiveInteger(record.height) ?? positiveInteger(record.h) ?? 1;
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      tiles.push({ x: x + dx, y: y + dy });
    }
  }
  return tiles;
}

function tileFrom(value: unknown): Array<{ x: number; y: number }> {
  if (typeof value === "string") {
    const match = value.trim().match(/^(-?\d+)\s*[:,]\s*(-?\d+)$/);
    if (!match) return [];
    return [{ x: Number(match[1]), y: Number(match[2]) }];
  }
  if (Array.isArray(value)) {
    const x = integer(value[0]);
    const y = integer(value[1]);
    return x === undefined || y === undefined ? [] : [{ x, y }];
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const x = integer(record.x);
  const y = integer(record.y);
  return x === undefined || y === undefined ? [] : [{ x, y }];
}

export function movementCostForTokenMove(
  tokenId: string,
  tokens: MovementToken[],
  destination: { x: number; y: number },
  grid: MovementGrid = {},
): number | null {
  const tile = movementRangeForToken(tokenId, tokens, grid).find(
    (candidate) =>
      candidate.x === destination.x && candidate.y === destination.y,
  );
  return tile?.cost ?? null;
}
