import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drainPendingTurns = vi.fn();

import {
  PENDING_TURN_WAKE_RETRY_MS,
  registerPendingTurnDrainer,
  schedulePendingTurnDrain,
} from "./pending-turn-waker";

describe("pending-turn queue waker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    drainPendingTurns.mockReset().mockResolvedValue(false);
    registerPendingTurnDrainer(drainPendingTurns);
  });

  afterEach(() => vi.useRealTimers());

  it("wakes immediately and retries once after a possibly stale lock expires", async () => {
    schedulePendingTurnDrain("session-wake-1");
    await vi.waitFor(() => expect(drainPendingTurns).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(PENDING_TURN_WAKE_RETRY_MS);

    expect(drainPendingTurns).toHaveBeenCalledTimes(2);
  });

  it("keeps immediate wakeups while deduplicating the stale-lock timer", async () => {
    schedulePendingTurnDrain("session-wake-2");
    schedulePendingTurnDrain("session-wake-2");
    await vi.waitFor(() => expect(drainPendingTurns).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(PENDING_TURN_WAKE_RETRY_MS);

    expect(drainPendingTurns).toHaveBeenCalledTimes(3);
  });

  it("coalesces many wakeups during one drain into exactly one rerun", async () => {
    let finishFirst: (() => void) | undefined;
    drainPendingTurns.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishFirst = () => resolve(false);
        }),
    );

    schedulePendingTurnDrain("session-wake-3");
    await vi.waitFor(() => expect(drainPendingTurns).toHaveBeenCalledOnce());
    schedulePendingTurnDrain("session-wake-3");
    schedulePendingTurnDrain("session-wake-3");
    schedulePendingTurnDrain("session-wake-3");
    expect(drainPendingTurns).toHaveBeenCalledOnce();

    finishFirst?.();
    await vi.waitFor(() => expect(drainPendingTurns).toHaveBeenCalledTimes(2));
  });
});
