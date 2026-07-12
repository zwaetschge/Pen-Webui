import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireDM: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN_NOT_DM") {
      super(code);
    }
  },
}));

const pairing = vi.hoisted(() => ({
  pairingStateForHost: vi.fn(),
  ensurePairingForHost: vi.fn(),
  reissuePairingForHost: vi.fn(),
}));

vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/game/pairing", () => pairing);

const context = { params: Promise.resolve({ id: "session-a" }) };

describe("session pairing route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.requireDM.mockResolvedValue({ id: "host-a" });
    pairing.pairingStateForHost.mockResolvedValue({
      sessionId: "session-a",
      seats: [],
    });
    pairing.ensurePairingForHost.mockResolvedValue({
      sessionId: "session-a",
      seats: [],
    });
    pairing.reissuePairingForHost.mockResolvedValue({
      characterId: "char-a",
      characterName: "Elinor",
      status: "ready",
      invitePath: "/play/invite/code",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("GET reports state without ensuring invites", async () => {
    const { GET } = await import("./route");

    const response = await GET(new Request("http://app"), context);

    expect(response.status).toBe(200);
    expect(pairing.pairingStateForHost).toHaveBeenCalledWith(
      "session-a",
      "host-a",
    );
    expect(pairing.ensurePairingForHost).not.toHaveBeenCalled();
  });

  it("POST ensures a live invite for each seat", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://app", { method: "POST" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(pairing.ensurePairingForHost).toHaveBeenCalledWith(
      "session-a",
      "host-a",
    );
  });

  it("DELETE validates the character and reissues the seat", async () => {
    const { DELETE } = await import("./route");
    const request = new Request("http://app", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "char-a" }),
    });

    const response = await DELETE(request, context);

    expect(response.status).toBe(200);
    expect(pairing.reissuePairingForHost).toHaveBeenCalledWith(
      "session-a",
      "host-a",
      "char-a",
    );
  });

  it("rejects malformed DELETE bodies", async () => {
    const { DELETE } = await import("./route");
    const request = new Request("http://app", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "" }),
    });

    const response = await DELETE(request, context);

    expect(response.status).toBe(400);
    expect(pairing.reissuePairingForHost).not.toHaveBeenCalled();
  });

  it("returns 404 for sessions outside the host campaign", async () => {
    const { POST } = await import("./route");
    pairing.ensurePairingForHost.mockResolvedValue(null);

    const response = await POST(
      new Request("http://app", { method: "POST" }),
      context,
    );

    expect(response.status).toBe(404);
  });

  it("rejects unauthenticated callers before pairing work", async () => {
    const { POST } = await import("./route");
    auth.requireDM.mockRejectedValue(new auth.AuthError("UNAUTHENTICATED"));

    const response = await POST(
      new Request("http://app", { method: "POST" }),
      context,
    );

    expect(response.status).toBe(401);
    expect(pairing.ensurePairingForHost).not.toHaveBeenCalled();
  });
});
