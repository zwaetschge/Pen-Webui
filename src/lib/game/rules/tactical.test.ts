import { describe, expect, it } from "vitest";

import {
  applySurface,
  bresenhamLine,
  coverBetween,
  determineSurprise,
  fallDamageForDrop,
  heightModifierBetween,
  interactWithObject,
  invalidActionReason,
  isCellBlocked,
  lineOfSight,
  movementCostAt,
  normalizeTacticalGrid,
  positionModifiersBetween,
  resolveForcedMovement,
  resolveShove,
  surfaceEffectAt,
  tickSurfaceDurations,
  transformSurface,
  validateTacticalAction,
  visibilityBetween,
  visibleActorsForObserver,
  type StealthActor,
  type SurfaceState,
  type TacticalFailureCode,
  type TacticalGrid,
} from "./tactical";

function grid(input: Record<string, unknown> = {}): TacticalGrid {
  return normalizeTacticalGrid({ columns: 8, rows: 8, ...input });
}

function hiddenActor(
  id: string,
  x: number,
  y: number,
  overrides: Partial<StealthActor> = {},
): StealthActor {
  return {
    id,
    position: { x, y },
    hidden: true,
    stealth: 14,
    perception: 10,
    visionRange: 12,
    ...overrides,
  };
}

describe("tactical grid normalization", () => {
  it("normalizes legacy blocks and all rich tactical layers", () => {
    const normalized = normalizeTacticalGrid({
      cols: 6,
      rows: 5,
      blocked: ["1:1", [1, 1], { x: 2, y: 1, width: 2, height: 2 }],
      obstacles: [
        {
          cells: [
            { x: 0, y: 4 },
            { x: 99, y: 99 },
          ],
        },
      ],
      elevations: { "0:0": 2, "1:0": { height: -1 }, invalid: 7 },
      coverCells: [
        { x: 3, y: 3, level: "three_quarters" },
        { x: 9, y: 9, level: "full" },
      ],
      coverEdges: [
        { x: 1, y: 2, direction: "E", level: "half" },
        { x: 1, y: 2, direction: "east", level: "full" },
      ],
      terrain: [{ x: 4, y: 3, type: "mud", movementCost: 3 }],
      surfaces: [{ x: 5, y: 4, type: "fire", intensity: 9, duration: 2 }],
      objects: [
        { id: "door-a", type: "door", x: 2, y: 4 },
        {
          id: "trap-a",
          type: "trap",
          x: 3,
          y: 4,
          detected: true,
          disarmDC: 13,
        },
      ],
    });

    expect(normalized.columns).toBe(6);
    expect(normalized.rows).toBe(5);
    expect(normalized.blocked).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 0, y: 4 },
    ]);
    expect(normalized.elevations).toEqual([
      { x: 0, y: 0, elevation: 2 },
      { x: 1, y: 0, elevation: -1 },
    ]);
    expect(normalized.coverCells).toEqual([
      { x: 3, y: 3, level: "three-quarters" },
    ]);
    expect(normalized.coverEdges).toEqual([
      { x: 1, y: 2, direction: "east", level: "full" },
    ]);
    expect(normalized.terrain[0]).toEqual({
      x: 4,
      y: 3,
      kind: "mud",
      movementCost: 3,
    });
    expect(normalized.surfaces[0]).toMatchObject({
      x: 5,
      y: 4,
      type: "fire",
      intensity: 3,
      duration: 2,
    });
    expect(normalized.objects).toHaveLength(2);
    expect(normalized.objects[0]).toMatchObject({
      id: "door-a",
      state: "closed",
      hp: 15,
      blocksMovement: true,
    });
    expect(normalized.objects[1]).toMatchObject({
      id: "trap-a",
      state: "armed",
      detected: true,
      disarmDC: 13,
    });
  });

  it("falls back to stable defaults and ignores malformed input", () => {
    const normalized = normalizeTacticalGrid({
      columns: -1,
      rows: "large",
      blocked: [null, "nope", { x: 1.5, y: 2 }],
      objects: [{ type: "chest", x: 1, y: 1 }],
    });
    expect(normalized).toMatchObject({ columns: 16, rows: 16 });
    expect(normalized.blocked).toEqual([]);
    expect(normalized.objects).toEqual([]);
  });

  it("combines terrain and surface movement cost", () => {
    const tacticalGrid = grid({
      terrain: [{ x: 1, y: 1, type: "mud", movementCost: 3 }],
      surfaces: [{ x: 2, y: 2, type: "ice" }],
    });
    expect(movementCostAt(tacticalGrid, { x: 1, y: 1 })).toBe(3);
    expect(movementCostAt(tacticalGrid, { x: 2, y: 2 })).toBe(2);
    expect(movementCostAt(tacticalGrid, { x: 0, y: 0 })).toBe(1);
  });
});

