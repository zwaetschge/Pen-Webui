import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
  eval: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
  acquireDmTurnLock,
  acquireDmTurnLockIfQueueEmpty,
  confirmDmTurnLockOwned,
  DM_TURN_LOCK_ACQUIRE_TIMEOUT_MS,
  DM_TURN_LOCK_RENEW_INTERVAL_MS,
  DM_TURN_LOCK_REDIS_TIMEOUT_MS,
  DM_TURN_LOCK_TTL_MS,
  releaseDmTurnLock,
} from "./turn-lock";

describe("DM turn lease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    redisMock.eval.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a JS-safe Redis-time fence that remains above a pre-reset client high-water", async () => {
    const timeFence = 1_700_000_000_000_123;
    redisMock.eval.mockResolvedValueOnce([1, String(timeFence)]);

    const lock = await acquireDmTurnLock("session-1");

    expect(lock?.fence).toBe(timeFence);
    expect(Number.isSafeInteger(lock?.fence)).toBe(true);
    const [script, keyCount, lockKey, fenceKey] = redisMock.eval.mock.calls[0]!;
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("stored + 1");
    expect(keyCount).toBe(2);
    expect(lockKey).toBe("dm-turn:session-1:lock");
    expect(fenceKey).toBe("dm-turn:session-1:fence");

    await releaseDmTurnLock(lock!);
  });

  it("atomically refuses a fresh turn while an older queue item exists", async () => {
    redisMock.eval.mockResolvedValueOnce([-1, ""]);

    await expect(
      acquireDmTurnLockIfQueueEmpty("session-1"),
    ).resolves.toBeNull();

    const [script, keyCount, lockKey, fenceKey, pendingKey, processingKey] =
      redisMock.eval.mock.calls[0]!;
    expect(script).toContain("redis.call('LLEN', KEYS[3])");
    expect(keyCount).toBe(4);
    expect(lockKey).toBe("dm-turn:session-1:lock");
    expect(fenceKey).toBe("dm-turn:session-1:fence");
    expect(pendingKey).toBe("dm-turn:session-1:pending");
    expect(processingKey).toBe("dm-turn:session-1:processing");
  });

  it("renews an owned lease and stops renewing after release", async () => {
    redisMock.eval
      .mockResolvedValueOnce([1, "1700000000000123"])
      .mockResolvedValue(1);
    const lock = await acquireDmTurnLock("session-1");

    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_RENEW_INTERVAL_MS * 4);
    const callsBeforeRelease = redisMock.eval.mock.calls.length;
    expect(callsBeforeRelease).toBeGreaterThan(1);

    await releaseDmTurnLock(lock!);
    const callsAfterRelease = redisMock.eval.mock.calls.length;
    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_RENEW_INTERVAL_MS * 2);
    expect(redisMock.eval).toHaveBeenCalledTimes(callsAfterRelease);
  });

  it("marks lease loss and rejects subsequent ownership confirmation", async () => {
    redisMock.eval
      .mockResolvedValueOnce([1, "1700000000000123"])
      .mockResolvedValueOnce(0);
    const lock = await acquireDmTurnLock("session-1");

    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_RENEW_INTERVAL_MS);

    await expect(confirmDmTurnLockOwned(lock!)).rejects.toThrow(
      "DM turn lease lost",
    );
  });

  it("fences a never-resolving renewal no later than its last confirmed TTL", async () => {
    redisMock.eval
      .mockResolvedValueOnce([1, "1700000000000123"])
      .mockReturnValueOnce(new Promise(() => undefined));
    const lock = await acquireDmTurnLock("session-1");

    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_TTL_MS);

    await expect(confirmDmTurnLockOwned(lock!)).rejects.toThrow(
      "DM turn lease lost",
    );
  });

  it("bounds an explicit ownership confirmation when Redis hangs", async () => {
    redisMock.eval
      .mockResolvedValueOnce([1, "1700000000000123"])
      .mockReturnValueOnce(new Promise(() => undefined));
    const lock = await acquireDmTurnLock("session-1");

    const confirmation = confirmDmTurnLockOwned(lock!);
    const rejected = expect(confirmation).rejects.toThrow("DM turn lease lost");
    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_REDIS_TIMEOUT_MS);

    await rejected;
  });

  it("clears maintenance synchronously and bounds release when Redis hangs", async () => {
    redisMock.eval
      .mockResolvedValueOnce([1, "1700000000000123"])
      .mockReturnValueOnce(new Promise(() => undefined));
    const lock = await acquireDmTurnLock("session-1");

    const releasing = releaseDmTurnLock(lock!);
    const callsAfterReleaseStarted = redisMock.eval.mock.calls.length;
    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_REDIS_TIMEOUT_MS);
    await releasing;
    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_RENEW_INTERVAL_MS * 2);

    expect(redisMock.eval).toHaveBeenCalledTimes(callsAfterReleaseStarted);
  });

  it("does not let a late renewal restore a released lease", async () => {
    let resolveRenewal!: (value: unknown) => void;
    const pendingRenewal = new Promise<unknown>((resolve) => {
      resolveRenewal = resolve;
    });
    redisMock.eval
      .mockResolvedValueOnce([1, "1700000000000123"])
      .mockReturnValueOnce(pendingRenewal)
      .mockResolvedValueOnce(1);
    const lock = await acquireDmTurnLock("session-1");

    const confirmation = confirmDmTurnLockOwned(lock!);
    await releaseDmTurnLock(lock!);
    resolveRenewal(1);
    await expect(confirmation).rejects.toThrow("DM turn lease lost");

    const callsBeforeSecondConfirmation = redisMock.eval.mock.calls.length;
    await expect(confirmDmTurnLockOwned(lock!)).rejects.toThrow(
      "DM turn lease lost",
    );
    expect(redisMock.eval).toHaveBeenCalledTimes(callsBeforeSecondConfirmation);
  });

  it("does not let a late renewal restore a lease already marked lost", async () => {
    let resolveRenewal!: (value: unknown) => void;
    redisMock.eval
      .mockResolvedValueOnce([1, "1700000000000123"])
      .mockReturnValueOnce(
        new Promise<unknown>((resolve) => {
          resolveRenewal = resolve;
        }),
      );
    const lock = await acquireDmTurnLock("session-1");

    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_RENEW_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_REDIS_TIMEOUT_MS);
    resolveRenewal(1);
    await Promise.resolve();

    const callsBeforeConfirmation = redisMock.eval.mock.calls.length;
    await expect(confirmDmTurnLockOwned(lock!)).rejects.toThrow(
      "DM turn lease lost",
    );
    expect(redisMock.eval).toHaveBeenCalledTimes(callsBeforeConfirmation);
  });

  it("fails closed and token-cleans an ambiguous acquisition rejection", async () => {
    redisMock.eval
      .mockRejectedValueOnce(new Error("connection reset after write"))
      .mockResolvedValueOnce(1);

    await expect(acquireDmTurnLock("session-1")).resolves.toBeNull();
    await Promise.resolve();

    expect(redisMock.eval).toHaveBeenCalledTimes(2);
    const cleanupCall = redisMock.eval.mock.calls[1]!;
    expect(cleanupCall[0]).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
    expect(cleanupCall[2]).toBe("dm-turn:session-1:lock");
  });

  it("fails closed on timeout and cleans up if the acquisition resolves late", async () => {
    let resolveAcquire!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveAcquire = resolve;
    });
    redisMock.eval.mockReturnValueOnce(pending).mockResolvedValueOnce(1);

    const acquiring = acquireDmTurnLock("session-1");
    await vi.advanceTimersByTimeAsync(DM_TURN_LOCK_ACQUIRE_TIMEOUT_MS);
    await expect(acquiring).resolves.toBeNull();

    resolveAcquire([1, "1700000000000123"]);
    await Promise.resolve();
    await Promise.resolve();

    expect(redisMock.eval).toHaveBeenCalledTimes(2);
    expect(redisMock.eval.mock.calls[1]?.[2]).toBe("dm-turn:session-1:lock");
  });
});
