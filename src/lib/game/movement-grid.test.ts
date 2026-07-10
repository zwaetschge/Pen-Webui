import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  eventFindFirst: vi.fn(),
  locationFindFirst: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    eventLog: { findFirst: db.eventFindFirst },
    location: { findFirst: db.locationFindFirst },
  },
}));

describe("movementGridForSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.locationFindFirst.mockResolvedValue(null);
    db.eventFindFirst.mockResolvedValue({
      payload: { gridConfig: { columns: 12, rows: 10 } },
    });
  });

  it("recovers the movement grid from the current bootstrap event", async () => {
    const { movementGridForSession } = await import("./movement-grid");

    await expect(
      movementGridForSession({
        sessionId: "sess_1",
        campaignId: "camp_1",
        locationId: null,
      }),
    ).resolves.toEqual({ columns: 12, rows: 10 });

    expect(db.eventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: "sess_1",
          type: { in: expect.arrayContaining(["session_bootstrap_v12"]) },
        },
      }),
    );
  });
});
