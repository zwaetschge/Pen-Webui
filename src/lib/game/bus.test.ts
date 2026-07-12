import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_EVENT_TYPES } from "./events";

const db = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));
const redisClient = vi.hoisted(() => ({
  status: "wait",
  connect: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
  publish: vi.fn(),
}));
const redisConstructor = vi.hoisted(() => vi.fn(() => redisClient));

vi.mock("ioredis", () => ({ default: redisConstructor }));

vi.mock("../db", () => ({
  prisma: {
    eventLog: {
      create: db.create,
      findFirst: db.findFirst,
      findMany: db.findMany,
    },
  },
}));

describe("recentEvents", () => {
  beforeEach(() => {
    db.findFirst.mockReset();
    db.findMany.mockReset();
    db.create.mockReset();
    redisClient.status = "wait";
    redisClient.connect.mockReset();
    redisClient.connect.mockImplementation(async () => {
      redisClient.status = "ready";
    });
    redisClient.once.mockReset();
    redisClient.removeListener.mockReset();
    redisClient.publish.mockReset();
  });

  it("loads only client-visible event types and returns tail events chronologically", async () => {
    const { recentEvents } = await import("./bus");
    db.findMany.mockResolvedValue([
      {
        id: "ev_2",
        type: "narrate",
        payload: { text: "second" },
        ts: new Date("2026-06-02T10:00:02.000Z"),
      },
      {
        id: "ev_1",
        type: "player_input",
        payload: { text: "first" },
        ts: new Date("2026-06-02T10:00:01.000Z"),
      },
    ]);

    const events = await recentEvents("sess_1");

    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: "sess_1",
          type: { in: CLIENT_EVENT_TYPES },
        },
        orderBy: [{ ts: "desc" }, { id: "desc" }],
        take: 200,
      }),
    );
    expect(events.map((event) => event.id)).toEqual(["ev_1", "ev_2"]);
  });

  it("includes the current bootstrap event in replay queries", async () => {
    const { recentEvents } = await import("./bus");
    db.findMany.mockResolvedValue([
      {
        id: "bootstrap_12",
        type: "session_bootstrap_v12",
        payload: { sceneTitle: "Opening" },
        scope: "all",
        ts: new Date("2026-06-02T10:00:00.000Z"),
      },
    ]);

    const events = await recentEvents("sess_1");

    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: { in: expect.arrayContaining(["session_bootstrap_v12"]) },
        }),
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        id: "bootstrap_12",
        type: "session_bootstrap_v12",
      }),
    ]);
  });

  it("uses an event id cursor with a capped incremental replay limit", async () => {
    const { recentEvents } = await import("./bus");
    const cursorTs = new Date("2026-06-02T10:00:03.000Z");
    db.findFirst.mockResolvedValue({ id: "ev_3", ts: cursorTs });
    db.findMany.mockResolvedValue([]);

    await recentEvents("sess_1", {
      afterEventId: "ev_3",
      sinceMs: Date.parse("2026-06-02T09:00:00.000Z"),
      limit: 10_000,
    });

    expect(db.findFirst).toHaveBeenCalledWith({
      where: { id: "ev_3", sessionId: "sess_1" },
      select: { id: true, ts: true },
    });
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: "sess_1",
          type: { in: CLIENT_EVENT_TYPES },
          ts: { gte: cursorTs },
        },
        orderBy: [{ ts: "asc" }, { id: "asc" }],
        take: 500,
      }),
    );
  });

  it("configures the publisher to fail fast without an offline queue", async () => {
    const { pubClient } = await import("./bus");

    pubClient();

    expect(redisConstructor).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        commandTimeout: 5_000,
      }),
    );
  });

  it("connects the fail-fast publisher before its first command", async () => {
    db.create.mockResolvedValue({
      id: "ev_first",
      ts: new Date("2026-06-02T10:00:00.000Z"),
    });
    redisClient.publish.mockImplementation(async () => {
      if (redisClient.status !== "ready") {
        throw new Error(
          "Stream isn't writeable and enableOfflineQueue is false",
        );
      }
      return 1;
    });
    const { publishEvent } = await import("./bus");

    await publishEvent("sess_1", "narrate", { text: "first" });

    expect(redisClient.connect).toHaveBeenCalledTimes(1);
    expect(redisClient.connect.mock.invocationCallOrder[0]).toBeLessThan(
      redisClient.publish.mock.invocationCallOrder[0],
    );
  });

  it("bounds a publish command after persisting the canonical event", async () => {
    vi.useFakeTimers();
    db.create.mockResolvedValue({
      id: "ev_hung",
      ts: new Date("2026-06-02T10:00:00.000Z"),
    });
    redisClient.publish.mockReturnValue(new Promise(() => undefined));
    const { publishEvent } = await import("./bus");

    try {
      const publishing = publishEvent("sess_1", "narrate", { text: "saved" });
      const rejection = expect(publishing).rejects.toThrow(
        "Redis publish timed out",
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);

      await rejection;
      expect(db.create).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
