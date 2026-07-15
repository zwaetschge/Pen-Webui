import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  eventFindFirst: vi.fn(),
  eventUpdateMany: vi.fn(),
  sessionFindUnique: vi.fn(),
  npcUpdateMany: vi.fn(),
}));
const bus = vi.hoisted(() => ({ publishEvent: vi.fn() }));
const bootstrapLock = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    eventLog: {
      findFirst: db.eventFindFirst,
      updateMany: db.eventUpdateMany,
    },
    gameSession: { findUnique: db.sessionFindUnique },
    nPC: { updateMany: db.npcUpdateMany },
  },
}));

vi.mock("./bus", () => ({ publishEvent: bus.publishEvent }));
vi.mock("./bootstrap-lock", () => ({
  acquireBootstrapLock: bootstrapLock.acquire,
  releaseBootstrapLock: bootstrapLock.release,
}));

describe("ensureSessionBootstrap migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bus.publishEvent.mockResolvedValue({});
    db.eventUpdateMany.mockResolvedValue({ count: 4 });
    bootstrapLock.acquire.mockResolvedValue({ key: "lock", token: "token" });
    bootstrapLock.release.mockResolvedValue(undefined);
  });

  it("rebuilds a pre-play v12 session as v13 under a reconnect lock", async () => {
    const legacyTs = new Date("2026-07-15T12:00:00.000Z");
    db.eventFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ts: legacyTs })
      .mockResolvedValueOnce(null);
    db.sessionFindUnique.mockResolvedValue(sessionFixture());

    const { ensureSessionBootstrap } = await import("./bootstrap");
    await expect(ensureSessionBootstrap("session_1")).resolves.toBe(true);

    expect(db.eventFindFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          sessionId: "session_1",
          type: "session_bootstrap_v13",
        },
      }),
    );
    expect(db.eventFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          sessionId: "session_1",
          type: "session_bootstrap_v13",
        },
      }),
    );
    expect(db.eventFindFirst).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: "session_1",
          type: { in: expect.arrayContaining(["session_bootstrap_v12"]) },
        }),
      }),
    );
    expect(db.eventUpdateMany).toHaveBeenCalledWith({
      where: {
        sessionId: "session_1",
        type: {
          in: expect.arrayContaining([
            "session_bootstrap_v12",
            "scene_set",
            "intro_sequence",
            "narrate",
          ]),
        },
        ts: {
          gte: legacyTs,
          lte: new Date("2026-07-15T12:00:15.000Z"),
        },
      },
      data: { type: "archived" },
    });
    expect(bus.publishEvent).toHaveBeenCalledWith(
      "session_1",
      "session_bootstrap_v13",
      expect.objectContaining({ version: 13, sceneTitle: "Auftakt" }),
    );
    expect(bootstrapLock.release).toHaveBeenCalledWith({
      key: "lock",
      token: "token",
    });
  });

  it("does not migrate a running legacy session back to its opening scene", async () => {
    const legacyTs = new Date("2026-07-15T12:00:00.000Z");
    const firstPlayerTurnTs = new Date("2026-07-15T12:00:20.000Z");
    db.eventFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ts: legacyTs })
      .mockResolvedValueOnce({ ts: firstPlayerTurnTs });
    db.sessionFindUnique.mockResolvedValue(sessionFixture());

    const { ensureSessionBootstrap } = await import("./bootstrap");
    await expect(ensureSessionBootstrap("session_1")).resolves.toBe(false);

    expect(db.eventUpdateMany).not.toHaveBeenCalled();
    expect(db.sessionFindUnique).not.toHaveBeenCalled();
    expect(bus.publishEvent).not.toHaveBeenCalled();
    expect(bootstrapLock.release).toHaveBeenCalledOnce();
  });

  it("treats a dice roll as gameplay even before the first player message", async () => {
    const legacyTs = new Date("2026-07-15T12:00:00.000Z");
    const firstRollTs = new Date("2026-07-15T12:00:18.000Z");
    db.eventFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ts: legacyTs })
      .mockResolvedValueOnce({ ts: firstRollTs });

    const { ensureSessionBootstrap } = await import("./bootstrap");
    await expect(ensureSessionBootstrap("session_1")).resolves.toBe(false);

    expect(db.eventFindFirst).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: "session_1",
          type: {
            in: expect.arrayContaining(["player_input", "dice_roll"]),
          },
          ts: { gt: legacyTs },
        }),
      }),
    );
    expect(db.eventUpdateMany).not.toHaveBeenCalled();
    expect(bus.publishEvent).not.toHaveBeenCalled();
  });

  it("does nothing when another reconnect owns the bootstrap lock", async () => {
    db.eventFindFirst.mockResolvedValueOnce(null);
    bootstrapLock.acquire.mockResolvedValueOnce(null);

    const { ensureSessionBootstrap } = await import("./bootstrap");
    await expect(ensureSessionBootstrap("session_1")).resolves.toBe(false);

    expect(db.eventFindFirst).toHaveBeenCalledOnce();
    expect(bootstrapLock.release).not.toHaveBeenCalled();
    expect(bus.publishEvent).not.toHaveBeenCalled();
  });
});

function sessionFixture() {
  return {
    campaign: {
      title: "Cypress Hollow",
      theme: "Mystery",
      world: null,
      scenes: [
        {
          title: "Opening",
          payload: {
            summary: "Eine Spur führt zum fast leeren Diner.",
            hook: "Eine anonyme Nachricht lockt euch in die Stadt.",
            presentNpcIds: [],
            introPlan: {
              establishingShot: "Regen liegt über der Kleinstadt.",
              setupBeats: [
                { title: "Das Diner", text: "Im Fenster flackert Licht." },
                { title: "Der Wagen", text: "Draußen läuft ein Motor." },
                { title: "Die Tür", text: "Hinten fällt ein Riegel zu." },
              ],
              objective: "Findet den Absender der Nachricht.",
              stakes: "Die Spur erkaltet vor Einbruch der Nacht.",
              firstPrompt: "Was tut ihr?",
            },
          },
        },
      ],
      locations: [],
      npcs: [],
      characters: [],
    },
  };
}
