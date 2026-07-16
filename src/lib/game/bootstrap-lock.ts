import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";

export const BOOTSTRAP_LOCK_TTL_MS = 30_000;
const BOOTSTRAP_LOCK_TIMEOUT_MS = 2_500;

const ACQUIRE_SCRIPT = `
local acquired = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
if acquired then return 1 end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type BootstrapLock = {
  readonly key: string;
  readonly token: string;
};

export async function acquireBootstrapLock(
  sessionId: string,
): Promise<BootstrapLock | null> {
  const key = `session:${sessionId}:bootstrap-lock`;
  const token = randomUUID();
  let acquisition: Promise<unknown>;
  try {
    acquisition = Promise.resolve(
      redis.eval(ACQUIRE_SCRIPT, 1, key, token, String(BOOTSTRAP_LOCK_TTL_MS)),
    );
  } catch {
    return null;
  }

  try {
    const result = await withTimeout(acquisition, BOOTSTRAP_LOCK_TIMEOUT_MS);
    return Number(result) === 1 ? { key, token } : null;
  } catch {
    // The command may have reached Redis before the connection failed. A
    // token-guarded cleanup cannot delete another worker's lock.
    void acquisition.then(
      () => releaseByToken(key, token),
      () => releaseByToken(key, token),
    );
    return null;
  }
}

export async function releaseBootstrapLock(lock: BootstrapLock) {
  await releaseByToken(lock.key, lock.token);
}

async function releaseByToken(key: string, token: string) {
  try {
    await withTimeout(
      Promise.resolve(redis.eval(RELEASE_SCRIPT, 1, key, token)),
      BOOTSTRAP_LOCK_TIMEOUT_MS,
    );
  } catch {
    // The finite lease is the last-resort cleanup if Redis is unavailable.
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("redis_timeout")),
      timeoutMs,
    );
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
