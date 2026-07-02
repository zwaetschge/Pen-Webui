import { describe, expect, it } from "vitest";
import {
  blockedTilesForGrid,
  freeMovementCostForTokenMove,
  freeMovementTilesForToken,
  movementCostForTokenMove,
  movementRangeForToken,
  normalizeMovementGrid,
  tileKey,
  tokenMovement,
  type MovementToken,
} from "./movement";

function keys(tiles: Array<{ x: number; y: number }>) {
  return new Set(tiles.map(tileKey));
}

describe("tactical movement", () => {
  it("uses orthogonal movement distance on the grid", () => {
    const tokens: MovementToken[] = [
      { id: "hero", x: 2, y: 2, team: "player", movement: 2 },
    ];

    const range = movementRangeForToken("hero", tokens, {
      columns: 6,
      rows: 6,
    });

    expect(range).toHaveLength(12);
    expect(keys(range)).toContain("4:2");
    expect(keys(range)).toContain("2:4");
    expect(keys(range)).not.toContain("4:4");
    expect(movementCostForTokenMove("hero", tokens, { x: 4, y: 2 })).toBe(2);
  });

  it("blocks occupied destinations but allows passing through same-team units", () => {
    const tokens: MovementToken[] = [
      { id: "hero", x: 0, y: 0, team: "player", movement: 2 },
      { id: "ally", x: 1, y: 0, team: "player", movement: 2 },
    ];

    const range = movementRangeForToken("hero", tokens, {
      columns: 4,
      rows: 4,
    });
    const reachable = keys(range);

    expect(reachable).not.toContain("1:0");
    expect(reachable).toContain("2:0");
  });

  it("blocks movement through opposing-team units", () => {
    const tokens: MovementToken[] = [
      { id: "hero", x: 0, y: 0, team: "player", movement: 2 },
      { id: "goblin", x: 1, y: 0, team: "monster", movement: 2 },
    ];

    const reachable = keys(
      movementRangeForToken("hero", tokens, { columns: 4, rows: 4 }),
    );

    expect(reachable).not.toContain("1:0");
    expect(reachable).not.toContain("2:0");
    expect(reachable).toContain("0:2");
  });

  it("blocks configured obstacle cells", () => {
    const tokens: MovementToken[] = [
      { id: "hero", x: 0, y: 0, team: "player", movement: 3 },
    ];
    const grid = {
      columns: 5,
      rows: 5,
      blocked: [{ x: 1, y: 0 }],
    };

    const reachable = keys(movementRangeForToken("hero", tokens, grid));

    expect(reachable).not.toContain("1:0");
    expect(reachable).not.toContain("2:0");
    expect(reachable).toContain("0:3");
    expect(movementCostForTokenMove("hero", tokens, { x: 1, y: 0 }, grid)).toBe(
      null,
    );
  });

  it("allows free exploration movement anywhere valid without movement allowance", () => {
    const tokens: MovementToken[] = [
      { id: "hero", x: 0, y: 0, team: "player", movement: 1 },
      { id: "ally", x: 2, y: 2, team: "player" },
    ];
    const grid = {
      columns: 4,
      rows: 4,
      blocked: [{ x: 1, y: 0 }],
    };
    const reachable = keys(freeMovementTilesForToken("hero", tokens, grid));

    expect(reachable).toContain("3:3");
    expect(reachable).not.toContain("1:0");
    expect(reachable).not.toContain("2:2");
    expect(
      freeMovementCostForTokenMove("hero", tokens, { x: 3, y: 3 }, grid),
    ).toBe(6);
  });

  it("normalizes obstacle shapes from grid config", () => {
    const grid = normalizeMovementGrid({
      columns: 8,
      rows: 8,
      blockedTiles: ["1:2", [2, 2]],
      obstacles: [{ x: 4, y: 1, width: 2, height: 2 }],
    });

    expect(blockedTilesForGrid(grid)).toEqual([
      { x: 4, y: 1, cost: 0 },
      { x: 5, y: 1, cost: 0 },
      { x: 1, y: 2, cost: 0 },
      { x: 2, y: 2, cost: 0 },
      { x: 4, y: 2, cost: 0 },
      { x: 5, y: 2, cost: 0 },
    ]);
  });

  it("falls back to the default six-cell allowance", () => {
    expect(tokenMovement({ id: "hero", x: 0, y: 0 })).toBe(6);
  });
});
