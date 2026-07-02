import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gameSessionFindUnique: vi.fn(),
  encounterFindFirst: vi.fn(),
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

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSession: {
      findUnique: db.gameSessionFindUnique,
    },
    encounter: {
      findFirst: db.encounterFindFirst,
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
    db.characterFindFirst.mockReset();
    db.eventLogFindFirst.mockReset();
    accessMock.resolveAccess.mockReset();
    busMock.publishEvent.mockReset();
    tacticalMock.activeCombatStateForSession.mockReset();
    tacticalMock.activeExplorationStateForSession.mockReset();
    tacticalMock.combatResourcesForTurn.mockReset();
    tacticalMock.movementSpentForTurn.mockReset();
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
});
