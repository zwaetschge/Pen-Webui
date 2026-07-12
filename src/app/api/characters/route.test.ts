import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const db = vi.hoisted(() => ({
  campaignFindUnique: vi.fn(),
  npcFindFirst: vi.fn(),
  characterCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: auth.requireUser,
  AuthError: class AuthError extends Error {
    code = "unauthorized";
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: { findUnique: db.campaignFindUnique },
    nPC: { findFirst: db.npcFindFirst },
    character: { create: db.characterCreate },
  },
}));

describe("character creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUser.mockResolvedValue({ id: "host_1" });
    db.campaignFindUnique.mockResolvedValue({ id: "camp_1", hostId: "host_1" });
    db.npcFindFirst.mockResolvedValue({
      id: "npc_1",
      name: "Elinor Hale",
      role: "Wirtin und heimliche Informantin",
      description: "Eine wachsame Frau mit silberner Haarsträhne.",
      portraitAssetId: "portrait_1",
      tokenAssetId: "token_1",
    });
    db.characterCreate.mockImplementation(async ({ data }) => ({
      id: "char_1",
      ...data,
    }));
  });

  it("keeps NPC narrative fields when an empty template form customizes mechanics", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://app/api/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignId: "camp_1",
          sourceNpcId: "npc_1",
          sheet: {
            class: "Rogue",
            race: "Human",
            appearance: "",
            backstory: "",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.characterCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        portraitAssetId: "portrait_1",
        tokenAssetId: "token_1",
        sheet: expect.objectContaining({
          class: "Rogue",
          race: "Human",
          appearance: "Eine wachsame Frau mit silberner Haarsträhne.",
          backstory:
            "Wirtin und heimliche Informantin\n\nEine wachsame Frau mit silberner Haarsträhne.",
          sourceNpcId: "npc_1",
          sourceNpcName: "Elinor Hale",
        }),
      }),
    });
  });
});
