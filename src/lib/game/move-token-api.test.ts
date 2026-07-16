import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gameSessionFindUnique: vi.fn(),
  encounterFindFirst: vi.fn(),
  encounterUpdate: vi.fn(),
  characterFindFirst: vi.fn(),
  eventLogFindFirst: vi.fn(),
}));
const accessMock = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
}));
const busMock = vi.hoisted(() => ({
  publishEvent: vi.fn(),
}));
const tacticalMock = vi.hoisted(() => ({
  activeCombatStateForSession: vi.fn(),
  activeExplorationStateForSession: vi.fn(),
  combatResourcesForTurn: vi.fn(),
  movementSpentForTurn: vi.fn(),
}));
const mutationMock = vi.hoisted(() => ({
  withSessionMutation: vi.fn(
    async (_sessionId: string, fn: () => Promise<unknown>) => fn(),
  ),
}));
const gridMock = vi.hoisted(() => ({
  movementGridForSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSession: {
      findUnique: db.gameSessionFindUnique,
    },
    encounter: {
      findFirst: db.encounterFindFirst,
      update: db.encounterUpdate,
    },
    character: {
      findFirst: db.characterFindFirst,
    },
    eventLog: {
      findFirst: db.eventLogFindFirst,
    },
  },
}));

vi.mock("./access", () => ({
  resolveAccess: accessMock.resolveAccess,
}));

vi.mock("./bus", () => ({
  publishEvent: busMock.publishEvent,
}));

vi.mock("./tactical-state", () => ({
  activeCombatStateForSession: tacticalMock.activeCombatStateForSession,
  activeExplorationStateForSession:
    tacticalMock.activeExplorationStateForSession,
  combatResourcesForTurn: tacticalMock.combatResourcesForTurn,
  movementSpentForTurn: tacticalMock.movementSpentForTurn,
}));

vi.mock("./session-mutation", () => ({
  withSessionMutation: mutationMock.withSessionMutation,
}));

vi.mock("./movement-grid", () => ({
  movementGridForSession: gridMock.movementGridForSession,
}));

