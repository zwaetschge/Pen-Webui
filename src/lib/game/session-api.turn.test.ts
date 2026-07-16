import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gameSessionFindUnique: vi.fn(),
  encounterFindFirst: vi.fn(),
  sessionMemberFindFirst: vi.fn(),
  characterFindFirst: vi.fn(),
  inviteFindUnique: vi.fn(),
}));
const access = vi.hoisted(() => ({ resolveAccess: vi.fn() }));
const acting = vi.hoisted(() => ({ resolveActingIdentity: vi.fn() }));
const dm = vi.hoisted(() => ({ runDmTurn: vi.fn() }));
const bus = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  recentEvents: vi.fn(),
}));
const locks = vi.hoisted(() => ({
  DM_TURN_LOCK_TTL_MS: 180_000,
  acquireDmTurnLock: vi.fn(),
  acquireDmTurnLockIfQueueEmpty: vi.fn(),
  confirmDmTurnLockOwned: vi.fn(),
  releaseDmTurnLock: vi.fn(),
}));
const pending = vi.hoisted(() => ({
  enqueuePendingTurn: vi.fn(),
  claimPendingTurn: vi.fn(),
  acknowledgePendingTurn: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSession: { findUnique: db.gameSessionFindUnique },
    encounter: { findFirst: db.encounterFindFirst },
    sessionMember: { findFirst: db.sessionMemberFindFirst },
    character: { findFirst: db.characterFindFirst },
    invite: { findUnique: db.inviteFindUnique },
  },
}));
vi.mock("./access", () => ({ resolveAccess: access.resolveAccess }));
vi.mock("./acting", () => ({
  resolveActingIdentity: acting.resolveActingIdentity,
}));
vi.mock("@/lib/dm/orchestrator", () => ({ runDmTurn: dm.runDmTurn }));
vi.mock("./bus", () => ({
  channel: vi.fn(),
  publishEvent: bus.publishEvent,
  recentEvents: bus.recentEvents,
  subClient: vi.fn(),
}));
vi.mock("./bootstrap", () => ({ ensureSessionBootstrap: vi.fn() }));
vi.mock("./turn-lock", () => locks);
vi.mock("./pending-turns", () => pending);

const session = {
  campaignId: "camp_1",
  endedAt: null,
  campaign: { hostId: "host_1" },
};
const playerAccess = {
  role: "player" as const,
  sessionId: "sess_1",
  campaignId: "camp_1",
  userId: "user_1",
  displayName: "Vale",
  memberId: "member_1",
  characterId: "char_1",
  inviteId: null,
};
const playerActor = {
  displayName: "Elinor Hale",
  dbActorId: "user_1",
  eventActorId: "member_1",
  characterId: "char_1",
  actorKind: "player" as const,
};
const lock = { sessionId: "sess_1", token: "lock_1", fence: 17 };

function turnRequest(text = "Ich untersuche die Hintertür.") {
  return new Request("http://app/api/sessions/sess_1/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, characterId: "char_1" }),
  });
}

