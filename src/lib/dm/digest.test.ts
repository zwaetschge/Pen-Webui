import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  campaignFindUniqueOrThrow: vi.fn(),
  sceneFindFirst: vi.fn(),
  encounterFindFirst: vi.fn(),
  eventFindFirst: vi.fn(),
  npcFindMany: vi.fn(),
  characterFindMany: vi.fn(),
  locationFindFirst: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    campaign: { findUniqueOrThrow: db.campaignFindUniqueOrThrow },
    scene: { findFirst: db.sceneFindFirst },
    encounter: { findFirst: db.encounterFindFirst },
    eventLog: { findFirst: db.eventFindFirst },
    nPC: { findMany: db.npcFindMany },
    character: { findMany: db.characterFindMany },
    location: { findFirst: db.locationFindFirst },
  },
}));

describe("buildDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.campaignFindUniqueOrThrow.mockResolvedValue({
      title: "Mira",
      theme: "Mystery",
      tone: "Tense",
      systemPromptOverride: null,
      world: { worldFacts: [], threads: [], loreBible: null },
    });
    db.sceneFindFirst.mockResolvedValue(null);
    db.encounterFindFirst.mockResolvedValue(null);
    db.eventFindFirst.mockResolvedValue(null);
    db.npcFindMany.mockResolvedValue([]);
    db.characterFindMany.mockResolvedValue([]);
    db.locationFindFirst.mockResolvedValue(null);
  });

  it("looks up live scene state from the current bootstrap event", async () => {
    const { buildDigest } = await import("./digest");

    await buildDigest("camp_1", "sess_1");

    expect(db.eventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: "sess_1",
          type: {
            in: expect.arrayContaining(["session_bootstrap_v12"]),
          },
        },
      }),
    );
  });
});
