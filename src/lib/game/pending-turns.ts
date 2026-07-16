import { randomUUID } from "node:crypto";
import { z } from "zod";
import { redis } from "@/lib/redis";
import type { ActingIdentity } from "./acting";

export const PENDING_TURN_QUEUE_LIMIT = 16;
export const PENDING_TURN_PER_ACTOR_LIMIT = 3;
export const PENDING_TURN_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_TURN_REDIS_TIMEOUT_MS = 2_500;

const ENQUEUE_SCRIPT = `
local size = redis.call('LLEN', KEYS[1]) + redis.call('LLEN', KEYS[2])
local limit = tonumber(ARGV[2])
if size >= limit then
  return {-1, size}
end

local actorLimit = tonumber(ARGV[4])
local actorKey = ARGV[5]
local actorSize = 0
for _, queueKey in ipairs(KEYS) do
  local items = redis.call('LRANGE', queueKey, 0, -1)
  for _, item in ipairs(items) do
    local decodedOk, decoded = pcall(cjson.decode, item)
    if decodedOk and type(decoded) == 'table' and decoded.queueActorKey == actorKey then
      actorSize = actorSize + 1
    end
  end
end
if actorSize >= actorLimit then
  return {-2, size, actorSize}
end

redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return {1, size + 1, actorSize + 1}
`;

const CLAIM_SCRIPT = `
local stranded = redis.call('LLEN', KEYS[2])
for _ = 1, stranded do
  local item = redis.call('RPOP', KEYS[2])
  if item then
    redis.call('RPUSH', KEYS[1], item)
  end
end

local item = redis.call('RPOP', KEYS[1])
if not item then
  redis.call('DEL', KEYS[1], KEYS[2])
  return false
end

redis.call('LPUSH', KEYS[2], item)
redis.call('PEXPIRE', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[2], ARGV[1])
return item
`;

const ACKNOWLEDGE_SCRIPT = `
local removed = redis.call('LREM', KEYS[2], 1, ARGV[1])
if redis.call('LLEN', KEYS[1]) == 0 and redis.call('LLEN', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
else
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  redis.call('PEXPIRE', KEYS[2], ARGV[2])
end
return removed
`;

const actingIdentitySchema = z
  .object({
    displayName: z.string().min(1).max(200),
    dbActorId: z.string().max(200).nullable(),
    eventActorId: z.string().max(200).nullable(),
    characterId: z.string().max(200).nullable(),
    actorKind: z.enum(["dm", "player"]),
  })
  .strict();

const pendingTurnSchema = z
  .object({
    version: z.literal(1),
    queueActorKey: z.string().min(1).max(420),
    id: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/),
    enqueuedAt: z.number().int().nonnegative(),
    campaignId: z.string().min(1).max(200),
    runnerId: z.string().min(1).max(200),
    text: z.string().min(1).max(2000),
    actor: actingIdentitySchema,
  })
  .strict();

export type PendingTurn = z.infer<typeof pendingTurnSchema>;
export type PendingTurnInput = {
  campaignId: string;
  runnerId: string;
  text: string;
  actor: ActingIdentity;
};

export type PendingTurnEnqueueResult =
  | { accepted: true; position: number }
  | {
      accepted: false;
      reason: "queue_full";
      size: number;
      limit: number;
    }
  | {
      accepted: false;
      reason: "actor_limit";
      size: number;
      actorSize: number;
      limit: number;
    };

export type ClaimedPendingTurn = {
  receipt: string;
  turn: PendingTurn;
};

export class PendingTurnQueueError extends Error {
  constructor(
    public readonly code: "invalid_payload" | "protocol" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PendingTurnQueueError";
  }
}