describe("session turn pending queue", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(db).forEach((mock) => mock.mockReset());
    access.resolveAccess.mockReset();
    acting.resolveActingIdentity.mockReset();
    dm.runDmTurn.mockReset();
    bus.publishEvent.mockReset();
    bus.recentEvents.mockReset();
    Object.values(locks).forEach((mock) => {
      if (typeof mock === "function") mock.mockReset();
    });
    Object.values(pending).forEach((mock) => mock.mockReset());

    access.resolveAccess.mockResolvedValue(playerAccess);
    acting.resolveActingIdentity.mockResolvedValue(playerActor);
    db.gameSessionFindUnique.mockResolvedValue(session);
    db.encounterFindFirst.mockResolvedValue(null);
    db.sessionMemberFindFirst.mockResolvedValue({
      id: "member_1",
      userId: "user_1",
      inviteId: null,
      displayName: "Vale",
      characterId: "char_1",
    });
    db.characterFindFirst.mockResolvedValue({
      id: "char_1",
      name: "Elinor Hale",
      ownerId: "user_1",
    });
    db.inviteFindUnique.mockResolvedValue(null);
    bus.publishEvent.mockResolvedValue({ id: "event_1" });
    locks.confirmDmTurnLockOwned.mockResolvedValue(undefined);
    locks.releaseDmTurnLock.mockResolvedValue(undefined);
    locks.acquireDmTurnLockIfQueueEmpty.mockImplementation((sessionId) =>
      locks.acquireDmTurnLock(sessionId),
    );
    dm.runDmTurn.mockResolvedValue({});
  });

  it("queues a validated exploration action when the DM lease is busy", async () => {
    locks.acquireDmTurnLock.mockResolvedValue(null);
    pending.enqueuePendingTurn.mockResolvedValue({
      accepted: true,
      position: 2,
    });

    const { handleSessionTurn } = await import("./session-api");
    const response = await handleSessionTurn(turnRequest(), "sess_1");

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      queued: true,
      position: 2,
    });
    expect(pending.enqueuePendingTurn).toHaveBeenCalledWith("sess_1", {
      campaignId: "camp_1",
      runnerId: "host_1",
      text: "Ich untersuche die Hintertür.",
      actor: playerActor,
    });
    expect(bus.publishEvent).not.toHaveBeenCalled();
    expect(dm.runDmTurn).not.toHaveBeenCalled();
  });

  it("keeps the existing busy response during active combat", async () => {
    db.encounterFindFirst.mockResolvedValue({
      initiative: [{ refId: "char_1", name: "Elinor Hale" }],
      activeTurn: 0,
    });
    locks.acquireDmTurnLock.mockResolvedValue(null);

    const { handleSessionTurn } = await import("./session-api");
    const response = await handleSessionTurn(turnRequest(), "sess_1");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "dm_busy" });
    expect(pending.enqueuePendingTurn).not.toHaveBeenCalled();
  });

  it("returns a bounded queue error without pretending the action was saved", async () => {
    locks.acquireDmTurnLock.mockResolvedValue(null);
    pending.enqueuePendingTurn.mockResolvedValue({
      accepted: false,
      size: 16,
      limit: 16,
    });

    const { handleSessionTurn } = await import("./session-api");
    const response = await handleSessionTurn(turnRequest(), "sess_1");

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "turn_queue_full",
      limit: 16,
    });
  });

  it("returns a clear per-player limit when one controller fills its share", async () => {
    locks.acquireDmTurnLock.mockResolvedValue(null);
    pending.enqueuePendingTurn.mockResolvedValue({
      accepted: false,
      reason: "actor_limit",
      size: 5,
      actorSize: 3,
      limit: 3,
    });

    const { handleSessionTurn } = await import("./session-api");
    const response = await handleSessionTurn(turnRequest(), "sess_1");

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "turn_queue_actor_limit",
      limit: 3,
    });
  });

  it("returns a retryable service error when Redis cannot persist the action", async () => {
    locks.acquireDmTurnLock.mockResolvedValue(null);
    pending.enqueuePendingTurn.mockRejectedValue(new Error("redis down"));

    const { handleSessionTurn } = await import("./session-api");
    const response = await handleSessionTurn(turnRequest(), "sess_1");

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    await expect(response.json()).resolves.toEqual({
      error: "turn_queue_unavailable",
    });
  });

  it("publishes and runs a queued action only when the FIFO drainer owns the lease", async () => {
    locks.acquireDmTurnLock
      .mockResolvedValueOnce(lock)
      .mockResolvedValueOnce(null);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "encoded-turn",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_1",
        enqueuedAt: 1_700_000_000_000,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich sichere das Fenster.",
        actor: playerActor,
      },
    });
    pending.acknowledgePendingTurn.mockResolvedValue(undefined);

    const { drainPendingTurns } = await import("./session-api");
    await expect(drainPendingTurns("sess_1")).resolves.toBe(true);
    await Promise.resolve();

    expect(bus.publishEvent).toHaveBeenNthCalledWith(
      1,
      "sess_1",
      "player_input",
      {
        kind: "player_input",
        text: "Ich sichere das Fenster.",
        actorId: "member_1",
        displayName: "Elinor Hale",
        characterId: "char_1",
        actorKind: "player",
      },
      { actorId: "user_1", eventId: "pending_queued_1" },
    );
    expect(pending.acknowledgePendingTurn).toHaveBeenCalledWith(
      "sess_1",
      "encoded-turn",
    );
    expect(bus.publishEvent.mock.invocationCallOrder[0]).toBeLessThan(
      pending.acknowledgePendingTurn.mock.invocationCallOrder[0]!,
    );
    expect(dm.runDmTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        campaignId: "camp_1",
        userId: "host_1",
        playerInput: expect.objectContaining({
          text: "Ich sichere das Fenster.",
          alreadyPersisted: true,
        }),
      }),
    );
    expect(locks.releaseDmTurnLock).toHaveBeenCalledWith(lock);
  });

  it("keeps a claimed action recoverable when its durable input write fails", async () => {
    locks.acquireDmTurnLock.mockResolvedValueOnce(lock);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "write-failed",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_write_failed",
        enqueuedAt: 1_700_000_000_000,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich sichere den Ausgang.",
        actor: playerActor,
      },
    });
    bus.publishEvent.mockRejectedValueOnce(new Error("database unavailable"));

    const { drainPendingTurns } = await import("./session-api");
    await expect(drainPendingTurns("sess_1")).resolves.toBe(false);

    expect(pending.acknowledgePendingTurn).not.toHaveBeenCalled();
    expect(dm.runDmTurn).not.toHaveBeenCalled();
    expect(locks.releaseDmTurnLock).toHaveBeenCalledWith(lock);
  });

  it("automatically starts the oldest queued action after a live turn finishes", async () => {
    const nextLock = { sessionId: "sess_1", token: "lock_2", fence: 18 };
    locks.acquireDmTurnLock
      .mockResolvedValueOnce(lock)
      .mockResolvedValueOnce(nextLock)
      .mockResolvedValueOnce(null);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "queued-second",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_2",
        enqueuedAt: 1_700_000_000_001,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich prüfe währenddessen den Dachboden.",
        actor: playerActor,
      },
    });
    pending.acknowledgePendingTurn.mockResolvedValue(undefined);

    const { handleSessionTurn } = await import("./session-api");
    const response = await handleSessionTurn(
      turnRequest("Ich öffne die Hintertür."),
      "sess_1",
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(dm.runDmTurn).toHaveBeenCalledTimes(2));
    expect(
      dm.runDmTurn.mock.calls.map((call) => call[0].playerInput.text),
    ).toEqual([
      "Ich öffne die Hintertür.",
      "Ich prüfe währenddessen den Dachboden.",
    ]);
    expect(locks.releaseDmTurnLock).toHaveBeenCalledWith(lock);
    expect(locks.releaseDmTurnLock).toHaveBeenCalledWith(nextLock);
  });

  it("drops a queued action when its session member has left", async () => {
    locks.acquireDmTurnLock
      .mockResolvedValueOnce(lock)
      .mockResolvedValueOnce(null);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "left-member",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_left",
        enqueuedAt: 1_700_000_000_000,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich handle noch schnell.",
        actor: playerActor,
      },
    });
    db.sessionMemberFindFirst.mockResolvedValue(null);
    pending.acknowledgePendingTurn.mockResolvedValue(undefined);

    const { drainPendingTurns } = await import("./session-api");
    await expect(drainPendingTurns("sess_1")).resolves.toBe(true);

    expect(pending.acknowledgePendingTurn).toHaveBeenCalledWith(
      "sess_1",
      "left-member",
    );
    expect(bus.publishEvent).not.toHaveBeenCalled();
    expect(dm.runDmTurn).not.toHaveBeenCalled();
  });

  it("drops a queued action when its character no longer exists", async () => {
    locks.acquireDmTurnLock
      .mockResolvedValueOnce(lock)
      .mockResolvedValueOnce(null);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "missing-character",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_missing_character",
        enqueuedAt: 1_700_000_000_000,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich handle mit der alten Figur.",
        actor: playerActor,
      },
    });
    db.characterFindFirst.mockResolvedValue(null);
    pending.acknowledgePendingTurn.mockResolvedValue(undefined);

    const { drainPendingTurns } = await import("./session-api");
    await expect(drainPendingTurns("sess_1")).resolves.toBe(true);

    expect(pending.acknowledgePendingTurn).toHaveBeenCalledWith(
      "sess_1",
      "missing-character",
    );
    expect(dm.runDmTurn).not.toHaveBeenCalled();
  });

  it("drops a guest action after its invite expires", async () => {
    const guestActor = {
      ...playerActor,
      dbActorId: null,
    };
    locks.acquireDmTurnLock
      .mockResolvedValueOnce(lock)
      .mockResolvedValueOnce(null);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "expired-guest",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_expired_guest",
        enqueuedAt: 1_700_000_000_000,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich nutze den alten Gastzugang.",
        actor: guestActor,
      },
    });
    db.sessionMemberFindFirst.mockResolvedValue({
      id: "member_1",
      userId: null,
      inviteId: "invite_1",
      displayName: "Vale",
      characterId: "char_1",
    });
    db.characterFindFirst.mockResolvedValue({
      id: "char_1",
      name: "Elinor Hale",
      ownerId: null,
    });
    db.inviteFindUnique.mockResolvedValue({
      id: "invite_1",
      campaignId: "camp_1",
      sessionId: "sess_1",
      characterId: "char_1",
      revokedAt: null,
      expiresAt: new Date(0),
    });
    pending.acknowledgePendingTurn.mockResolvedValue(undefined);

    const { drainPendingTurns } = await import("./session-api");
    await expect(drainPendingTurns("sess_1")).resolves.toBe(true);

    expect(db.inviteFindUnique).toHaveBeenCalledWith({
      where: { id: "invite_1" },
      select: expect.any(Object),
    });
    expect(pending.acknowledgePendingTurn).toHaveBeenCalledWith(
      "sess_1",
      "expired-guest",
    );
    expect(dm.runDmTurn).not.toHaveBeenCalled();
  });

  it("drops a guest action after the member moves to another seat", async () => {
    const guestActor = { ...playerActor, dbActorId: null };
    locks.acquireDmTurnLock
      .mockResolvedValueOnce(lock)
      .mockResolvedValueOnce(null);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "changed-seat",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_old_seat",
        enqueuedAt: 1_700_000_000_000,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich handle mit dem alten Platz.",
        actor: guestActor,
      },
    });
    db.sessionMemberFindFirst.mockResolvedValue({
      id: "member_1",
      userId: null,
      inviteId: "invite_2",
      displayName: "Vale",
      characterId: "char_2",
    });
    db.characterFindFirst.mockResolvedValue({
      id: "char_1",
      name: "Elinor Hale",
      ownerId: null,
    });
    pending.acknowledgePendingTurn.mockResolvedValue(undefined);

    const { drainPendingTurns } = await import("./session-api");
    await expect(drainPendingTurns("sess_1")).resolves.toBe(true);

    expect(pending.acknowledgePendingTurn).toHaveBeenCalledWith(
      "sess_1",
      "changed-seat",
    );
    expect(db.inviteFindUnique).not.toHaveBeenCalled();
    expect(dm.runDmTurn).not.toHaveBeenCalled();
  });

  it("defers a queued exploration action while combat is active", async () => {
    locks.acquireDmTurnLock.mockResolvedValueOnce(lock);
    pending.claimPendingTurn.mockResolvedValueOnce({
      receipt: "pre-combat-turn",
      turn: {
        version: 1,
        queueActorKey: "character:char_1",
        id: "queued_before_combat",
        enqueuedAt: 1_700_000_000_000,
        campaignId: "camp_1",
        runnerId: "host_1",
        text: "Ich untersuche noch den Flur.",
        actor: playerActor,
      },
    });
    db.encounterFindFirst.mockResolvedValue({
      initiative: [{ refId: "char_1", name: "Elinor Hale" }],
      activeTurn: 0,
    });

    const { drainPendingTurns } = await import("./session-api");
    await expect(drainPendingTurns("sess_1")).resolves.toBe(false);

    expect(pending.acknowledgePendingTurn).not.toHaveBeenCalled();
    expect(bus.publishEvent).not.toHaveBeenCalled();
    expect(dm.runDmTurn).not.toHaveBeenCalled();
    expect(locks.releaseDmTurnLock).toHaveBeenCalledWith(lock);
  });

  it("paginates incremental EventLog catch-up without skipping a full page", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `event_${String(index + 1).padStart(3, "0")}`,
      type: "narrate",
      payload: { text: `Beat ${index + 1}` },
      ts: index + 1,
      scope: "all" as const,
    }));
    const finalEvent = {
      id: "event_201",
      type: "narrate",
      payload: { text: "Beat 201" },
      ts: 201,
      scope: "all" as const,
    };
    bus.recentEvents
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([finalEvent]);
    const forward = vi.fn();

    const { replaySessionEventPages } = await import("./session-api");
    await expect(
      replaySessionEventPages("sess_1", { afterEventId: "event_000" }, forward),
    ).resolves.toEqual({
      cursor: { afterEventId: "event_201", sinceMs: undefined },
      complete: true,
    });

    expect(bus.recentEvents).toHaveBeenNthCalledWith(1, "sess_1", {
      afterEventId: "event_000",
      sinceMs: undefined,
      limit: 200,
    });
    expect(bus.recentEvents).toHaveBeenNthCalledWith(2, "sess_1", {
      afterEventId: "event_200",
      sinceMs: undefined,
      limit: 200,
    });
    expect(forward).toHaveBeenCalledTimes(201);
  });
});
