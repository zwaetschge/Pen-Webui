import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capability = vi.hoisted(() => ({
  isDisplayCapabilityActive: vi.fn(),
  resolveActiveDisplayCapability: vi.fn(),
}));
const stream = vi.hoisted(() => ({
  handleReadonlySessionStream: vi.fn(),
}));
const config = vi.hoisted(() => ({
  env: vi.fn(() => ({ INVITE_HMAC_SECRET: "test-secret" })),
}));

vi.mock("@/lib/cast/display-capability", () => capability);
vi.mock("@/lib/game/session-api", () => stream);
vi.mock("@/lib/env", () => config);

const context = {
  params: Promise.resolve({ id: "session-a", token: "display-token" }),
};

describe("display stream route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    config.env.mockReturnValue({ INVITE_HMAC_SECRET: "test-secret" });
    capability.resolveActiveDisplayCapability.mockResolvedValue({
      version: 2,
      audience: "plum-display",
      sessionId: "session-a",
      capabilityId: "capability-a",
      expiryUnix: Math.floor(Date.now() / 1000) + 3600,
    });
    capability.isDisplayCapabilityActive.mockResolvedValue(true);
    stream.handleReadonlySessionStream.mockResolvedValue(
      new Response("stream", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the player-safe stream for a valid display capability", async () => {
    const { GET } = await import("./route");
    const request = new Request("https://table.example/display");

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(stream.handleReadonlySessionStream).toHaveBeenCalledWith(
      expect.objectContaining({ url: request.url }),
      "session-a",
    );
  });

  it("rejects invalid display capabilities without touching the stream", async () => {
    const { GET } = await import("./route");
    capability.resolveActiveDisplayCapability.mockResolvedValue(null);

    const response = await GET(
      new Request("https://table.example/display"),
      context,
    );

    expect(response.status).toBe(403);
    expect(stream.handleReadonlySessionStream).not.toHaveBeenCalled();
  });

  it("aborts an already-open stream shortly after its capability is revoked", async () => {
    vi.useFakeTimers();
    capability.resolveActiveDisplayCapability.mockResolvedValue({
      version: 2,
      audience: "plum-display",
      sessionId: "session-a",
      capabilityId: "capability-a",
      expiryUnix: Math.floor(Date.now() / 1000) + 3600,
    });
    capability.isDisplayCapabilityActive.mockResolvedValue(false);
    stream.handleReadonlySessionStream.mockResolvedValue(
      new Response(new ReadableStream({ start() {} }), { status: 200 }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://table.example/display"),
      context,
    );
    const guardedRequest =
      stream.handleReadonlySessionStream.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(guardedRequest.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(guardedRequest.signal.aborted).toBe(true);
  });
});
