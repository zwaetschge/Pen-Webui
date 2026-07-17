import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
}));
const busMock = vi.hoisted(() => ({
  publishEvent: vi.fn(),
}));

vi.mock("./access", () => ({
  resolveAccess: accessMock.resolveAccess,
}));

vi.mock("./bus", () => ({
  publishEvent: busMock.publishEvent,
}));

function request(body: unknown, origin = "https://table.example") {
  return new Request(
    "https://table.example/api/sessions/session-a/stage-view",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("shared stage view API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "session-a",
      campaignId: "campaign-a",
      userId: "host-a",
    });
    busMock.publishEvent.mockResolvedValue({
      id: "event-stage",
      type: "stage_view_set",
      payload: { view: "map" },
      ts: 10,
    });
  });

  it.each(["map", "cinematic"] as const)(
    "publishes %s for every connected screen",
    async (view) => {
      const { handleStageView } = await import("./stage-view-api");
      const response = await handleStageView(
        request({ view }),
        "session-a",
      );

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true, view });
      expect(busMock.publishEvent).toHaveBeenCalledWith(
        "session-a",
        "stage_view_set",
        { view },
        { actorId: "host-a" },
      );
    },
  );

  it("rejects player, malformed and cross-origin commands", async () => {
    const { handleStageView } = await import("./stage-view-api");
    accessMock.resolveAccess.mockResolvedValueOnce({
      role: "player",
      sessionId: "session-a",
      campaignId: "campaign-a",
      userId: "player-a",
      characterId: "hero-a",
    });

    const player = await handleStageView(
      request({ view: "map" }),
      "session-a",
    );
    const malformed = await handleStageView(
      request({ view: "archive" }),
      "session-a",
    );
    const crossOrigin = await handleStageView(
      request({ view: "map" }, "https://attacker.example"),
      "session-a",
    );

    expect(player.status).toBe(403);
    expect(malformed.status).toBe(400);
    expect(crossOrigin.status).toBe(403);
    expect(busMock.publishEvent).not.toHaveBeenCalled();
  });
});
