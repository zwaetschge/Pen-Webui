import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireDM: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN_NOT_DM") {
      super(code);
    }
  },
}));

const casting = vi.hoisted(() => ({
  castStateForHost: vi.fn(),
  startCastForHost: vi.fn(),
  stopCastForHost: vi.fn(),
  CastSessionError: class CastSessionError extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(code);
    }
  },
}));

vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/cast/session-cast", () => casting);

const context = { params: Promise.resolve({ id: "session-a" }) };

describe("session cast route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.requireDM.mockResolvedValue({ id: "host-a" });
    casting.castStateForHost.mockResolvedValue({
      enabled: true,
      devices: [],
    });
    casting.startCastForHost.mockResolvedValue({
      state: "starting",
      deviceId: "cast-a",
      deviceName: "Wohnzimmer",
    });
    casting.stopCastForHost.mockResolvedValue({
      state: "stopped",
      deviceId: "cast-a",
    });
  });

  it("lists devices only after DM authentication and host ownership", async () => {
    const { GET } = await import("./route");

    const response = await GET(new Request("https://table.example"), context);

    expect(response.status).toBe(200);
    expect(casting.castStateForHost).toHaveBeenCalledWith(
      "session-a",
      "host-a",
    );
  });

  it("starts a selected server-side device without accepting a URL", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://table.example/api/sessions/session-a/cast", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://table.example",
        },
        body: JSON.stringify({ deviceId: "cast-a" }),
      }),
      context,
    );

    expect(response.status).toBe(202);
    expect(casting.startCastForHost).toHaveBeenCalledWith(
      "session-a",
      "host-a",
      "cast-a",
    );
  });

  it("rejects malformed bodies and cross-origin mutation requests", async () => {
    const { POST } = await import("./route");
    const malformed = await POST(
      new Request("https://table.example/api/sessions/session-a/cast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "" }),
      }),
      context,
    );
    const crossOrigin = await POST(
      new Request("https://table.example/api/sessions/session-a/cast", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ deviceId: "cast-a" }),
      }),
      context,
    );

    expect(malformed.status).toBe(400);
    expect(crossOrigin.status).toBe(403);
    expect(casting.startCastForHost).not.toHaveBeenCalled();
  });

  it("maps unavailable agents to a stable service error", async () => {
    const { GET } = await import("./route");
    casting.castStateForHost.mockRejectedValue(
      new casting.CastSessionError("cast_agent_unavailable", 503),
    );

    const response = await GET(new Request("https://table.example"), context);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cast_agent_unavailable" });
  });

  it("rejects unauthenticated callers before reaching the agent", async () => {
    const { GET } = await import("./route");
    auth.requireDM.mockRejectedValue(new auth.AuthError("UNAUTHENTICATED"));

    const response = await GET(new Request("https://table.example"), context);

    expect(response.status).toBe(401);
    expect(casting.castStateForHost).not.toHaveBeenCalled();
  });
});
