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
import {
  BOOTSTRAP_EVENT_TYPES,
  CLIENT_EVENT_TYPES,
  isBootstrapEventType,
} from "./events";

export type GameEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  /** Delivery scope. Character-scoped events never reach the shared display. */
  scope?: GameEventScope;
};

export type GameEventScope =
  | "all"
  | "dm"
  | "display"
  | `character:${string}`;

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
  opts: {
    scope?: GameEventScope;
    actorId?: string | null;
    eventId?: string;
  } = {},
) {
  let row: { id: string; ts: Date };
  let eventType = type;
  let eventPayload = payload;
  let eventScope: GameEventScope = opts.scope ?? "all";
  try {
    row = await prisma.eventLog.create({
      data: {
        id: opts.eventId ?? undefined,
        sessionId,
        actorId: opts.actorId ?? undefined,
        type,
        payload: payload as never,
        scope: eventScope,
      },
      select: { id: true, ts: true },
    });
  } catch (error) {
    if (!opts.eventId || !isUniqueConstraintError(error)) throw error;
    const existing = await prisma.eventLog.findFirst({
      where: { id: opts.eventId, sessionId, type },
      select: { id: true, type: true, payload: true, scope: true, ts: true },
    });
    if (!existing) throw error;
    row = { id: existing.id, ts: existing.ts };
    eventType = existing.type;
    eventPayload = existing.payload as Record<string, unknown>;
    eventScope = gameEventScope(existing.scope);
  }
  const ev: GameEvent = {
    id: row.id,
    type: eventType,
    payload: eventPayload,
    ts: row.ts.getTime(),
    scope: eventScope,
  };
  try {
    await boundedPublish(pubClient(), channel(sessionId), JSON.stringify(ev));
  } catch (error) {
    // EventLog is the canonical stream. Once the row is durable, a transient
    // Pub/Sub outage must not abort or duplicate the DM turn; reconnect replay
    // repairs the client. Never log the payload (it may contain private text).
    console.error("Game event persisted but live broadcast failed", {
      sessionId,
      eventId: ev.id,
      type,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  return ev;
}

function gameEventScope(value: unknown): GameEventScope {
  if (value === "dm" || value === "display") return value;
  if (
    typeof value === "string" &&
    value.startsWith("character:") &&
    value.length > "character:".length
  ) {
    return value as `character:${string}`;
  }
  return "all";
}

function isUniqueConstraintError(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
    ? {
        OR: [
          { ts: { gt: cursor.ts } },
          { ts: cursor.ts, id: { gt: cursor.id } },
        ],
      }
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
  if (!incremental) {
    const select = {
      id: true,
      type: true,
      payload: true,
      scope: true,
      ts: true,
    } as const;
    const [latestBootstrap, latestScene, latestCombatLifecycle] =
      await Promise.all([
        replayRows.some((row) => isBootstrapEventType(row.type))
          ? null
          : prisma.eventLog.findFirst({
              where: {
                sessionId,
                type: { in: [...BOOTSTRAP_EVENT_TYPES] },
              },
              orderBy: [{ ts: "desc" }, { id: "desc" }],
              select,
            }),
        replayRows.some((row) => row.type === "scene_set")
          ? null
          : prisma.eventLog.findFirst({
              where: { sessionId, type: "scene_set" },
              orderBy: [{ ts: "desc" }, { id: "desc" }],
              select,
            }),
        replayRows.some((row) => row.type === "combat_started")
          ? null
          : prisma.eventLog.findFirst({
              where: {
                sessionId,
                type: {
                  in: [
                    "combat_started",
                    "combat_ended",
                    "game_over",
                    "session_ended",
                    "scene_ended",
                  ],
                },
              },
              orderBy: [{ ts: "desc" }, { id: "desc" }],
              select,
            }),
      ]);
    const anchors = [
      latestBootstrap && isBootstrapEventType(latestBootstrap.type)
        ? latestBootstrap
        : null,
      latestScene?.type === "scene_set" ? latestScene : null,
      latestCombatLifecycle?.type === "combat_started"
        ? latestCombatLifecycle
        : null,
    ].filter((row): row is NonNullable<typeof row> => row !== null);
    const replayIds = new Set(replayRows.map((row) => row.id));
    replayRows.unshift(...anchors.filter((row) => !replayIds.has(row.id)));
  }
  return replayRows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload as Record<string, unknown>,
    ts: r.ts.getTime(),
    scope: gameEventScope(r.scope),
  }));
}

function clampReplayLimit(value: number | undefined) {
  if (!value) return DEFAULT_REPLAY_LIMIT;
  return Math.max(1, Math.min(MAX_REPLAY_LIMIT, Math.floor(value)));
}