export async function enqueuePendingTurn(
  sessionId: string,
  input: PendingTurnInput,
): Promise<PendingTurnEnqueueResult> {
  const parsed = pendingTurnSchema.safeParse({
    version: 1,
    queueActorKey: pendingTurnActorKey(input.actor),
    id: randomUUID(),
    enqueuedAt: Date.now(),
    ...input,
  });
  if (!parsed.success) {
    throw new PendingTurnQueueError(
      "invalid_payload",
      "Pending turn payload is invalid",
    );
  }

  const [pendingKey, processingKey] = pendingTurnKeys(sessionId);
  const result = await evalQueueScript(
    ENQUEUE_SCRIPT,
    pendingKey,
    processingKey,
    JSON.stringify(parsed.data),
    String(PENDING_TURN_QUEUE_LIMIT),
    String(PENDING_TURN_QUEUE_TTL_MS),
    String(PENDING_TURN_PER_ACTOR_LIMIT),
    parsed.data.queueActorKey,
  );
  if (!Array.isArray(result) || result.length < 2) {
    throw new PendingTurnQueueError(
      "protocol",
      "Redis returned an invalid pending-turn enqueue result",
    );
  }

  const accepted = Number(result[0]);
  const size = Number(result[1]);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new PendingTurnQueueError(
      "protocol",
      "Redis returned an invalid pending-turn queue size",
    );
  }
  if (accepted === 1) return { accepted: true, position: size };
  if (accepted === -1) {
    return {
      accepted: false,
      reason: "queue_full",
      size,
      limit: PENDING_TURN_QUEUE_LIMIT,
    };
  }
  if (accepted === -2) {
    const actorSize = Number(result[2]);
    if (!Number.isSafeInteger(actorSize) || actorSize < 0) {
      throw new PendingTurnQueueError(
        "protocol",
        "Redis returned an invalid per-actor pending-turn queue size",
      );
    }
    return {
      accepted: false,
      reason: "actor_limit",
      size,
      actorSize,
      limit: PENDING_TURN_PER_ACTOR_LIMIT,
    };
  }
  throw new PendingTurnQueueError(
    "protocol",
    "Redis returned an unknown pending-turn enqueue status",
  );
}

export async function claimPendingTurn(
  sessionId: string,
): Promise<ClaimedPendingTurn | null> {
  const [pendingKey, processingKey] = pendingTurnKeys(sessionId);

  // A corrupt entry must not permanently block all later household actions.
  for (let attempt = 0; attempt < PENDING_TURN_QUEUE_LIMIT; attempt += 1) {
    const raw = await evalQueueScript(
      CLAIM_SCRIPT,
      pendingKey,
      processingKey,
      String(PENDING_TURN_QUEUE_TTL_MS),
    );
    if (raw === null || raw === undefined || raw === false) return null;
    const receipt = redisString(raw);
    if (receipt === null) {
      throw new PendingTurnQueueError(
        "protocol",
        "Redis returned an invalid pending-turn claim",
      );
    }

    const turn = parsePendingTurn(receipt);
    if (turn) return { receipt, turn };
    await acknowledgePendingTurn(sessionId, receipt);
  }

  return null;
}

export async function acknowledgePendingTurn(
  sessionId: string,
  receipt: string,
): Promise<void> {
  const [pendingKey, processingKey] = pendingTurnKeys(sessionId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await evalQueueScript(
        ACKNOWLEDGE_SCRIPT,
        pendingKey,
        processingKey,
        receipt,
        String(PENDING_TURN_QUEUE_TTL_MS),
      );
      // LREM=0 is a successful idempotent retry: the first Redis EVAL may have
      // completed after the client-side timeout and already removed the exact
      // receipt. The queue owns opaque receipts, so callers cannot acknowledge
      // an arbitrary user-provided value.
      if (Number(result) === 0 || Number(result) === 1) return;
      throw new PendingTurnQueueError(
        "protocol",
        "Pending turn receipt returned an invalid acknowledgement",
      );
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof PendingTurnQueueError &&
        error.code === "unavailable"
      ) {
        continue;
      }
      throw error;
    }
  }
}

function pendingTurnKeys(sessionId: string): [string, string] {
  return [`dm-turn:${sessionId}:pending`, `dm-turn:${sessionId}:processing`];
}

function pendingTurnActorKey(actor: ActingIdentity) {
  if (actor.characterId) return `character:${actor.characterId}`;
  if (actor.eventActorId) return `member:${actor.eventActorId}`;
  if (actor.dbActorId) return `user:${actor.dbActorId}`;
  return `name:${actor.actorKind}:${actor.displayName
    .trim()
    .toLocaleLowerCase("de-DE")}`;
}

function parsePendingTurn(raw: string): PendingTurn | null {
  try {
    const parsed = pendingTurnSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function redisString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return null;
}

async function evalQueueScript(
  script: string,
  pendingKey: string,
  processingKey: string,
  ...args: string[]
): Promise<unknown> {
  try {
    return await withTimeout(
      Promise.resolve(
        redis.eval(script, 2, pendingKey, processingKey, ...args),
      ),
      PENDING_TURN_REDIS_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof PendingTurnQueueError) throw error;
    throw new PendingTurnQueueError(
      "unavailable",
      error instanceof Error ? error.message : "Pending turn queue unavailable",
    );
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Pending turn queue timed out"));
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