describe("line of sight, cover, and height", () => {
  it("builds stable Bresenham rays in all octants", () => {
    expect(bresenhamLine({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 2 },
    ]);
    expect(bresenhamLine({ x: 2, y: 4 }, { x: 0, y: 0 })).toEqual([
      { x: 2, y: 4 },
      { x: 2, y: 3 },
      { x: 1, y: 2 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ]);
  });

  it("blocks sight through blocked cells and full-cover edges", () => {
    const blockedGrid = grid({ blocked: [{ x: 2, y: 1 }] });
    expect(
      lineOfSight(blockedGrid, { x: 0, y: 1 }, { x: 4, y: 1 }),
    ).toMatchObject({
      visible: false,
      blockedAt: { x: 2, y: 1 },
    });

    const edgeGrid = grid({
      coverEdges: [{ x: 1, y: 1, direction: "east", level: "full" }],
    });
    expect(lineOfSight(edgeGrid, { x: 0, y: 1 }, { x: 4, y: 1 }).visible).toBe(
      false,
    );
  });

  it("lets an opened door stop blocking movement and sight", () => {
    const closedGrid = grid({
      objects: [{ id: "door", type: "door", x: 2, y: 1 }],
    });
    expect(isCellBlocked(closedGrid, { x: 2, y: 1 })).toBe(true);
    expect(
      lineOfSight(closedGrid, { x: 0, y: 1 }, { x: 4, y: 1 }).visible,
    ).toBe(false);

    const result = interactWithObject(closedGrid, {
      objectId: "door",
      action: "open",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isCellBlocked(result.grid, { x: 2, y: 1 })).toBe(false);
    expect(
      lineOfSight(result.grid, { x: 0, y: 1 }, { x: 4, y: 1 }).visible,
    ).toBe(true);
  });

  it("returns cover and high-ground attack modifiers", () => {
    const tacticalGrid = grid({
      elevations: [
        { x: 0, y: 0, elevation: 3 },
        { x: 4, y: 0, elevation: 0 },
      ],
      coverCells: [{ x: 4, y: 0, level: "three-quarters" }],
    });
    expect(
      coverBetween(tacticalGrid, { x: 0, y: 0 }, { x: 4, y: 0 }),
    ).toMatchObject({
      level: "three-quarters",
      acBonus: 5,
    });
    expect(
      heightModifierBetween(tacticalGrid, { x: 0, y: 0 }, { x: 4, y: 0 }),
    ).toEqual({
      difference: 3,
      attackRollModifier: 2,
      label: "high-ground",
    });
    expect(
      positionModifiersBetween(tacticalGrid, { x: 0, y: 0 }, { x: 4, y: 0 })
        .totalAttackRollModifier,
    ).toBe(-3);
  });

  it("treats a blocked ray as full cover", () => {
    const tacticalGrid = grid({ blocked: [{ x: 2, y: 0 }] });
    expect(coverBetween(tacticalGrid, { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual({
      level: "full",
      acBonus: null,
      dexteritySaveBonus: null,
      sources: ["line-of-sight"],
    });
  });
});

describe("action validation and forced movement", () => {
  it("returns readable, stable invalid-action reasons", () => {
    const codes: TacticalFailureCode[] = [
      "outside_grid",
      "blocked_tile",
      "occupied_tile",
      "no_line_of_sight",
      "full_cover",
      "out_of_range",
      "not_adjacent",
      "invalid_distance",
      "invalid_direction",
      "insufficient_force",
      "object_not_found",
      "invalid_interaction",
      "object_destroyed",
      "object_locked",
      "door_already_open",
      "door_already_closed",
      "trap_inactive",
      "invalid_damage",
      "target_hidden",
    ];
    for (const code of codes) {
      expect(invalidActionReason(code).length).toBeGreaterThan(12);
    }
  });

  it("validates bounds, occupancy, range, visibility, and legal attacks", () => {
    const tacticalGrid = grid({ blocked: [{ x: 3, y: 3 }] });
    expect(
      validateTacticalAction(tacticalGrid, {
        from: { x: 1, y: 1 },
        target: { x: 9, y: 1 },
      }),
    ).toMatchObject({ ok: false, code: "outside_grid" });
    expect(
      validateTacticalAction(tacticalGrid, {
        from: { x: 1, y: 1 },
        target: { x: 3, y: 3 },
      }),
    ).toMatchObject({ ok: false, code: "blocked_tile" });
    expect(
      validateTacticalAction(tacticalGrid, {
        from: { x: 1, y: 1 },
        target: { x: 4, y: 1 },
        occupied: [{ x: 4, y: 1 }],
      }),
    ).toMatchObject({ ok: false, code: "occupied_tile" });
    expect(
      validateTacticalAction(tacticalGrid, {
        from: { x: 1, y: 1 },
        target: { x: 4, y: 1 },
        maxRange: 2,
      }),
    ).toMatchObject({ ok: false, code: "out_of_range" });
    expect(
      validateTacticalAction(tacticalGrid, {
        from: { x: 1, y: 1 },
        target: { x: 2, y: 1 },
        maxRange: 2,
      }),
    ).toMatchObject({ ok: true, distance: 1 });
  });

  it("stops forced movement on obstacles and reports a deterministic fall", () => {
    const tacticalGrid = grid({
      blocked: [{ x: 4, y: 1 }],
      elevations: [
        { x: 1, y: 1, elevation: 4 },
        { x: 2, y: 1, elevation: 1 },
      ],
    });
    const result = resolveForcedMovement(tacticalGrid, {
      start: { x: 1, y: 1 },
      direction: { x: 9, y: 0 },
      distance: 5,
    });
    expect(result).toMatchObject({
      ok: true,
      destination: { x: 3, y: 1 },
      distanceMoved: 2,
      collision: "blocked",
      fall: {
        dropLevels: 3,
        feet: 15,
        diceCount: 1,
        dice: "1d6",
        damage: 3,
      },
    });
  });

  it("stops forced movement at occupied cells and map boundaries", () => {
    const tacticalGrid = grid();
    expect(
      resolveForcedMovement(tacticalGrid, {
        start: { x: 1, y: 1 },
        direction: { x: 1, y: 0 },
        distance: 4,
        occupied: [{ x: 3, y: 1 }],
      }),
    ).toMatchObject({
      ok: true,
      destination: { x: 2, y: 1 },
      collision: "occupied",
    });
    expect(
      resolveForcedMovement(tacticalGrid, {
        start: { x: 7, y: 7 },
        direction: { x: 1, y: 1 },
        distance: 1,
      }),
    ).toMatchObject({ ok: true, collision: "boundary", distanceMoved: 0 });
  });

  it("requires adjacency and a winning contest for shove", () => {
    const tacticalGrid = grid();
    expect(
      resolveShove(tacticalGrid, {
        source: { x: 0, y: 0 },
        target: { x: 2, y: 0 },
      }),
    ).toMatchObject({ ok: false, code: "not_adjacent" });
    expect(
      resolveShove(tacticalGrid, {
        source: { x: 0, y: 0 },
        target: { x: 1, y: 0 },
        force: 12,
        resistance: 12,
      }),
    ).toMatchObject({ ok: false, code: "insufficient_force" });
    expect(
      resolveShove(tacticalGrid, {
        source: { x: 0, y: 0 },
        target: { x: 1, y: 0 },
        distance: 2,
        force: 13,
        resistance: 12,
      }),
    ).toMatchObject({
      ok: true,
      destination: { x: 3, y: 0 },
      distanceMoved: 2,
    });
  });

  it("caps and averages fall damage without randomness", () => {
    expect(fallDamageForDrop(1)).toMatchObject({ dice: null, damage: 0 });
    expect(fallDamageForDrop(8)).toMatchObject({
      feet: 40,
      dice: "4d6",
      damage: 12,
    });
    expect(fallDamageForDrop(100)).toMatchObject({
      dice: "20d6",
      damage: 60,
    });
  });
});

describe("surface rules", () => {
  const atOrigin = (
    type: SurfaceState["type"],
    intensity: SurfaceState["intensity"] = 1,
  ): SurfaceState => ({
    x: 1,
    y: 1,
    type,
    intensity,
    duration: 2,
  });

  it.each([
    ["water", "ice", "ice", "transformed"],
    ["water", "lightning", "lightning", "transformed"],
    ["ice", "fire", "water", "transformed"],
    ["fire", "water", null, "extinguished"],
  ] as const)(
    "transforms %s plus %s into %s",
    (existing, incoming, expected, kind) => {
      const result = transformSurface(atOrigin(existing), atOrigin(incoming));
      expect(result.kind).toBe(kind);
      expect(result.surface?.type ?? null).toBe(expected);
    },
  );

  it("intensifies identical surfaces up to the cap", () => {
    expect(transformSurface(atOrigin("fire", 2), atOrigin("fire", 2))).toEqual({
      kind: "intensified",
      surface: {
        x: 1,
        y: 1,
        type: "fire",
        intensity: 3,
        duration: 2,
      },
    });
  });

  it("applies transformations immutably and ticks finite durations", () => {
    const original = grid({
      surfaces: [{ x: 1, y: 1, type: "water", intensity: 1, duration: null }],
    });
    const applied = applySurface(original, atOrigin("ice"));
    expect(original.surfaces[0].type).toBe("water");
    expect(applied.grid.surfaces[0].type).toBe("ice");
    expect(tickSurfaceDurations(original).surfaces[0].duration).toBeNull();

    const finite = grid({
      surfaces: [
        { x: 1, y: 1, type: "fire", duration: 1 },
        { x: 2, y: 1, type: "ice", duration: 2 },
      ],
    });
    expect(tickSurfaceDurations(finite).surfaces).toEqual([
      {
        x: 2,
        y: 1,
        type: "ice",
        intensity: 1,
        duration: 1,
      },
    ]);
  });

  it("returns deterministic enter and end-turn effects", () => {
    const tacticalGrid = grid({
      surfaces: [
        { x: 1, y: 1, type: "fire", intensity: 2 },
        { x: 2, y: 1, type: "ice", intensity: 3 },
        { x: 3, y: 1, type: "lightning", intensity: 1 },
      ],
    });
    expect(
      surfaceEffectAt(tacticalGrid, { x: 1, y: 1 }, "enter"),
    ).toMatchObject({
      damage: 4,
      damageType: "fire",
    });
    expect(
      surfaceEffectAt(tacticalGrid, { x: 1, y: 1 }, "end-turn"),
    ).toMatchObject({ damage: 6, conditions: ["burning"] });
    expect(
      surfaceEffectAt(tacticalGrid, { x: 2, y: 1 }, "enter"),
    ).toMatchObject({
      movementCost: 2,
      save: { ability: "dexterity", dc: 13, onFailure: "prone" },
    });
    expect(
      surfaceEffectAt(tacticalGrid, { x: 3, y: 1 }, "end-turn"),
    ).toMatchObject({ damage: 3, conditions: ["shocked"] });
  });
});

describe("interactive object rules", () => {
  it("rejects locked doors and duplicate door actions", () => {
    const tacticalGrid = grid({
      objects: [
        { id: "locked", type: "door", x: 1, y: 1, state: "locked" },
        { id: "open", type: "door", x: 2, y: 1, state: "open" },
      ],
    });
    expect(
      interactWithObject(tacticalGrid, { objectId: "locked", action: "open" }),
    ).toMatchObject({ ok: false, code: "object_locked" });
    expect(
      interactWithObject(tacticalGrid, { objectId: "open", action: "open" }),
    ).toMatchObject({ ok: false, code: "door_already_open" });
  });

  it("ignites volatile barrels and creates a fire surface", () => {
    const tacticalGrid = grid({
      objects: [
        {
          id: "powder",
          type: "barrel",
          x: 2,
          y: 2,
          content: "volatile",
        },
      ],
    });
    const result = interactWithObject(tacticalGrid, {
      objectId: "powder",
      action: "ignite",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object).toMatchObject({ hp: 0, state: "destroyed" });
    expect(result.grid.surfaces).toEqual([
      {
        x: 2,
        y: 2,
        type: "fire",
        intensity: 3,
        duration: 3,
        sourceId: "powder",
      },
    ]);
    expect(result.events.map((event) => event.type)).toEqual([
      "barrel_ignited",
      "object_destroyed",
    ]);
  });

  it("breaks water barrels into persistent water", () => {
    const tacticalGrid = grid({
      objects: [
        { id: "water", type: "barrel", x: 3, y: 3, content: "water", hp: 2 },
      ],
    });
    const result = interactWithObject(tacticalGrid, {
      objectId: "water",
      action: "damage",
      amount: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.state).toBe("destroyed");
    expect(result.grid.surfaces[0]).toMatchObject({
      type: "water",
      duration: null,
    });
  });

  it("resolves trap disarming checks and failed-check effects", () => {
    const tacticalGrid = grid({
      objects: [
        {
          id: "needle",
          type: "trap",
          x: 1,
          y: 1,
          disarmDC: 14,
          trapDamage: 7,
          trapDamageType: "poison",
          trapCondition: "poisoned",
        },
      ],
    });
    const success = interactWithObject(tacticalGrid, {
      objectId: "needle",
      action: "disarm",
      checkTotal: 14,
    });
    expect(success).toMatchObject({
      ok: true,
      outcome: "success",
      object: { state: "disarmed" },
      events: [{ type: "trap_disarmed" }],
    });

    const failure = interactWithObject(tacticalGrid, {
      objectId: "needle",
      action: "disarm",
      checkTotal: 13,
    });
    expect(failure).toMatchObject({
      ok: true,
      outcome: "failed-check",
      object: { state: "triggered" },
      events: [
        {
          type: "trap_triggered",
          damage: 7,
          damageType: "poison",
          condition: "poisoned",
        },
      ],
    });
  });

  it("damages destructibles without mutating their previous state", () => {
    const tacticalGrid = grid({
      objects: [
        { id: "crate", type: "destructible", x: 1, y: 1, hp: 10, maxHp: 10 },
      ],
    });
    const result = interactWithObject(tacticalGrid, {
      objectId: "crate",
      action: "damage",
      amount: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(tacticalGrid.objects[0].hp).toBe(10);
    expect(result.object).toMatchObject({ hp: 6, state: "intact" });
  });
});

describe("stealth, perception, visibility, and surprise", () => {
  it("checks range and ray blockers before stealth", () => {
    const observer = hiddenActor("observer", 0, 0, {
      hidden: false,
      perception: 30,
      visionRange: 4,
    });
    const farTarget = hiddenActor("far", 5, 0, { stealth: 1 });
    expect(visibilityBetween(grid(), observer, farTarget)).toMatchObject({
      visible: false,
      reason: "out-of-range",
    });

    const nearTarget = hiddenActor("near", 3, 0, { stealth: 1 });
    expect(
      visibilityBetween(
        grid({ blocked: [{ x: 2, y: 0 }] }),
        observer,
        nearTarget,
      ),
    ).toMatchObject({ visible: false, reason: "line-of-sight" });
  });

  it("applies cover, distance, and elevation to hidden-target DC", () => {
    const tacticalGrid = grid({
      coverCells: [{ x: 6, y: 0, level: "half" }],
      elevations: [{ x: 6, y: 0, elevation: 2 }],
    });
    const observer = hiddenActor("observer", 0, 0, {
      hidden: false,
      perception: 17,
    });
    const target = hiddenActor("target", 6, 0, { stealth: 14 });
    expect(visibilityBetween(tacticalGrid, observer, target)).toEqual({
      visible: false,
      reason: "hidden",
      distance: 6,
      perceptionDC: 18,
      observerScore: 17,
    });
    expect(
      visibilityBetween(tacticalGrid, { ...observer, perception: 18 }, target)
        .visible,
    ).toBe(true);
  });

  it("returns only actors visible to an observer", () => {
    const observer = hiddenActor("observer", 0, 0, {
      hidden: false,
      perception: 12,
    });
    const obvious = hiddenActor("obvious", 2, 0, { hidden: false });
    const hidden = hiddenActor("hidden", 3, 0, { stealth: 20 });
    expect(
      visibleActorsForObserver(grid(), observer, [
        observer,
        obvious,
        hidden,
      ]).map((actor) => actor.id),
    ).toEqual(["observer", "obvious"]);
  });

  it("marks only defenders who detect no initiator as surprised", () => {
    const scout = hiddenActor("scout", 0, 0, {
      hidden: false,
      perception: 20,
      team: "guards",
    });
    const sleepy = hiddenActor("sleepy", 0, 1, {
      hidden: false,
      perception: 8,
      team: "guards",
    });
    const attacker = hiddenActor("attacker", 3, 0, {
      stealth: 14,
      team: "heroes",
    });
    const result = determineSurprise(
      grid(),
      [scout, sleepy, attacker],
      ["attacker"],
    );
    expect(result.surprisedIds).toEqual(["sleepy"]);
    expect(result.detections).toEqual([
      { observerId: "scout", initiatorId: "attacker", visible: true },
      { observerId: "sleepy", initiatorId: "attacker", visible: false },
    ]);
  });

  it("does not surprise anyone when no attacker initiates", () => {
    const defender = hiddenActor("defender", 0, 0, { hidden: false });
    expect(determineSurprise(grid(), [defender], [])).toEqual({
      surprisedIds: [],
      detections: [],
    });
  });
});
