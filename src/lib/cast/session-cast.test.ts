import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ gameSessionFindFirst: vi.fn() }));
const agent = vi.hoisted(() => ({
  listDevices: vi.fn(),
  startCast: vi.fn(),
  stopCast: vi.fn(),
}));
const capability = vi.hoisted(() => ({
  activateDisplayCapability: vi.fn(),
  revokeDisplayCapability: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { gameSession: { findFirst: db.gameSessionFindFirst } },
}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    APP_URL: "https://table.example",
    CAST_AGENT_SOCKET: "/run/plum-cast/agent.sock",
    INVITE_HMAC_SECRET: "test-secret-with-at-least-sixteen-characters",
  }),
}));
vi.mock("./display-capability", () => ({
  DisplayCapabilityStoreError: class DisplayCapabilityStoreError extends Error {},
  activateDisplayCapability: capability.activateDisplayCapability,
  revokeDisplayCapability: capability.revokeDisplayCapability,
}));
vi.mock("./agent-client", () => ({
  CastAgentError: class CastAgentError extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(code);
    }
  },
  createCastAgentClient: () => agent,
}));

describe("host session casting capabilities", () => {
  beforeEach(() => {
    vi.resetModules();
    db.gameSessionFindFirst.mockReset();
    Object.values(agent).forEach((mock) => mock.mockReset());
    Object.values(capability).forEach((mock) => mock.mockReset());

    db.gameSessionFindFirst.mockResolvedValue({
      id: "session-a",
      endedAt: null,
    });
    capability.activateDisplayCapability.mockResolvedValue(undefined);
    capability.revokeDisplayCapability.mockResolvedValue(true);
    agent.startCast.mockResolvedValue({
      state: "starting",
      deviceId: "cast-a",
      deviceName: "Wohnzimmer",
    });
    agent.stopCast.mockResolvedValue({
      state: "stopped",
      deviceId: "cast-a",
    });
  });

  it("activates a fresh capability before handing its signed URL to the agent", async () => {
    const { startCastForHost } = await import("./session-cast");

    await startCastForHost("session-a", "host-a", "cast-a");

    const claims = capability.activateDisplayCapability.mock.calls[0]?.[0];
    expect(claims).toMatchObject({
      version: 2,
      audience: "plum-display",
      sessionId: "session-a",
    });
    expect(claims.capabilityId).toMatch(/^[0-9a-f-]{36}$/);
    expect(agent.startCast).toHaveBeenCalledWith({
      sessionId: "session-a",
      deviceId: "cast-a",
      url: expect.stringMatching(
        /^https:\/\/table\.example\/display\/sessions\/session-a\//,
      ),
    });
    expect(
      capability.activateDisplayCapability.mock.invocationCallOrder[0],
    ).toBeLessThan(agent.startCast.mock.invocationCallOrder[0]!);
  });

  it("removes only the just-issued capability when agent startup fails", async () => {
    agent.startCast.mockRejectedValue(new Error("agent down"));
    const { startCastForHost } = await import("./session-cast");

    await expect(
      startCastForHost("session-a", "host-a", "cast-a"),
    ).rejects.toMatchObject({ code: "cast_agent_unavailable", status: 503 });

    const claims = capability.activateDisplayCapability.mock.calls[0]?.[0];
    expect(capability.revokeDisplayCapability).toHaveBeenCalledWith(
      "session-a",
      claims.capabilityId,
    );
  });

  it("revokes the receiver before asking the agent to stop the device", async () => {
    const { stopCastForHost } = await import("./session-cast");

    await stopCastForHost("session-a", "host-a", "cast-a");

    expect(capability.revokeDisplayCapability).toHaveBeenCalledWith(
      "session-a",
    );
    expect(
      capability.revokeDisplayCapability.mock.invocationCallOrder[0],
    ).toBeLessThan(agent.stopCast.mock.invocationCallOrder[0]!);
  });

  it("still attempts physical stop when the capability store is unavailable", async () => {
    capability.revokeDisplayCapability.mockRejectedValue(
      new Error("redis down"),
    );
    const { stopCastForHost } = await import("./session-cast");

    await expect(
      stopCastForHost("session-a", "host-a", "cast-a"),
    ).rejects.toMatchObject({
      code: "display_capability_unavailable",
      status: 503,
    });
    expect(agent.stopCast).toHaveBeenCalledWith({
      sessionId: "session-a",
      deviceId: "cast-a",
    });
  });

  it("allows an ended session to revoke and stop its existing TV output", async () => {
    db.gameSessionFindFirst.mockResolvedValue({
      id: "session-a",
      endedAt: new Date(),
    });
    const { stopCastForHost } = await import("./session-cast");

    await expect(
      stopCastForHost("session-a", "host-a", "cast-a"),
    ).resolves.toMatchObject({ state: "stopped" });
    expect(capability.revokeDisplayCapability).toHaveBeenCalledWith(
      "session-a",
    );
    expect(agent.stopCast).toHaveBeenCalled();
  });

  it("does not mint a new receiver capability for an ended session", async () => {
    db.gameSessionFindFirst.mockResolvedValue({
      id: "session-a",
      endedAt: new Date(),
    });
    const { startCastForHost } = await import("./session-cast");

    await expect(
      startCastForHost("session-a", "host-a", "cast-a"),
    ).rejects.toMatchObject({ code: "session_closed", status: 410 });
    expect(capability.activateDisplayCapability).not.toHaveBeenCalled();
    expect(agent.startCast).not.toHaveBeenCalled();
  });
});
