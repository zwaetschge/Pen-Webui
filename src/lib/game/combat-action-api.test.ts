import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gameSessionFindUnique: vi.fn(),
  gameSessionUpdateMany: vi.fn(),
  encounterFindFirst: vi.fn(),
  encounterFindUnique: vi.fn(),
  encounterUpdate: vi.fn(),
  encounterUpdateMany: vi.fn(),
  characterFindFirst: vi.fn(),
  characterUpdate: vi.fn(),
  npcFindFirst: vi.fn(),
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
  combatResourcesForTurn: vi.fn(),
}));
const gridMock = vi.hoisted(() => ({
  movementGridForSession: vi.fn(),
}));
const diceMock = vi.hoisted(() => ({
  rollDice: vi.fn(),
}));
const mutationMock = vi.hoisted(() => ({
  withSessionMutation: vi.fn(
    async (_sessionId: string, fn: () => Promise<unknown>) => fn(),
  ),
}));
const pendingTurnWaker = vi.hoisted(() => ({
  schedulePendingTurnDrain: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSession: {
      findUnique: db.gameSessionFindUnique,
      updateMany: db.gameSessionUpdateMany,
    },
    encounter: {
      findFirst: db.encounterFindFirst,
      findUnique: db.encounterFindUnique,
      update: db.encounterUpdate,
      updateMany: db.encounterUpdateMany,
    },
    character: {
      findFirst: db.characterFindFirst,
      update: db.characterUpdate,
    },
    nPC: { findFirst: db.npcFindFirst },
    eventLog: { findFirst: db.eventLogFindFirst },
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
  combatResourcesForTurn: tacticalMock.combatResourcesForTurn,
}));

vi.mock("./movement-grid", () => ({
  movementGridForSession: gridMock.movementGridForSession,
}));

vi.mock("@/lib/dice", () => ({
  rollDice: diceMock.rollDice,
}));

vi.mock("./session-mutation", () => ({
  withSessionMutation: mutationMock.withSessionMutation,
}));

vi.mock("./pending-turn-waker", () => pendingTurnWaker);

