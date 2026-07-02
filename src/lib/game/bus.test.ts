import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_EVENT_TYPES } from "./events";

const db = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    eventLog: {
      findFirst: db.findFirst,
      findMany: db.findMany,
    },
  },
}));

describe("recentEvents", () => {
  beforeEach(() => {
    db.findFirst.mockReset();
    db.findMany.mockReset();
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
});
