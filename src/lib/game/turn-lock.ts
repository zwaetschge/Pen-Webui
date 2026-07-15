import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";

export const DM_TURN_LOCK_TTL_MS = 180_000;
export const DM_TURN_LOCK_RENEW_INTERVAL_MS = 60_000;
export const DM_TURN_LOCK_ACQUIRE_TIMEOUT_MS = 2_000;
export const DM_TURN_LOCK_REDIS_TIMEOUT_MS = 5_000;

const MAX_SAFE_FENCE = Number.MAX_SAFE_INTEGER;

const ACQUIRE_SCRIPT = `
local acquired = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
if not acquired then
  return {0, ''}
end

local now = redis.call('TIME')
local epochMicros = (tonumber(now[1]) * 1000000) + tonumber(now[2])
local stored = tonumber(redis.call('GET', KEYS[2])) or 0
local fence = math.max(stored + 1, epochMicros)
local fenceText = string.format('%.0f', fence)
redis.call('SET', KEYS[2], fenceText)
return {1, fenceText}
`;

const ACQUIRE_IF_QUEUE_EMPTY_SCRIPT = `
if redis.call('LLEN', KEYS[3]) > 0 or redis.call('LLEN', KEYS[4]) > 0 then
  return {-1, ''}
end

local acquired = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
if not acquired then
  return {0, ''}
end

local now = redis.call('TIME')
local epochMicros = (tonumber(now[1]) * 1000000) + tonumber(now[2])
local stored = tonumber(redis.call('GET', KEYS[2])) or 0
local fence = math.max(stored + 1, epochMicros)
local fenceText = string.format('%.0f', fence)
redis.call('SET', KEYS[2], fenceText)
return {1, fenceText}
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type DmTurnLock = {
  readonly sessionId: string;
  readonly token: string;
  readonly fence: number;
};

type LeaseState = {
  lockKey: string;
  released: boolean;
  lost: boolean;
  timer: ReturnType<typeof setInterval>;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  confirmedUntil: number;
  renewal: Promise<boolean> | null;
};

const leaseStates = new WeakMap<DmTurnLock, LeaseState>();

/**
 * Claims the per-session DM lease and allocates its fencing token in one Redis
 * operation. Redis TIME makes the token survive a lost fence key under normal
 * monotonic server time; the stored counter still guarantees strict ordering
 * when multiple claims happen within the same microsecond.
 */
export async function acquireDmTurnLock(
  sessionId: string,
): Promise<DmTurnLock | null> {
  return acquireDmTurnLockWithPolicy(sessionId, false);
}

/**
 * Admits a new foreground turn only when no older pending/processing turn
 * exists. The queue check and lease acquisition happen in one Redis script,
 * preventing a fresh household action from overtaking an older one.
 */
export async function acquireDmTurnLockIfQueueEmpty(
  sessionId: string,
): Promise<DmTurnLock | null> {
  return acquireDmTurnLockWithPolicy(sessionId, true);
}

async function acquireDmTurnLockWithPolicy(
  sessionId: string,
  requireEmptyQueue: boolean,
): Promise<DmTurnLock | null> {
  const token = randomUUID();
  const lockKey = dmTurnLockKey(sessionId);
  const fenceKey = dmTurnFenceKey(sessionId);
  const keys = requireEmptyQueue
    ? [
        lockKey,
        fenceKey,
        `dm-turn:${sessionId}:pending`,
        `dm-turn:${sessionId}:processing`,
      ]
    : [lockKey, fenceKey];
  const acquisitionStartedAt = Date.now();
  let acquisition: Promise<unknown>;
  try {
    acquisition = Promise.resolve(
      redis.eval(
        requireEmptyQueue ? ACQUIRE_IF_QUEUE_EMPTY_SCRIPT : ACQUIRE_SCRIPT,
        keys.length,
        ...keys,
        token,
        String(DM_TURN_LOCK_TTL_MS),
      ),
    );
  } catch {
    // A synchronous client failure is fail-closed too. The token guard makes
    // this cleanup harmless if Redis never received the acquisition command.
    void deleteOwnedToken(lockKey, token);
    return null;
  }

  let result: unknown;
  try {
    result = await withTimeout(acquisition, DM_TURN_LOCK_ACQUIRE_TIMEOUT_MS);
  } catch {
    // A rejected/timed-out command may still have executed on Redis. Never run
    // the DM turn, and delete only our token once that command settles.
    cleanupAfterAmbiguousAcquisition(acquisition, lockKey, token);
    return null;
  }

  const parsed = parseAcquisition(result);
  if (parsed === null) {
    if (!isDefiniteMiss(result)) {
      cleanupAfterAmbiguousAcquisition(acquisition, lockKey, token);
    }
    return null;
  }

  const lock: DmTurnLock = { sessionId, token, fence: parsed };
  const timer = setInterval(() => {
    void maintainLease(lock);
  }, DM_TURN_LOCK_RENEW_INTERVAL_MS);
  timer.unref?.();
  const state: LeaseState = {
    lockKey,
    released: false,
    lost: false,
    timer,
    expiryTimer: null,
    confirmedUntil: acquisitionStartedAt + DM_TURN_LOCK_TTL_MS,
    renewal: null,
  };
  leaseStates.set(lock, state);
  scheduleExpiryWatchdog(lock, state);
  return lock;
}

/** Confirms ownership and extends the lease before a DM event is published. */
export async function confirmDmTurnLockOwned(lock: DmTurnLock): Promise<void> {
  const state = leaseStates.get(lock);
  if (!state || state.released || state.lost) throw leaseLostError();
  if (!(await renewLease(lock, state))) {
    markLeaseLost(state);
    throw leaseLostError();
  }
}

/** Stops renewal and releases only when Redis still contains this lock token. */
export async function releaseDmTurnLock(lock: DmTurnLock): Promise<void> {
  const state = leaseStates.get(lock);
  if (!state || state.released) return;
  state.released = true;
  clearInterval(state.timer);
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  state.expiryTimer = null;
  await deleteOwnedToken(state.lockKey, lock.token);
  leaseStates.delete(lock);
}

async function maintainLease(lock: DmTurnLock) {
  const state = leaseStates.get(lock);
  if (!state || state.released || state.lost) return;
  if (!(await renewLease(lock, state))) markLeaseLost(state);
}

async function renewLease(lock: DmTurnLock, state: LeaseState) {
  if (state.renewal) return state.renewal;
  const renewalStartedAt = Date.now();
  const renewal = (async () => {
    try {
      const result = await withTimeout(
        Promise.resolve(
          redis.eval(
            RENEW_SCRIPT,
            1,
            state.lockKey,
            lock.token,
            String(DM_TURN_LOCK_TTL_MS),
          ),
        ),
        DM_TURN_LOCK_REDIS_TIMEOUT_MS,
      );
      if (Number(result) !== 1 || state.released || state.lost) return false;
      // Redis starts the TTL before its reply reaches us, so measure from the
      // request start and never overestimate the server-side lease window.
      state.confirmedUntil = renewalStartedAt + DM_TURN_LOCK_TTL_MS;
      scheduleExpiryWatchdog(lock, state);
      return true;
    } catch {
      return false;
    }
  })();
  state.renewal = renewal;
  try {
    return await renewal;
  } finally {
    if (state.renewal === renewal) state.renewal = null;
  }
}

function markLeaseLost(state: LeaseState) {
  state.lost = true;
  clearInterval(state.timer);
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  state.expiryTimer = null;
}

function scheduleExpiryWatchdog(lock: DmTurnLock, state: LeaseState) {
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  const delay = Math.max(0, state.confirmedUntil - Date.now());
  state.expiryTimer = setTimeout(() => {
    if (state.released || state.lost || !leaseStates.has(lock)) return;
    if (Date.now() >= state.confirmedUntil) {
      markLeaseLost(state);
      return;
    }
    scheduleExpiryWatchdog(lock, state);
  }, delay);
  state.expiryTimer.unref?.();
}

function cleanupAfterAmbiguousAcquisition(
  acquisition: Promise<unknown>,
  lockKey: string,
  token: string,
) {
  void acquisition.then(
    () => deleteOwnedToken(lockKey, token),
    () => deleteOwnedToken(lockKey, token),
  );
}

async function deleteOwnedToken(lockKey: string, token: string) {
  try {
    await withTimeout(
      Promise.resolve(redis.eval(RELEASE_SCRIPT, 1, lockKey, token)),
      DM_TURN_LOCK_REDIS_TIMEOUT_MS,
    );
  } catch {
    // The finite lease is the last-resort cleanup when Redis is unavailable.
  }
}

function parseAcquisition(result: unknown): number | null {
  if (!Array.isArray(result) || Number(result[0]) !== 1) return null;
  const fence = Number(result[1]);
  if (!Number.isSafeInteger(fence) || fence < 0 || fence > MAX_SAFE_FENCE) {
    return null;
  }
  return fence;
}

function isDefiniteMiss(result: unknown) {
  return Array.isArray(result) && Number(result[0]) <= 0;
}

function dmTurnLockKey(sessionId: string) {
  return `dm-turn:${sessionId}:lock`;
}

function dmTurnFenceKey(sessionId: string) {
  return `dm-turn:${sessionId}:fence`;
}

function leaseLostError() {
  return new Error("DM turn lease lost");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("DM turn lock acquisition timed out"));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