function request(body: unknown) {
  return new Request("http://localhost/api/sessions/sess_1/combat-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleCombatAction", () => {
  beforeEach(() => {
    db.gameSessionFindUnique.mockReset();
    db.gameSessionUpdateMany.mockReset();
    db.encounterFindFirst.mockReset();
    db.encounterFindUnique.mockReset();
    db.encounterUpdate.mockReset();
    db.encounterUpdateMany.mockReset();
    db.characterFindFirst.mockReset();
    db.characterUpdate.mockReset();
    db.npcFindFirst.mockReset();
    db.eventLogFindFirst.mockReset();
    accessMock.resolveAccess.mockReset();
    busMock.publishEvent.mockReset();
    tacticalMock.activeCombatStateForSession.mockReset();
    tacticalMock.combatResourcesForTurn.mockReset();
    gridMock.movementGridForSession.mockReset();
    diceMock.rollDice.mockReset();
    pendingTurnWaker.schedulePendingTurnDrain.mockReset();
    mutationMock.withSessionMutation.mockClear();
    mutationMock.withSessionMutation.mockImplementation(
      async (_sessionId: string, fn: () => Promise<unknown>) => fn(),
    );

    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "user_1",
      displayName: "Robert",
      memberId: "member_1",
      characterId: "hero",
      inviteId: null,
    });
    db.gameSessionFindUnique.mockResolvedValue({
      campaignId: "camp_1",
      endedAt: null,
    });
    db.eventLogFindFirst.mockResolvedValue(null);
    db.encounterFindFirst.mockResolvedValue({
      id: "enc_1",
      initiative: [
        { name: "Robert", roll: 15, refId: "hero" },
        { name: "Goblin", roll: 9, refId: "goblin" },
      ],
      activeTurn: 0,
      round: 1,
      locationId: "loc_1",
    });
    db.encounterFindUnique.mockResolvedValue({ runtime: {} });
    db.encounterUpdateMany.mockResolvedValue({ count: 1 });
    db.gameSessionUpdateMany.mockResolvedValue({ count: 1 });
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      startedAt: new Date("2026-06-02T10:00:00.000Z"),
      actionEvents: [],
      moves: [],
      tokens: [
        {
          id: "hero",
          name: "Robert",
          x: 1,
          y: 1,
          hp: 10,
          maxHp: 10,
          ac: 12,
          team: "player",
          movement: 6,
        },
        {
          id: "goblin",
          name: "Goblin",
          x: 2,
          y: 1,
          hp: 7,
          maxHp: 7,
          ac: 13,
          team: "monster",
          movement: 6,
        },
      ],
    });
    tacticalMock.combatResourcesForTurn.mockReturnValue({
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      movementBonus: 0,
      dash: false,
      dodge: false,
      disengage: false,
    });
    db.characterFindFirst.mockResolvedValue({
      sheet: {
        abilities: { str: 16, dex: 12 },
        proficiencyBonus: 2,
      },
      runtime: {},
    });
    db.characterUpdate.mockResolvedValue({ id: "hero" });
    busMock.publishEvent.mockImplementation(
      async (_sessionId, type, payload) => ({
        id: `ev_${type}`,
        type,
        payload,
        ts: Date.now(),
      }),
    );
    diceMock.rollDice.mockImplementation((notation: string) =>
      notation.includes("d20")
        ? {
            notation,
            total: 18,
            rolls: [{ die: 20, value: 16 }],
            breakdown: "1d20[16] +2",
            groups: [],
            modifierSum: 2,
          }
        : {
            notation,
            total: 7,
            rolls: [{ die: 8, value: 4 }],
            breakdown: "1d8[4] +3",
            groups: [],
            modifierSum: 3,
          },
    );
  });

  it("publishes action, attack and damage events for a valid attack", async () => {
    const { handleCombatAction } = await import("./combat-action-api");

    const response = await handleCombatAction(
      request({ type: "attack", targetTokenId: "goblin" }),
      "sess_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "attack", hit: true });
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "combat_action_used",
      expect.objectContaining({
        tokenId: "hero",
        actionType: "attack",
        resource: "action",
      }),
      { actorId: "user_1" },
    );
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "attack_resolved",
      expect.objectContaining({
        actorTokenId: "hero",
        targetTokenId: "goblin",
        hit: true,
        damage: 7,
      }),
      { actorId: "user_1" },
    );
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "damage_applied",
      expect.objectContaining({ targetId: "goblin", amount: 7 }),
      { actorId: "user_1" },
    );
  });

  it("returns the existing mutation for a repeated request id", async () => {
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_existing",
      type: "combat_action_used",
    });
    const { handleCombatAction } = await import("./combat-action-api");

    const response = await handleCombatAction(
      request({
        type: "attack",
        targetTokenId: "goblin",
        requestId: "req_attack_1",
      }),
      "sess_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      duplicate: true,
      eventId: "ev_existing",
    });
    expect(db.gameSessionFindUnique).not.toHaveBeenCalled();
    expect(busMock.publishEvent).not.toHaveBeenCalled();
  });

  it("spends bonus action and reaction resources without consuming the action", async () => {
    const { handleCombatAction } = await import("./combat-action-api");

    const bonusResponse = await handleCombatAction(
      request({ type: "bonus_action" }),
      "sess_1",
    );
    const bonusBody = await bonusResponse.json();

    expect(bonusResponse.status).toBe(200);
    expect(bonusBody).toMatchObject({ ok: true, action: "bonus_action" });
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "combat_action_used",
      expect.objectContaining({
        tokenId: "hero",
        actionType: "bonus_action",
        resource: "bonusAction",
      }),
      { actorId: "user_1" },
    );

    busMock.publishEvent.mockClear();

    const reactionResponse = await handleCombatAction(
      request({ type: "reaction" }),
      "sess_1",
    );
    const reactionBody = await reactionResponse.json();

    expect(reactionResponse.status).toBe(200);
    expect(reactionBody).toMatchObject({ ok: true, action: "reaction" });
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "combat_action_used",
      expect.objectContaining({
        tokenId: "hero",
        actionType: "reaction",
        resource: "reaction",
      }),
      { actorId: "user_1" },
    );
    expect(busMock.publishEvent).not.toHaveBeenCalledWith(
      "sess_1",
      "attack_resolved",
      expect.anything(),
      expect.anything(),
    );
  });

  it("rejects bonus action and reaction when their resource is already spent", async () => {
    tacticalMock.combatResourcesForTurn.mockReturnValue({
      actionUsed: false,
      bonusActionUsed: true,
      reactionUsed: true,
      movementBonus: 0,
      dash: false,
      dodge: false,
      disengage: false,
    });
    const { handleCombatAction } = await import("./combat-action-api");

    const bonusResponse = await handleCombatAction(
      request({ type: "bonus_action" }),
      "sess_1",
    );
    const reactionResponse = await handleCombatAction(
      request({ type: "reaction" }),
      "sess_1",
    );

    await expect(bonusResponse.json()).resolves.toMatchObject({
      error: "bonus_action_spent",
    });
    expect(bonusResponse.status).toBe(409);
    await expect(reactionResponse.json()).resolves.toMatchObject({
      error: "reaction_spent",
    });
    expect(reactionResponse.status).toBe(409);
    expect(busMock.publishEvent).not.toHaveBeenCalled();
  });

  it("puts the last player into the downed state without ending the session", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_host",
    });
    db.encounterFindFirst.mockResolvedValue({
      id: "enc_1",
      initiative: [
        { name: "Robert", roll: 15, refId: "hero" },
        { name: "Goblin", roll: 9, refId: "goblin" },
      ],
      activeTurn: 1,
      round: 1,
      locationId: "loc_1",
    });
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      startedAt: new Date("2026-06-02T10:00:00.000Z"),
      actionEvents: [],
      moves: [],
      tokens: [
        {
          id: "hero",
          name: "Robert",
          x: 1,
          y: 1,
          hp: 5,
          maxHp: 10,
          ac: 12,
          team: "player",
          movement: 6,
        },
        {
          id: "goblin",
          name: "Goblin",
          x: 2,
          y: 1,
          hp: 7,
          maxHp: 7,
          ac: 13,
          team: "monster",
          movement: 6,
        },
      ],
    });

    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({ type: "attack", targetTokenId: "hero" }),
      "sess_1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      action: "attack",
      combatEnded: false,
    });
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "character_down",
      expect.objectContaining({ tokenId: "hero", tokenName: "Robert" }),
    );
    expect(db.characterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "hero" },
        data: expect.objectContaining({
          runtime: expect.objectContaining({
            combat: expect.objectContaining({ lifeState: "downed" }),
          }),
        }),
      }),
    );
    expect(busMock.publishEvent).not.toHaveBeenCalledWith(
      "sess_1",
      "character_dead",
      expect.anything(),
    );
    expect(busMock.publishEvent).not.toHaveBeenCalledWith(
      "sess_1",
      "game_over",
      expect.anything(),
    );
    expect(db.gameSessionUpdateMany).not.toHaveBeenCalled();
  });

  it("lets adjacent player initiative members act in either order", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "player",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "user_2",
      displayName: "Mira",
      memberId: "member_2",
      characterId: "hero_2",
      inviteId: null,
    });
    db.encounterFindFirst.mockResolvedValue({
      id: "enc_1",
      initiative: [
        { name: "Robert", roll: 15, refId: "hero" },
        { name: "Mira", roll: 14, refId: "hero_2" },
        { name: "Goblin", roll: 9, refId: "goblin" },
      ],
      activeTurn: 0,
      round: 1,
      locationId: "loc_1",
      runtime: {},
    });
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      startedAt: new Date(),
      actionEvents: [],
      moves: [],
      tokens: [
        {
          id: "hero",
          name: "Robert",
          x: 1,
          y: 1,
          hp: 10,
          maxHp: 10,
          ac: 12,
          team: "player",
          movement: 6,
        },
        {
          id: "hero_2",
          name: "Mira",
          x: 1,
          y: 2,
          hp: 9,
          maxHp: 9,
          ac: 13,
          team: "player",
          movement: 6,
        },
        {
          id: "goblin",
          name: "Goblin",
          x: 2,
          y: 1,
          hp: 7,
          maxHp: 7,
          ac: 13,
          team: "monster",
          movement: 6,
        },
      ],
    });
    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({ type: "dodge", actorTokenId: "hero_2" }),
      "sess_1",
    );
    expect(response.status).toBe(200);
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "combat_action_used",
      expect.objectContaining({ tokenId: "hero_2", actionType: "dodge" }),
      { actorId: "user_2" },
    );
  });

  it("stores an out-of-turn ability plan", async () => {
    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({
        type: "plan_action",
        actorTokenId: "hero",
        abilityId: "core:attack",
        targetTokenId: "goblin",
      }),
      "sess_1",
    );
    expect(response.status).toBe(200);
    expect(db.encounterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "enc_1" },
        data: expect.objectContaining({ runtime: expect.any(Object) }),
      }),
    );
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "action_planned",
      expect.objectContaining({
        actorTokenId: "hero",
        abilityId: "core:attack",
      }),
      { actorId: "user_1" },
    );
  });

  it("executes a deterministic sheet ability through the ability endpoint", async () => {
    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({
        type: "use_ability",
        actorTokenId: "hero",
        abilityId: "core:attack",
        targetTokenId: "goblin",
      }),
      "sess_1",
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      action: "use_ability",
      abilityId: "core:attack",
    });
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "ability_used",
      expect.objectContaining({
        actorTokenId: "hero",
        abilityId: "core:attack",
        targetTokenIds: ["goblin"],
      }),
      { actorId: "user_1" },
    );
  });

  it("allows a bonus-action ability after the action is already spent", async () => {
    tacticalMock.combatResourcesForTurn.mockReturnValue({
      actionUsed: true,
      bonusActionUsed: false,
      reactionUsed: false,
      movementBonus: 0,
      dash: false,
      dodge: false,
      disengage: false,
    });
    db.characterFindFirst.mockResolvedValue({
      sheet: {
        abilities: { str: 16, dex: 12 },
        proficiencyBonus: 2,
        features: [
          {
            name: "Second Wind",
            source: "Fighter",
            description: "Use as a bonus action.",
            combat: {
              activation: "bonusAction",
              target: { kind: "self" },
              effects: [{ kind: "heal", amount: 3 }],
            },
          },
        ],
      },
      runtime: {},
    });
    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({ type: "use_ability", abilityId: "feature:second-wind" }),
      "sess_1",
    );

    expect(response.status).toBe(200);
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "combat_action_used",
      expect.objectContaining({
        tokenId: "hero",
        actionType: "feature:second-wind",
        resource: "bonusAction",
      }),
      { actorId: "user_1" },
    );
  });

  it("refuses to queue an ability plan for a downed actor", async () => {
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      startedAt: new Date(),
      actionEvents: [],
      moves: [],
      tokens: [
        {
          id: "hero",
          name: "Robert",
          x: 1,
          y: 1,
          hp: 0,
          maxHp: 10,
          team: "player",
        },
        {
          id: "goblin",
          name: "Goblin",
          x: 2,
          y: 1,
          hp: 7,
          maxHp: 7,
          team: "monster",
        },
      ],
    });
    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({
        type: "plan_action",
        actorTokenId: "hero",
        abilityId: "core:attack",
        targetTokenId: "goblin",
      }),
      "sess_1",
    );

    expect(response.status).toBe(403);
    expect(db.encounterUpdate).not.toHaveBeenCalled();
  });

  it("blocks a basic attack through full line-of-sight cover", async () => {
    tacticalMock.activeCombatStateForSession.mockResolvedValue({
      startedAt: new Date(),
      actionEvents: [],
      moves: [],
      tokens: [
        {
          id: "hero",
          name: "Robert",
          x: 1,
          y: 1,
          hp: 10,
          maxHp: 10,
          team: "player",
          attackRange: 6,
        },
        {
          id: "goblin",
          name: "Goblin",
          x: 3,
          y: 1,
          hp: 7,
          maxHp: 7,
          team: "monster",
        },
      ],
    });
    gridMock.movementGridForSession.mockResolvedValue({
      columns: 16,
      rows: 16,
      blocked: [{ x: 2, y: 1 }],
    });
    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({ type: "attack", targetTokenId: "goblin" }),
      "sess_1",
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "target_not_visible",
    });
    expect(busMock.publishEvent).not.toHaveBeenCalledWith(
      "sess_1",
      "attack_resolved",
      expect.anything(),
      expect.anything(),
    );
  });

  it("resolves a persisted guard reaction before the NPC attack", async () => {
    const now = Date.now();
    db.encounterFindFirst.mockResolvedValue({
      id: "enc_1",
      initiative: [
        { name: "Robert", roll: 15, refId: "hero" },
        { name: "Goblin", roll: 19, refId: "goblin" },
      ],
      activeTurn: 1,
      round: 1,
      locationId: "loc_1",
      runtime: {
        reaction: {
          id: "reaction_1",
          trigger: "attack",
          reactorTokenId: "hero",
          sourceTokenId: "goblin",
          options: ["core:guard", "pass"],
          pendingCommand: {
            kind: "npc_attack",
            actorTokenId: "goblin",
            targetTokenId: "hero",
          },
          openedAt: now - 100,
          expiresAt: now + 8_000,
        },
      },
    });
    const { handleCombatAction } = await import("./combat-action-api");
    const response = await handleCombatAction(
      request({
        type: "respond_reaction",
        reactionId: "reaction_1",
        reactionChoice: "core:guard",
      }),
      "sess_1",
    );
    expect(response.status).toBe(200);
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "reaction_resolved",
      expect.objectContaining({
        reactionId: "reaction_1",
        choice: "core:guard",
      }),
    );
    expect(busMock.publishEvent).toHaveBeenCalledWith(
      "sess_1",
      "attack_resolved",
      expect.objectContaining({ targetTokenId: "hero", targetAc: 14 }),
      { actorId: null },
    );
  });
});