function request(body: unknown) {
  return new Request("http://localhost/api/sessions/sess_1/move-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleMoveToken", () => {
  beforeEach(() => {
    db.gameSessionFindUnique.mockReset();
    db.encounterFindFirst.mockReset();
    db.encounterUpdate.mockReset();
    db.characterFindFirst.mockReset();
    db.eventLogFindFirst.mockReset();
    accessMock.resolveAccess.mockReset();
    busMock.publishEvent.mockReset();
    tacticalMock.activeCombatStateForSession.mockReset();
    tacticalMock.activeExplorationStateForSession.mockReset();
    tacticalMock.combatResourcesForTurn.mockReset();
    tacticalMock.movementSpentForTurn.mockReset();
    gridMock.movementGridForSession.mockReset();
    gridMock.movementGridForSession.mockResolvedValue({
      columns: 16,
      rows: 16,
    });
    mutationMock.withSessionMutation.mockClear();
    mutationMock.withSessionMutation.mockImplementation(
      async (_sessionId: string, fn: () => Promise<unknown>) => fn(),
    );
  });

  it("allows character movement outside combat as exploration", async () => {
    const { handleMoveToken } = await import("./move-token-api");
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "user_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      campaignId: "camp_1",
      endedAt: null,
    });
    db.encounterFindFirst.mockResolvedValue(null);
    tacticalMock.activeExplorationStateForSession.mockResolvedValue({
      startedAt: null,
      moves: [],
      tokens: [
        {
          id: "hero",
          name: "Robert",
          x: 1,
          y: 1,
          team: "player",
          movement: 6,
        },
      ],
    });
    db.characterFindFirst.mockResolvedValue({ id: "hero" });
    db.eventLogFindFirst.mockResolvedValue(null);
    busMock.publishEvent.mockResolvedValue({
      id: "ev_move",
      type: "token_moved",
      payload: {},
      ts: Date.now(),
    });

    const response = await handleMoveToken(
      request({ tokenId: "hero", x: 4, y: 4 }),
      "sess_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, mode: "exploration" });
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "token_moved",
      expect.objectContaining({
        mode: "exploration",
        tokenId: "hero",
        fromX: 1,
        fromY: 1,
        x: 4,
        y: 4,
        movementCost: null,
      }),
      { actorId: "user_1" },
    );
  });

  it("returns an existing move event for a repeated request id", async () => {
    const { handleMoveToken } = await import("./move-token-api");
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "user_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_move_existing",
      payload: { mode: "combat" },
    });

    const response = await handleMoveToken(
      request({
        tokenId: "hero",
        x: 4,
        y: 4,
        requestId: "req_move_1",
      }),
      "sess_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      duplicate: true,
      mode: "combat",
      eventId: "ev_move_existing",
    });
    expect(db.gameSessionFindUnique).not.toHaveBeenCalled();
    expect(busMock.publishEvent).not.toHaveBeenCalled();
  });

  it("lets either uncompleted player in the active initiative block move", async () => {
    const { handleMoveToken } = await import("./move-token-api");
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "user_2",
      characterId: "hero_2",
      displayName: "Player two",
      memberId: "member_2",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      campaignId: "camp_1",
      endedAt: null,
    });
    db.encounterFindFirst.mockResolvedValue({
      id: "enc_1",
      initiative: [
        { name: "Hero one", roll: 18, refId: "hero_1" },
        { name: "Hero two", roll: 17, refId: "hero_2" },
        { name: "Goblin", roll: 12, refId: "goblin" },
      ],
      activeTurn: 0,
      round: 1,
      locationId: null,
      runtime: {},
    });
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      tokens: [
        {
          id: "hero_1",
          name: "Hero one",
          x: 0,
          y: 0,
          team: "player",
          movement: 6,
          hp: 10,
        },
        {
          id: "hero_2",
          name: "Hero two",
          x: 0,
          y: 1,
          team: "player",
          movement: 6,
          hp: 10,
        },
        {
          id: "goblin",
          name: "Goblin",
          x: 5,
          y: 5,
          team: "monster",
          movement: 6,
          hp: 7,
        },
      ],
      moves: [],
      actionEvents: [],
    });
    tacticalMock.combatResourcesForTurn.mockReturnValue({ movementBonus: 0 });
    tacticalMock.movementSpentForTurn.mockReturnValue(0);
    db.eventLogFindFirst.mockResolvedValue(null);
    busMock.publishEvent.mockResolvedValue({ id: "ev_group_move" });

    const response = await handleMoveToken(
      request({ tokenId: "hero_2", x: 1, y: 1 }),
      "sess_1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mode: "combat",
      movementRemaining: 5,
    });
  });

  it("charges weighted terrain and surface costs along the cheapest path", async () => {
    const { handleMoveToken } = await import("./move-token-api");
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "user_1",
      characterId: "hero",
      displayName: "Player",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      campaignId: "camp_1",
      endedAt: null,
    });
    db.encounterFindFirst.mockResolvedValue({
      id: "enc_1",
      initiative: [{ name: "Hero", roll: 18, refId: "hero" }],
      activeTurn: 0,
      round: 1,
      locationId: "loc_1",
      runtime: {
        surfaces: [
          {
            x: 2,
            y: 0,
            type: "water",
            intensity: 1,
            duration: null,
          },
        ],
      },
    });
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      tokens: [
        {
          id: "hero",
          name: "Hero",
          x: 0,
          y: 0,
          team: "player",
          movement: 6,
          hp: 10,
        },
      ],
      moves: [],
      actionEvents: [],
    });
    tacticalMock.combatResourcesForTurn.mockReturnValue({ movementBonus: 0 });
    tacticalMock.movementSpentForTurn.mockReturnValue(0);
    gridMock.movementGridForSession.mockResolvedValue({
      columns: 3,
      rows: 1,
      terrain: [{ x: 1, y: 0, kind: "mud", movementCost: 3 }],
    });
    db.eventLogFindFirst.mockResolvedValue(null);
    db.encounterUpdate.mockResolvedValue({ id: "enc_1" });
    busMock.publishEvent.mockResolvedValue({ id: "ev_surface_move" });

    const response = await handleMoveToken(
      request({ tokenId: "hero", x: 2, y: 0 }),
      "sess_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ movementRemaining: 1 });
    expect(busMock.publishEvent).toHaveBeenNthCalledWith(
      1,
      "sess_1",
      "token_moved",
      expect.objectContaining({
        movementCost: 5,
        surface: { type: "water", intensity: 1 },
      }),
      { actorId: "user_1" },
    );
    expect(busMock.publishEvent).toHaveBeenNthCalledWith(
      2,
      "sess_1",
      "status_updated",
      expect.objectContaining({
        targetId: "hero",
        condition: "wet",
        source: "surface:water",
      }),
      { actorId: "user_1" },
    );
    expect(db.encounterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "enc_1" },
        data: {
          runtime: expect.objectContaining({
            statuses: {
              hero: [
                expect.objectContaining({
                  condition: "wet",
                  source: "surface:water",
                }),
              ],
            },
          }),
        },
      }),
    );
  });

  it("applies damaging surface effects after entering the destination", async () => {
    const { handleMoveToken } = await import("./move-token-api");
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "dm_1",
      displayName: "DM",
      memberId: "member_dm",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      campaignId: "camp_1",
      endedAt: null,
    });
    db.encounterFindFirst.mockResolvedValue({
      id: "enc_1",
      initiative: [{ name: "Hero", roll: 18, refId: "hero" }],
      activeTurn: 0,
      round: 2,
      locationId: null,
      runtime: {
        surfaces: [
          {
            x: 1,
            y: 0,
            type: "fire",
            intensity: 2,
            duration: 3,
          },
        ],
      },
    });
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      tokens: [
        {
          id: "hero",
          name: "Hero",
          x: 0,
          y: 0,
          team: "player",
          movement: 6,
          hp: 10,
        },
      ],
      moves: [],
      actionEvents: [],
    });
    tacticalMock.combatResourcesForTurn.mockReturnValue({ movementBonus: 0 });
    tacticalMock.movementSpentForTurn.mockReturnValue(0);
    db.characterFindFirst.mockResolvedValue({ id: "hero" });
    db.eventLogFindFirst.mockResolvedValue(null);
    busMock.publishEvent.mockResolvedValue({ id: "ev_fire" });

    const response = await handleMoveToken(
      request({ tokenId: "hero", x: 1, y: 0 }),
      "sess_1",
    );

    expect(response.status).toBe(200);
    expect(busMock.publishEvent).toHaveBeenNthCalledWith(
      2,
      "sess_1",
      "damage_applied",
      expect.objectContaining({
        targetId: "hero",
        amount: 4,
        type: "fire",
        phase: "enter",
      }),
      { actorId: "dm_1" },
    );
  });
});
