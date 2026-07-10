import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  characterFindMany: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    eventLog: {
      findFirst: db.findFirst,
      findMany: db.findMany,
    },
    character: {
      findMany: db.characterFindMany,
    },
  },
}));

describe("activeCombatTokensForSession", () => {
  beforeEach(() => {
    db.findFirst.mockReset();
    db.findMany.mockReset();
    db.characterFindMany.mockReset();
  });

  it("materializes combat tokens and applies subsequent moves", async () => {
    const { activeCombatTokensForSession } = await import("./tactical-state");
    const startTs = new Date("2026-06-02T10:00:00.000Z");
    db.findFirst
      .mockResolvedValueOnce({
        id: "combat",
        ts: startTs,
        payload: {
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
        },
      })
      .mockResolvedValueOnce(null);
    db.findMany.mockResolvedValue([
      { type: "token_moved", payload: { tokenId: "hero", x: 2, y: 1 } },
      { type: "token_moved", payload: { tokenId: "missing", x: 9, y: 9 } },
    ]);

    await expect(activeCombatTokensForSession("sess_1")).resolves.toEqual([
      {
        id: "hero",
        name: "Robert",
        x: 2,
        y: 1,
        team: "player",
        movement: 6,
      },
    ]);

    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: "sess_1",
          type: {
            in: ["token_moved", "damage_applied", "combat_action_used"],
          },
          ts: { gte: startTs },
        },
      }),
    );
  });

  it("returns no tokens after combat closes", async () => {
    const { activeCombatTokensForSession } = await import("./tactical-state");
    db.findFirst
      .mockResolvedValueOnce({
        id: "combat",
        ts: new Date("2026-06-02T10:00:00.000Z"),
        payload: { tokens: [{ id: "hero", x: 1, y: 1 }] },
      })
      .mockResolvedValueOnce({ id: "ended" });

    await expect(activeCombatTokensForSession("sess_1")).resolves.toEqual([]);
    expect(db.findMany).not.toHaveBeenCalled();
  });

  it("materializes exploration tokens from campaign characters", async () => {
    const { activeExplorationStateForSession } =
      await import("./tactical-state");
    const sceneTs = new Date("2026-06-02T09:00:00.000Z");
    db.findFirst
      .mockResolvedValueOnce({
        id: "scene",
        ts: sceneTs,
      })
      .mockResolvedValueOnce(null);
    db.characterFindMany.mockResolvedValue([
      {
        id: "hero",
        name: "Robert",
        sheet: { speed: 30 },
      },
    ]);
    db.findMany.mockResolvedValue([
      { payload: { tokenId: "hero", x: 5, y: 4 } },
      { payload: { tokenId: "goblin", x: 8, y: 4 } },
    ]);

    await expect(
      activeExplorationStateForSession("sess_1", "camp_1"),
    ).resolves.toMatchObject({
      startedAt: sceneTs,
      tokens: [
        {
          id: "hero",
          name: "Robert",
          x: 5,
          y: 4,
          team: "player",
          movement: 6,
        },
      ],
    });
    expect(db.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          sessionId: "sess_1",
          type: { in: expect.arrayContaining(["session_bootstrap_v12"]) },
        },
      }),
    );
  });

  it("sums movement costs for one token in the active turn", async () => {
    const { movementSpentForTurn } = await import("./tactical-state");

    expect(
      movementSpentForTurn(
        [
          {
            tokenId: "hero",
            x: 2,
            y: 1,
            movementCost: 2,
            round: 1,
            turnIndex: 0,
          },
          {
            tokenId: "hero",
            x: 4,
            y: 1,
            movementCost: 3,
            round: 1,
            turnIndex: 0,
          },
          {
            tokenId: "hero",
            x: 5,
            y: 1,
            movementCost: 1,
            round: 1,
            turnIndex: 1,
          },
          {
            tokenId: "goblin",
            x: 7,
            y: 1,
            movementCost: 4,
            round: 1,
            turnIndex: 0,
          },
        ],
        { tokenId: "hero", round: 1, turnIndex: 0 },
      ),
    ).toBe(5);
  });

  it("applies combat damage and exposes action events during replay", async () => {
    const { activeCombatStateForSession, combatResourcesForTurn } =
      await import("./tactical-state");
    const startTs = new Date("2026-06-02T10:00:00.000Z");
    db.findFirst
      .mockResolvedValueOnce({
        id: "combat",
        ts: startTs,
        payload: {
          tokens: [{ id: "goblin", x: 4, y: 1, hp: 7, maxHp: 7, ac: 13 }],
        },
      })
      .mockResolvedValueOnce(null);
    db.findMany.mockResolvedValue([
      {
        type: "damage_applied",
        payload: { targetId: "goblin", amount: 4 },
      },
      {
        type: "combat_action_used",
        payload: {
          tokenId: "hero",
          actionType: "dash",
          resource: "action",
          movementBonus: 6,
          round: 1,
          turnIndex: 0,
        },
      },
    ]);

    const state = await activeCombatStateForSession("sess_1");

    expect(state?.tokens[0]).toMatchObject({ id: "goblin", hp: 3 });
    expect(
      combatResourcesForTurn(state?.actionEvents ?? [], {
        tokenId: "hero",
        round: 1,
        turnIndex: 0,
      }),
    ).toMatchObject({ actionUsed: true, dash: true, movementBonus: 6 });
  });
});
