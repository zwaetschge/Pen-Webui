/**
 * Game event bus — Redis pub/sub.
 *
 * Producer side: tools/orchestrator emit ToolEvents.  We persist them on
 * EventLog (for replay) AND publish them on `session:<id>` so all live
 * SSE clients see them in real time.
 *
 * Consumer side: SSE handler subscribes to the same channel and forwards
 * each message to its connected client.
 */

import IORedis, { Redis } from "ioredis";
import { prisma } from "../db";
import { CLIENT_EVENT_TYPES } from "./events";

export type GameEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  /** scope: dm — only the DM client sees it; player — everyone */
  scope?: "all" | "dm";
};

let pub: Redis | null = null;
let pubConnection: Promise<void> | null = null;
const REDIS_PUBLISH_TIMEOUT_MS = 5_000;
export function pubClient(): Redis {
  if (!pub) {
    pub = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      commandTimeout: REDIS_PUBLISH_TIMEOUT_MS,
      connectTimeout: REDIS_PUBLISH_TIMEOUT_MS,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }
  return pub;
}

export function subClient(): Redis {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}

export function channel(sessionId: string): string {
  return `session:${sessionId}`;
}

export async function publishEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  opts: { scope?: "all" | "dm"; actorId?: string | null } = {},
) {
  const row = await prisma.eventLog.create({
    data: {
      sessionId,
      actorId: opts.actorId ?? undefined,
      type,
      payload: payload as never,
      scope: opts.scope ?? "all",
    },
    select: { id: true, ts: true },
  });
  const ev: GameEvent = {
    id: row.id,
    type,
    payload,
    ts: row.ts.getTime(),
    scope: opts.scope ?? "all",
  };
  await boundedPublish(pubClient(), channel(sessionId), JSON.stringify(ev));
  return ev;
}

async function boundedPublish(client: Redis, topic: string, message: string) {
  await ensurePublisherReady(client);
  await boundedRedisOperation(
    client.publish(topic, message),
    "Redis publish timed out",
  );
}

async function ensurePublisherReady(client: Redis) {
  if (isPublisherReady(client)) return;
  if (!pubConnection) {
    if (client.status !== "wait") {
      throw new Error(`Redis publisher is not ready (${client.status})`);
    }
    pubConnection = boundedRedisOperation(
      client.connect(),
      "Redis publisher connection timed out",
    );
  }
  const connection = pubConnection;
  try {
    await connection;
  } finally {
    if (pubConnection === connection) pubConnection = null;
  }
  if (!isPublisherReady(client)) {
    throw new Error(`Redis publisher is not ready (${client.status})`);
  }
}

function isPublisherReady(client: Redis) {
  return client.status === "ready";
}

async function boundedRedisOperation<T>(
  operation: Promise<T>,
  message: string,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message)),
          REDIS_PUBLISH_TIMEOUT_MS,
        );
        if (typeof timer === "object" && "unref" in timer) timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const DEFAULT_REPLAY_LIMIT = 200;
const MAX_REPLAY_LIMIT = 500;
const CLIENT_REPLAY_EVENT_TYPES = [...CLIENT_EVENT_TYPES];

export type RecentEventsOptions = {
  afterEventId?: string;
  sinceMs?: number;
  limit?: number;
};

/** Replay buffer — pull recent client-visible events for connected clients. */
export async function recentEvents(
  sessionId: string,
  opts: RecentEventsOptions = {},
): Promise<GameEvent[]> {
  const limit = clampReplayLimit(opts.limit);
  const cursor = opts.afterEventId
    ? await prisma.eventLog.findFirst({
        where: { id: opts.afterEventId, sessionId },
        select: { id: true, ts: true },
      })
    : null;

  const incrementalWhere = cursor
    ? { ts: { gte: cursor.ts } }
    : opts.sinceMs
      ? { ts: { gte: new Date(opts.sinceMs) } }
      : {};

  const incremental = Boolean(cursor || opts.sinceMs);
  const rows = await prisma.eventLog.findMany({
    where: {
      sessionId,
      type: { in: CLIENT_REPLAY_EVENT_TYPES },
      ...incrementalWhere,
    },
    orderBy: incremental
      ? [{ ts: "asc" }, { id: "asc" }]
      : [{ ts: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      payload: true,
      scope: true,
      ts: true,
    },
  });
  const replayRows = incremental ? rows : rows.reverse();
  return replayRows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload as Record<string, unknown>,
    ts: r.ts.getTime(),
    scope: r.scope === "dm" ? "dm" : "all",
  }));
}

function clampReplayLimit(value: number | undefined) {
  if (!value) return DEFAULT_REPLAY_LIMIT;
  return Math.max(1, Math.min(MAX_REPLAY_LIMIT, Math.floor(value)));
}
