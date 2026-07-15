import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gameSessionFindUnique: vi.fn(),
}));
const bootstrap = vi.hoisted(() => ({ ensure: vi.fn() }));
const bus = vi.hoisted(() => ({
  recentEvents: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  messageHandler: undefined as
    | ((channel: string, message: string) => void)
    | undefined,
}));
const waker = vi.hoisted(() => ({
  register: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSession: { findUnique: db.gameSessionFindUnique },
    encounter: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/dm/orchestrator", () => ({ runDmTurn: vi.fn() }));
vi.mock("./access", () => ({ resolveAccess: vi.fn() }));
vi.mock("./acting", () => ({ resolveActingIdentity: vi.fn() }));
vi.mock("./bootstrap", () => ({
  ensureSessionBootstrap: bootstrap.ensure,
}));
vi.mock("./bus", () => ({
  channel: (sessionId: string) => `session:${sessionId}`,
  publishEvent: vi.fn(),
  recentEvents: bus.recentEvents,
  subClient: () => ({
    on: bus.on,
    subscribe: bus.subscribe,
    unsubscribe: bus.unsubscribe,
    quit: bus.quit,
  }),
}));
vi.mock("./pending-turns", () => ({
  acknowledgePendingTurn: vi.fn(),
  claimPendingTurn: vi.fn(),
  enqueuePendingTurn: vi.fn(),
}));
vi.mock("./pending-turn-waker", () => ({
  registerPendingTurnDrainer: waker.register,
  schedulePendingTurnDrain: waker.schedule,
}));
vi.mock("./turn-lock", () => ({
  acquireDmTurnLock: vi.fn(),
  acquireDmTurnLockIfQueueEmpty: vi.fn(),
  confirmDmTurnLockOwned: vi.fn(),
  releaseDmTurnLock: vi.fn(),
}));

describe("session SSE EventLog catch-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    db.gameSessionFindUnique.mockResolvedValue({ id: "sess_1" });
    bootstrap.ensure.mockResolvedValue(false);
    bus.subscribe.mockResolvedValue(1);
    bus.unsubscribe.mockResolvedValue(1);
    bus.quit.mockResolvedValue("OK");
    bus.messageHandler = undefined;
    bus.on.mockImplementation(
      (event: string, handler: (channel: string, message: string) => void) => {
        if (event === "message") bus.messageHandler = handler;
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers a durable event that never arrived through Redis Pub/Sub", async () => {
    const missedEvent = {
      id: "event_missed",
      type: "narrate",
      payload: { text: "Die Tür fällt ins Schloss." },
      ts: Date.now() + 1,
      scope: "all" as const,
    };
    bus.recentEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([missedEvent]);
    const abort = new AbortController();
    const request = new Request(
      "http://app/api/display/sessions/sess_1/stream/token",
      { signal: abort.signal },
    );

    const { handleReadonlySessionStream } = await import("./session-api");
    const response = await handleReadonlySessionStream(request, "sess_1");
    const reader = response.body!.getReader();

    const hello = await reader.read();
    expect(new TextDecoder().decode(hello.value)).toContain("event: hello");
    await vi.waitFor(() => expect(bus.recentEvents).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(bus.recentEvents).toHaveBeenCalledTimes(2));
    const recovered = await reader.read();
    const recoveredText = new TextDecoder().decode(recovered.value);
    expect(recoveredText).toContain("id: event_missed");
    expect(recoveredText).toContain("Die Tür fällt ins Schloss.");

    abort.abort();
    await vi.runAllTimersAsync();
  });

  it("uses a live notification to recover missed events in EventLog order", async () => {
    const missedFirst = {
      id: "event_a",
      type: "token_moved",
      payload: { tokenId: "hero", x: 2, y: 2 },
      ts: Date.now() + 1,
      scope: "all" as const,
    };
    const publishedSecond = {
      id: "event_b",
      type: "token_moved",
      payload: { tokenId: "hero", x: 3, y: 2 },
      ts: Date.now() + 2,
      scope: "all" as const,
    };
    bus.recentEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([missedFirst, publishedSecond]);
    const abort = new AbortController();
    const request = new Request(
      "http://app/api/display/sessions/sess_1/stream/token",
      { signal: abort.signal },
    );

    const { handleReadonlySessionStream } = await import("./session-api");
    const response = await handleReadonlySessionStream(request, "sess_1");
    const reader = response.body!.getReader();
    await reader.read();
    await vi.waitFor(() => expect(bus.recentEvents).toHaveBeenCalledOnce());

    bus.messageHandler?.("session:sess_1", JSON.stringify(publishedSecond));
    await vi.waitFor(() => expect(bus.recentEvents).toHaveBeenCalledTimes(2));

    const first = new TextDecoder().decode((await reader.read()).value);
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("id: event_a");
    expect(first).toContain('"x":2');
    expect(second).toContain("id: event_b");
    expect(second).toContain('"x":3');

    abort.abort();
    await vi.runAllTimersAsync();
  });
});
