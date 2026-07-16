import { DM_TURN_LOCK_TTL_MS } from "./turn-lock";

export const PENDING_TURN_WAKE_RETRY_MS = DM_TURN_LOCK_TTL_MS + 1_000;

const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const drainStates = new Map<
  string,
  { running: boolean; rerunRequested: boolean }
>();
let registeredDrainer: ((sessionId: string) => Promise<boolean>) | null = null;

export function registerPendingTurnDrainer(
  drainer: (sessionId: string) => Promise<boolean>,
) {
  registeredDrainer = drainer;
}

/**
 * Wakes the FIFO immediately and once more after the maximum stale-lock TTL.
 * Timers are deduplicated per session so multiple SSE reconnects cannot create
 * an unbounded retry storm.
 */
export function schedulePendingTurnDrain(sessionId: string) {
  requestImmediateDrain(sessionId);

  if (!retryTimers.has(sessionId)) {
    const timer = setTimeout(() => {
      retryTimers.delete(sessionId);
      requestImmediateDrain(sessionId);
    }, PENDING_TURN_WAKE_RETRY_MS);
    timer.unref?.();
    retryTimers.set(sessionId, timer);
  }
}

function requestImmediateDrain(sessionId: string) {
  const state = drainStates.get(sessionId) ?? {
    running: false,
    rerunRequested: false,
  };
  drainStates.set(sessionId, state);
  if (state.running) {
    state.rerunRequested = true;
    return;
  }

  state.running = true;
  void (async () => {
    try {
      do {
        state.rerunRequested = false;
        await runDrain(sessionId);
      } while (state.rerunRequested);
    } finally {
      state.running = false;
      if (!state.rerunRequested) drainStates.delete(sessionId);
    }
  })();
}

async function runDrain(sessionId: string) {
  try {
    if (!registeredDrainer) {
      const { drainPendingTurns } = await import("./session-api");
      registeredDrainer = drainPendingTurns;
    }
    await registeredDrainer(sessionId);
  } catch {
    // A future reconnect, turn finalizer, combat end, or stale-lock retry wakes
    // the queue again; request paths must never fail because of this helper.
  }
}
