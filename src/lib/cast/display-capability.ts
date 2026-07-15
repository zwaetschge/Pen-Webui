import { timingSafeEqual } from "node:crypto";
import { redis } from "@/lib/redis";
import { parseDisplayToken, type DisplayTokenClaims } from "./display-token";

const DISPLAY_CAPABILITY_REDIS_TIMEOUT_MS = 2_500;
const DISPLAY_TTS_WINDOW_MS = 5 * 60 * 1000;
const DISPLAY_TTS_CACHE_MISS_LIMIT = 30;

const DELETE_IF_CURRENT_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const CONSUME_TTS_BUDGET_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
if count > tonumber(ARGV[1]) then
  return 0
end
return 1
`;

export class DisplayCapabilityStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DisplayCapabilityStoreError";
  }
}

export async function activateDisplayCapability(
  claims: DisplayTokenClaims,
  opts?: { nowUnix?: number },
) {
  const nowUnix = opts?.nowUnix ?? Math.floor(Date.now() / 1000);
  const ttlMs = (claims.expiryUnix - nowUnix) * 1000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new DisplayCapabilityStoreError("display_capability_expired");
  }

  try {
    const result = await withTimeout(
      Promise.resolve(
        redis.set(
          capabilityKey(claims.sessionId),
          claims.capabilityId,
          "PX",
          ttlMs,
        ),
      ),
    );
    if (result !== "OK") {
      throw new DisplayCapabilityStoreError(
        "display_capability_activation_failed",
      );
    }
  } catch (error) {
    if (error instanceof DisplayCapabilityStoreError) throw error;
    throw new DisplayCapabilityStoreError("display_capability_unavailable", {
      cause: error,
    });
  }
}

export async function resolveActiveDisplayCapability(
  token: string,
  sessionId: string,
  secret: string,
  opts?: { nowUnix?: number },
): Promise<DisplayTokenClaims | null> {
  const claims = parseDisplayToken(token, secret, opts);
  if (!claims || claims.sessionId !== sessionId) return null;
  return (await isDisplayCapabilityActive(claims, opts)) ? claims : null;
}

export async function isDisplayCapabilityActive(
  claims: DisplayTokenClaims,
  opts?: { nowUnix?: number },
): Promise<boolean> {
  const nowUnix = opts?.nowUnix ?? Math.floor(Date.now() / 1000);
  if (claims.expiryUnix <= nowUnix) return false;
  try {
    const active = await withTimeout(
      Promise.resolve(redis.get(capabilityKey(claims.sessionId))),
    );
    return typeof active === "string" && safeEqual(active, claims.capabilityId);
  } catch {
    return false;
  }
}

export async function revokeDisplayCapability(
  sessionId: string,
  expectedCapabilityId?: string,
): Promise<boolean> {
  try {
    const result = expectedCapabilityId
      ? await withTimeout(
          Promise.resolve(
            redis.eval(
              DELETE_IF_CURRENT_SCRIPT,
              1,
              capabilityKey(sessionId),
              expectedCapabilityId,
            ),
          ),
        )
      : await withTimeout(Promise.resolve(redis.del(capabilityKey(sessionId))));
    return Number(result) === 1;
  } catch (error) {
    throw new DisplayCapabilityStoreError("display_capability_unavailable", {
      cause: error,
    });
  }
}

export async function consumeDisplayTtsBudget(
  claims: DisplayTokenClaims,
): Promise<boolean> {
  try {
    const result = await withTimeout(
      Promise.resolve(
        redis.eval(
          CONSUME_TTS_BUDGET_SCRIPT,
          1,
          ttsBudgetKey(claims),
          String(DISPLAY_TTS_CACHE_MISS_LIMIT),
          String(DISPLAY_TTS_WINDOW_MS),
        ),
      ),
    );
    return Number(result) === 1;
  } catch (error) {
    throw new DisplayCapabilityStoreError("display_tts_budget_unavailable", {
      cause: error,
    });
  }
}

function capabilityKey(sessionId: string) {
  return `display-capability:${sessionId}`;
}

function ttsBudgetKey(claims: DisplayTokenClaims) {
  return `display-tts:${claims.sessionId}:${claims.capabilityId}`;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function withTimeout<T>(promise: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Display capability Redis operation timed out"));
    }, DISPLAY_CAPABILITY_REDIS_TIMEOUT_MS);
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
