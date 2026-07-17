import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_EVENT_TYPES,
  CLIENT_EVENT_TYPES,
  CURRENT_BOOTSTRAP_EVENT_TYPE,
} from "./events";

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
        type: CURRENT_BOOTSTRAP_EVENT_TYPE,
        payload: { sceneTitle: "Opening" },
        scope: "all",
        ts: new Date("2026-06-02T10:00:00.000Z"),
      },
    ]);

    const events = await recentEvents("sess_1");

    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: { in: expect.arrayContaining([CURRENT_BOOTSTRAP_EVENT_TYPE]) },
        }),
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        id: "bootstrap_12",
        type: CURRENT_BOOTSTRAP_EVENT_TYPE,
      }),
    ]);
  });

  it("prepends the latest bootstrap when it has fallen out of the replay tail", async () => {
    const { recentEvents } = await import("./bus");
    db.findMany.mockResolvedValue([
      {
        id: "ev_202",
        type: "narrate",
        payload: { text: "latest" },
        scope: "all",
        ts: new Date("2026-06-02T10:03:22.000Z"),
      },
      {
        id: "ev_201",
        type: "narrate",
        payload: { text: "older" },
        scope: "all",
        ts: new Date("2026-06-02T10:03:21.000Z"),
      },
    ]);
    db.findFirst.mockResolvedValue({
      id: "bootstrap_current",
      type: CURRENT_BOOTSTRAP_EVENT_TYPE,
      payload: { sceneTitle: "Auftakt" },
      scope: "all",
      ts: new Date("2026-06-02T10:00:00.000Z"),
    });

    const events = await recentEvents("sess_1");

    expect(db.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: "sess_1",
        type: { in: [...BOOTSTRAP_EVENT_TYPES] },
      },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      select: {
        id: true,
        type: true,
        payload: true,
        scope: true,
        ts: true,
      },
    });
    expect(events.map((event) => event.id)).toEqual([
      "bootstrap_current",
      "ev_201",
      "ev_202",
    ]);
  });

  it("backfills a retained legacy bootstrap for a running v12 session", async () => {
    const { recentEvents } = await import("./bus");
    db.findMany.mockResolvedValue([
      {
        id: "ev_latest",
        type: "narrate",
        payload: { text: "Aktuelle Szene" },
        scope: "all",
        ts: new Date("2026-06-02T10:04:00.000Z"),
      },
    ]);
    db.findFirst.mockResolvedValue({
      id: "bootstrap_v12",
      type: "session_bootstrap_v12",
      payload: { sceneTitle: "Laufende Szene" },
      scope: "all",
      ts: new Date("2026-06-02T10:00:00.000Z"),
    });

    const events = await recentEvents("sess_1");

    expect(events.map((event) => event.id)).toEqual([
      "bootstrap_v12",
      "ev_latest",
    ]);
  });

  it("replays the latest scene anchor after bootstrap when both fell out of the tail", async () => {
    const { recentEvents } = await import("./bus");
    db.findMany.mockResolvedValue([
      {
        id: "ev_latest",
        type: "narrate",
        payload: { text: "Aktuelle Erzählung" },
        scope: "all",
        ts: new Date("2026-06-02T10:04:00.000Z"),
      },
    ]);
    db.findFirst
      .mockResolvedValueOnce({
        id: "bootstrap_v12",
        type: "session_bootstrap_v12",
        payload: { sceneTitle: "Auftakt" },
        scope: "all",
        ts: new Date("2026-06-02T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "scene_current",
        type: "scene_set",
        payload: { locationName: "Alte Mühle" },
        scope: "all",
        ts: new Date("2026-06-02T10:02:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "combat_closed",
        type: "combat_ended",
        payload: {},
        scope: "all",
        ts: new Date("2026-06-02T10:03:00.000Z"),
      });

    const events = await recentEvents("sess_1");

    expect(events.map((event) => event.id)).toEqual([
      "bootstrap_v12",
      "scene_current",
      "ev_latest",
    ]);
  });

  it("backfills the last shared-stage state when it fell out of the replay tail", async () => {
    const { recentEvents } = await import("./bus");
    db.findMany.mockResolvedValue([
      {
        id: "player_202",
        type: "player_input",
        payload: { text: "Wir warten." },
        scope: "all",
        ts: new Date("2026-06-02T10:04:02.000Z"),
      },
      {
        id: "player_201",
        type: "player_input",
        payload: { text: "Noch hier." },
        scope: "all",
        ts: new Date("2026-06-02T10:04:01.000Z"),
      },
    ]);
    db.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "stage_cinematic",
        type: "stage_view_set",
        payload: { view: "cinematic" },
        scope: "all",
        ts: new Date("2026-06-02T10:03:00.000Z"),
      });

    const events = await recentEvents("sess_1");

    expect(db.findFirst).toHaveBeenLastCalledWith({
      where: {
        sessionId: "sess_1",
        type: {
          in: [
            "narrate",
            "stage_view_set",
            "scene_set",
            "combat_started",
            "scene_ended",
          ],
        },
      },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      select: {
        id: true,
        type: true,
        payload: true,
        scope: true,
        ts: true,
      },
    });
    expect(events.map((event) => event.id)).toEqual([
      "stage_cinematic",
      "player_201",
      "player_202",
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
    expect(db.findFirst).toHaveBeenCalledTimes(1);
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: "sess_1",
          type: { in: CLIENT_EVENT_TYPES },
          OR: [{ ts: { gt: cursorTs } }, { ts: cursorTs, id: { gt: "ev_3" } }],
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

  it("keeps the durable event when a bounded live publish times out", async () => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    db.create.mockResolvedValue({
      id: "ev_hung",
      ts: new Date("2026-06-02T10:00:00.000Z"),
    });
    redisClient.publish.mockReturnValue(new Promise(() => undefined));
    const { publishEvent } = await import("./bus");

    try {
      const publishing = publishEvent("sess_1", "narrate", { text: "saved" });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(publishing).resolves.toMatchObject({ id: "ev_hung" });
      expect(db.create).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "Game event persisted but live broadcast failed",
        expect.objectContaining({
          sessionId: "sess_1",
          eventId: "ev_hung",
          type: "narrate",
        }),
      );
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reuses and rebroadcasts a deterministic event after an ambiguous retry", async () => {
    db.create.mockRejectedValue({ code: "P2002" });
    db.findFirst.mockResolvedValue({
      id: "pending_queued_1",
      type: "player_input",
      payload: { text: "already saved" },
      scope: "all",
      ts: new Date("2026-06-02T10:00:00.000Z"),
    });
    redisClient.status = "ready";
    redisClient.publish.mockResolvedValue(1);
    const { publishEvent } = await import("./bus");

    await expect(
      publishEvent(
        "sess_1",
        "player_input",
        { text: "retry" },
        { eventId: "pending_queued_1" },
      ),
    ).resolves.toMatchObject({
      id: "pending_queued_1",
      payload: { text: "already saved" },
    });
    expect(db.findFirst).toHaveBeenCalledWith({
      where: {
        id: "pending_queued_1",
        sessionId: "sess_1",
        type: "player_input",
      },
      select: {
        id: true,
        type: true,
        payload: true,
        scope: true,
        ts: true,
      },
    });
    expect(redisClient.publish).toHaveBeenCalledOnce();
  });
});
