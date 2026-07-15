import { NextResponse } from "next/server";
import { z } from "zod";
import { rollDice } from "@/lib/dice";
import { runDmTurn } from "@/lib/dm/orchestrator";
import { prisma } from "@/lib/db";
import { resolveAccess } from "./access";
import { resolveActingIdentity, type ActingIdentity } from "./acting";
import { ensureSessionBootstrap } from "./bootstrap";
import { activeInitiativeName, isActiveTurnForCharacter } from "./combat-turn";
import {
  channel,
  publishEvent,
  recentEvents,
  subClient,
  type GameEvent,
} from "./bus";
import { eventForClient } from "./events";
import {
  acknowledgePendingTurn,
  claimPendingTurn,
  enqueuePendingTurn,
  type PendingTurn,
} from "./pending-turns";
import {
  registerPendingTurnDrainer,
  schedulePendingTurnDrain,
} from "./pending-turn-waker";
import {
  acquireDmTurnLock,
  acquireDmTurnLockIfQueueEmpty,
  confirmDmTurnLockOwned,
  releaseDmTurnLock,
  type DmTurnLock,
} from "./turn-lock";

const turnBodySchema = z.object({
  text: z.string().min(1).max(2000),
  characterId: z.string().optional(),
});

const rollBodySchema = z.object({
  notation: z.string().min(1).max(40),
  reason: z.string().max(120).optional(),
  characterId: z.string().optional(),
});

const LIVE_REPLAY_BUFFER_LIMIT = 1000;
const REPLAY_PAGE_LIMIT = 200;
const MAX_INCREMENTAL_REPLAY_PAGES = 50;
const EVENTLOG_CATCHUP_INTERVAL_MS = 5_000;
const RECENT_EVENT_ID_LIMIT = 4_096;
const DM_FINALIZATION_TIMEOUT_MS = 5_000;

export type SessionReplayCursor = {
  afterEventId?: string;
  sinceMs?: number;
};

export async function replaySessionEventPages(
  sessionId: string,
  cursor: SessionReplayCursor,
  forward: (event: GameEvent) => void,
): Promise<{ cursor: SessionReplayCursor; complete: boolean }> {
  let replayAfter = cursor.afterEventId;
  let replaySince = cursor.sinceMs;
  const incremental = Boolean(replayAfter || replaySince);

  for (let page = 0; page < MAX_INCREMENTAL_REPLAY_PAGES; page += 1) {
    const replay = await recentEvents(sessionId, {
      afterEventId: replayAfter,
      sinceMs: replaySince,
      limit: REPLAY_PAGE_LIMIT,
    });
    for (const event of replay) forward(event);

    const last = replay.at(-1);
    if (last) {
      replayAfter = last.id;
      replaySince = undefined;
    }
    if (!incremental || replay.length < REPLAY_PAGE_LIMIT) {
      return {
        cursor: { afterEventId: replayAfter, sinceMs: replaySince },
        complete: true,
      };
    }
    if (!last || last.id === cursor.afterEventId) {
      return {
        cursor: { afterEventId: replayAfter, sinceMs: replaySince },
        complete: false,
      };
    }
  }

  return {
    cursor: { afterEventId: replayAfter, sinceMs: replaySince },
    complete: false,
  };
}

function inviteTokenFrom(req: Request, override?: string | null) {
  if (override !== undefined) return override;
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

export async function handleSessionStream(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const inviteToken = inviteTokenFrom(req, inviteTokenOverride);
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access) {
    return new Response("forbidden", { status: 403 });
  }

  return streamSessionEvents(req, sessionId, {
    role: access.role,
    displayName: access.displayName,
    memberId: access.memberId,
  });
}

export async function handleReadonlySessionStream(
  req: Request,
  sessionId: string,
) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });
  if (!session) return new Response("not found", { status: 404 });
  return streamSessionEvents(req, sessionId, {
    role: "player",
    displayName: "TV-Ausgabe",
    memberId: "display",
  });
}

async function streamSessionEvents(
  req: Request,
  sessionId: string,
  viewer: {
    role: "host" | "player";
    displayName: string;
    memberId: string;
  },
) {
  const url = new URL(req.url);
  const sinceMs = Number(url.searchParams.get("since") ?? 0) || undefined;
  const afterEventId =
    normalizedCursor(url.searchParams.get("after")) ??
    normalizedCursor(req.headers.get("last-event-id"));

  await ensureSessionBootstrap(sessionId);
  // A reconnect also wakes work stranded by a process restart. The DM lease
  // keeps this harmless when another request is already draining the queue.
  schedulePendingTurnDrain(sessionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let sub: ReturnType<typeof subClient> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let catchupTimer: ReturnType<typeof setInterval> | null = null;
      let catchupInFlight = false;
      let catchupRequested = false;
      let replayCursor: SessionReplayCursor = { afterEventId, sinceMs };
      const replayStartedAt = Date.now();
      const topic = channel(sessionId);

      const send = (ev: { id?: string; event?: string; data: unknown }) => {
        if (closed) return;
        const lines: string[] = [];
        if (ev.id) lines.push(`id: ${ev.id}`);
        if (ev.event) lines.push(`event: ${ev.event}`);
        lines.push(`data: ${JSON.stringify(ev.data)}`);
        try {
          controller.enqueue(enc.encode(lines.join("\n") + "\n\n"));
        } catch {
          void close();
        }
      };

      const close = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (catchupTimer) clearInterval(catchupTimer);
        if (sub) {
          try {
            await sub.unsubscribe(topic);
            await sub.quit();
          } catch {
            /* */
          }
        }
        try {
          controller.close();
        } catch {
          /* */
        }
      };
      req.signal.addEventListener("abort", () => void close());

      const forwardedIds = new Set<string>();
      const forwardedIdOrder: string[] = [];
      const forward = (ev: GameEvent) => {
        if (forwardedIds.has(ev.id)) return;
        forwardedIds.add(ev.id);
        forwardedIdOrder.push(ev.id);
        if (forwardedIdOrder.length > RECENT_EVENT_ID_LIMIT) {
          const oldest = forwardedIdOrder.shift();
          if (oldest) forwardedIds.delete(oldest);
        }
        const visible = eventForClient(ev, viewer.role);
        if (visible)
          send({ id: visible.id, event: visible.type, data: visible });
      };

      const catchUpFromEventLog = async () => {
        if (closed) return;
        catchupRequested = true;
        if (catchupInFlight) return;
        catchupInFlight = true;
        try {
          do {
            catchupRequested = false;
            try {
              const result = await replaySessionEventPages(
                sessionId,
                replayCursor,
                forward,
              );
              replayCursor = result.cursor;
              if (!result.complete) {
                await close();
                return;
              }
            } catch {
              // A transient DB error is retried by the next interval. Redis
              // notifications remain coalesced while this attempt unwinds.
              return;
            }
          } while (catchupRequested && !closed);
        } finally {
          catchupInFlight = false;
        }
      };

      send({
        event: "hello",
        data: {
          role: viewer.role,
          displayName: viewer.displayName,
          memberId: viewer.memberId,
          sessionId,
        },
      });

      let bufferedLiveNotifications = 0;
      let replaying = true;
      sub = subClient();
      sub.on("message", (_ch, raw) => {
        const ev = parsePublishedEvent(raw);
        if (!ev) return;
        if (replaying) {
          if (bufferedLiveNotifications >= LIVE_REPLAY_BUFFER_LIMIT) {
            void close();
            return;
          }
          bufferedLiveNotifications += 1;
        } else {
          // Pub/Sub is only the low-latency wake signal. Reading the canonical
          // EventLog cursor preserves order when an older publish was lost.
          void catchUpFromEventLog();
        }
      });
      try {
        await sub.subscribe(topic);
        if (closed) return;

        const initialReplay = await replaySessionEventPages(
          sessionId,
          replayCursor,
          forward,
        );
        if (closed) return;
        replayCursor = initialReplay.cursor;
        if (!initialReplay.complete) {
          // EventSource reconnects with the last delivered id and continues
          // catch-up without keeping an unbounded replay in memory.
          await close();
          return;
        }
        if (!replayCursor.afterEventId && !replayCursor.sinceMs) {
          replayCursor = { sinceMs: replayStartedAt };
        }
        replaying = false;
        if (bufferedLiveNotifications > 0) {
          await catchUpFromEventLog();
        }
        if (closed) return;

        catchupTimer = setInterval(() => {
          void catchUpFromEventLog();
        }, EVENTLOG_CATCHUP_INTERVAL_MS);
        catchupTimer.unref?.();

        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(`: hb ${Date.now()}\n\n`));
          } catch {
            void close();
          }
        }, 15_000);
      } catch {
        await close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function normalizedCursor(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parsePublishedEvent(raw: string): GameEvent | null {
  try {
    const ev = JSON.parse(raw) as {
      id: string;
      type: string;
      payload: unknown;
      ts: number;
      scope?: "all" | "dm";
    };
    if (!ev.id || !ev.type || typeof ev.ts !== "number") return null;
    return {
      id: ev.id,
      type: ev.type,
      payload:
        ev.payload &&
        typeof ev.payload === "object" &&
        !Array.isArray(ev.payload)
          ? (ev.payload as Record<string, unknown>)
          : {},
      ts: ev.ts,
      scope: ev.scope,
    };
  } catch {
    return null;
  }
}

export async function handleSessionTurn(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const inviteToken = inviteTokenFrom(req, inviteTokenOverride);
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const raw = await req.json().catch(() => ({}));
  const body = turnBodySchema.safeParse(raw);
  if (!body.success)
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      campaignId: true,
      endedAt: true,
      campaign: { select: { hostId: true } },
    },
  });
  if (!session || session.endedAt) {
    return NextResponse.json({ error: "session_closed" }, { status: 410 });
  }

  const actor = await resolveActingIdentity({
    access,
    campaignId: session.campaignId,
    requestedCharacterId: body.data.characterId,
  });
  if (!actor) {
    return NextResponse.json({ error: "invalid_character" }, { status: 403 });
  }

  const combatAdmission = await combatTurnAdmission(session.campaignId, actor);
  if (combatAdmission.block) {
    return NextResponse.json(combatAdmission.block, { status: 409 });
  }

  const dmTurnLock = combatAdmission.active
    ? await acquireDmTurnLock(sessionId)
    : await acquireDmTurnLockIfQueueEmpty(sessionId);
  if (!dmTurnLock) {
    if (combatAdmission.active) {
      return NextResponse.json({ error: "dm_busy" }, { status: 409 });
    }

    let queued;
    try {
      queued = await enqueuePendingTurn(sessionId, {
        campaignId: session.campaignId,
        runnerId: session.campaign.hostId,
        text: body.data.text,
        actor,
      });
    } catch {
      return NextResponse.json(
        { error: "turn_queue_unavailable" },
        { status: 503, headers: { "retry-after": "2" } },
      );
    }
    if (!queued.accepted) {
      const error =
        queued.reason === "actor_limit"
          ? "turn_queue_actor_limit"
          : "turn_queue_full";
      return NextResponse.json(
        { error, limit: queued.limit },
        { status: 429, headers: { "retry-after": "5" } },
      );
    }

    // Covers the race where the previous DM turn released its lease between
    // our failed admission attempt and the atomic queue write. In the common
    // case the active runner's finalizer performs the successful drain.
    schedulePendingTurnDrain(sessionId);
    return NextResponse.json(
      { ok: true, queued: true, position: queued.position },
      { status: 202 },
    );
  }

  const work: DmTurnWork = {
    sessionId,
    campaignId: session.campaignId,
    runnerId: session.campaign.hostId,
    text: body.data.text,
    actor,
  };

  try {
    await prepareDmTurn(work, dmTurnLock);
  } catch (error) {
    await releaseDmTurnLock(dmTurnLock);
    throw error;
  }

  void executeDmTurn(work, dmTurnLock);

  return NextResponse.json({ ok: true });
}

type DmTurnWork = {
  sessionId: string;
  campaignId: string;
  runnerId: string;
  text: string;
  actor: ActingIdentity;
};

/**
 * Claims and executes one queued exploration action. Every completion releases
 * the lease and schedules the next FIFO claim, so no request has to remain
 * open while another household player is acting.
 */
export async function drainPendingTurns(sessionId: string): Promise<boolean> {
  const lock = await acquireDmTurnLock(sessionId);
  if (!lock) return false;

  let claimed;
  try {
    claimed = await claimPendingTurn(sessionId);
  } catch {
    await releaseDmTurnLock(lock);
    return false;
  }
  if (!claimed) {
    await releaseDmTurnLock(lock);
    return false;
  }

  let currentSession: {
    campaignId: string;
    endedAt: Date | null;
    campaign: { hostId: string };
  } | null;
  try {
    currentSession = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        campaignId: true,
        endedAt: true,
        campaign: { select: { hostId: true } },
      },
    });
  } catch {
    await releaseDmTurnLock(lock);
    return false;
  }
  if (
    !currentSession ||
    currentSession.endedAt ||
    currentSession.campaignId !== claimed.turn.campaignId ||
    currentSession.campaign.hostId !== claimed.turn.runnerId
  ) {
    return discardPendingTurn(sessionId, claimed.receipt, lock);
  }

  let actor: ActingIdentity | null;
  try {
    actor = await revalidatePendingTurnActor({
      sessionId,
      campaignId: currentSession.campaignId,
      hostId: currentSession.campaign.hostId,
      actor: claimed.turn.actor,
    });
  } catch {
    await releaseDmTurnLock(lock);
    return false;
  }
  if (!actor) {
    return discardPendingTurn(sessionId, claimed.receipt, lock);
  }

  let combatAdmission;
  try {
    combatAdmission = await combatTurnAdmission(
      currentSession.campaignId,
      actor,
    );
  } catch {
    await releaseDmTurnLock(lock);
    return false;
  }
  if (combatAdmission.active) {
    // Keep the item in the processing list. The next drain requeues it at the
    // front, so pre-combat exploration never fires in the middle of combat.
    await releaseDmTurnLock(lock);
    return false;
  }

  const work = workFromPendingTurn(sessionId, claimed.turn, actor);
  try {
    // The player input is written under a deterministic EventLog id before the
    // Redis receipt is removed. A DB/lease failure therefore leaves the action
    // recoverable in the processing list, while a retry cannot duplicate the
    // visible input after an ambiguous response.
    await prepareDmTurn(work, lock, pendingTurnEventId(claimed.turn.id));
    await acknowledgePendingTurn(sessionId, claimed.receipt);
  } catch {
    await releaseDmTurnLock(lock);
    return false;
  }

  await executeDmTurn(work, lock);
  return true;
}

async function discardPendingTurn(
  sessionId: string,
  receipt: string,
  lock: DmTurnLock,
) {
  try {
    await acknowledgePendingTurn(sessionId, receipt);
  } catch {
    await releaseDmTurnLock(lock);
    return false;
  }
  await releaseDmTurnLock(lock);
  schedulePendingTurnDrain(sessionId);
  return true;
}

async function revalidatePendingTurnActor(input: {
  sessionId: string;
  campaignId: string;
  hostId: string;
  actor: ActingIdentity;
}): Promise<ActingIdentity | null> {
  const { actor } = input;
  if (actor.actorKind === "dm") {
    return actor.dbActorId === input.hostId && !actor.characterId
      ? actor
      : null;
  }
  if (!actor.eventActorId) return null;

  const member = await prisma.sessionMember.findFirst({
    where: {
      id: actor.eventActorId,
      sessionId: input.sessionId,
      leftAt: null,
    },
    select: {
      id: true,
      userId: true,
      inviteId: true,
      displayName: true,
      characterId: true,
    },
  });
  if (!member) return null;

  const isHost = actor.dbActorId === input.hostId;
  if (actor.dbActorId) {
    if (member.userId !== actor.dbActorId || member.inviteId) return null;
  } else if (member.userId || !member.inviteId) {
    return null;
  }

  const character = actor.characterId
    ? await prisma.character.findFirst({
        where: { id: actor.characterId, campaignId: input.campaignId },
        select: { id: true, name: true, ownerId: true },
      })
    : null;
  if (actor.characterId && !character) return null;

  const ownsCharacter = Boolean(
    character &&
    actor.dbActorId !== null &&
    character.ownerId === actor.dbActorId,
  );

  if (
    character &&
    !isHost &&
    member.characterId !== character.id &&
    !ownsCharacter
  ) {
    return null;
  }
  if (!character && member.characterId) return null;

  if (member.inviteId) {
    const invite = await prisma.invite.findUnique({
      where: { id: member.inviteId },
      select: {
        id: true,
        campaignId: true,
        sessionId: true,
        characterId: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (
      !invite ||
      invite.campaignId !== input.campaignId ||
      (invite.sessionId !== null && invite.sessionId !== input.sessionId) ||
      (invite.characterId !== null &&
        invite.characterId !== member.characterId) ||
      invite.revokedAt ||
      invite.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
  }

  return {
    displayName: character?.name ?? member.displayName,
    dbActorId: actor.dbActorId,
    eventActorId: member.id,
    characterId: character?.id ?? null,
    actorKind: "player",
  };
}

function workFromPendingTurn(
  sessionId: string,
  turn: PendingTurn,
  actor: ActingIdentity,
): DmTurnWork {
  return {
    sessionId,
    campaignId: turn.campaignId,
    runnerId: turn.runnerId,
    text: turn.text,
    actor,
  };
}

async function prepareDmTurn(
  work: DmTurnWork,
  lock: DmTurnLock,
  eventId?: string,
) {
  await publishEvent(
    work.sessionId,
    "player_input",
    {
      kind: "player_input",
      text: work.text,
      actorId: work.actor.eventActorId,
      displayName: work.actor.displayName,
      characterId: work.actor.characterId,
      actorKind: work.actor.actorKind,
    },
    {
      actorId: work.actor.dbActorId,
      ...(eventId ? { eventId } : {}),
    },
  );
  await publishDmEvent(work.sessionId, lock, "dm_thinking", {
    active: true,
  });
  await confirmDmTurnLockOwned(lock);
}

function pendingTurnEventId(queueId: string) {
  return `pending_${queueId}`;
}

async function executeDmTurn(work: DmTurnWork, lock: DmTurnLock) {
  try {
    await runDmTurn({
      sessionId: work.sessionId,
      campaignId: work.campaignId,
      userId: work.runnerId,
      playerInput: {
        text: work.text,
        actorId: work.actor.dbActorId,
        displayName: work.actor.displayName,
        characterId: work.actor.characterId,
        actorKind: work.actor.actorKind,
        alreadyPersisted: true,
      },
      emit: async (ev) => {
        await publishDmEvent(work.sessionId, lock, ev.type, ev.payload);
      },
    });
  } catch (error) {
    await publishDmErrorWhileOwned(work.sessionId, lock, error);
  } finally {
    await finalizeDmTurn(work.sessionId, lock);
  }
}

export async function handleSessionRoll(
  req: Request,
  sessionId: string,
  inviteTokenOverride?: string | null,
) {
  const inviteToken = inviteTokenFrom(req, inviteTokenOverride);
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = rollBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success)
    return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      campaignId: true,
      endedAt: true,
      campaign: { select: { hostId: true } },
    },
  });
  if (!session || session.endedAt) {
    return NextResponse.json({ error: "session_closed" }, { status: 410 });
  }

  const actor = await resolveActingIdentity({
    access,
    campaignId: session.campaignId,
    requestedCharacterId: body.data.characterId,
  });
  if (!actor) {
    return NextResponse.json({ error: "invalid_character" }, { status: 403 });
  }

  const dmTurnLock: DmTurnLock | null =
    actor.actorKind === "player" ? await acquireDmTurnLock(sessionId) : null;
  if (actor.actorKind === "player" && !dmTurnLock) {
    return NextResponse.json({ error: "dm_busy" }, { status: 409 });
  }

  let result;
  try {
    result = rollDice(body.data.notation);
  } catch (e) {
    if (dmTurnLock) await releaseDmTurnLock(dmTurnLock);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad_notation" },
      { status: 400 },
    );
  }

  try {
    await publishEvent(
      sessionId,
      "dice_roll",
      {
        notation: body.data.notation,
        total: result.total,
        breakdown: result.breakdown,
        rolls: result.rolls,
        reason: body.data.reason,
        actorId: actor.eventActorId,
        actor: actor.actorKind,
        displayName: actor.displayName,
        characterId: actor.characterId,
      },
      { actorId: actor.dbActorId },
    );
  } catch (error) {
    if (dmTurnLock) await releaseDmTurnLock(dmTurnLock);
    throw error;
  }

  if (actor.actorKind === "player") {
    try {
      await publishDmEvent(sessionId, dmTurnLock!, "dm_thinking", {
        active: true,
      });
      await confirmDmTurnLockOwned(dmTurnLock!);
    } catch (error) {
      if (dmTurnLock) await releaseDmTurnLock(dmTurnLock);
      throw error;
    }
    void runDmTurn({
      sessionId,
      campaignId: session.campaignId,
      userId: session.campaign.hostId,
      playerInput: {
        text: buildRollInput({
          displayName: actor.displayName,
          notation: body.data.notation,
          total: result.total,
          breakdown: result.breakdown,
          reason: body.data.reason,
        }),
        actorId: actor.dbActorId,
        displayName: actor.displayName,
        characterId: actor.characterId,
        actorKind: actor.actorKind,
        alreadyPersisted: true,
      },
      emit: async (ev) => {
        await publishDmEvent(sessionId, dmTurnLock!, ev.type, ev.payload);
      },
    })
      .catch(async (e) => {
        await publishDmErrorWhileOwned(sessionId, dmTurnLock!, e);
      })
      .finally(async () => {
        if (dmTurnLock) await finalizeDmTurn(sessionId, dmTurnLock);
      });
  }

  return NextResponse.json({
    total: result.total,
    breakdown: result.breakdown,
  });
}

async function publishDmErrorWhileOwned(
  sessionId: string,
  lock: DmTurnLock,
  error: unknown,
) {
  try {
    await publishDmEvent(sessionId, lock, "dm_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
  } catch {
    // A stale runner must not emit an error into its successor's event stream.
  }
}

async function publishDmEvent(
  sessionId: string,
  lock: DmTurnLock,
  type: string,
  payload: Record<string, unknown>,
) {
  await confirmDmTurnLockOwned(lock);
  await publishEvent(sessionId, type, {
    ...payload,
    _dmTurnFence: lock.fence,
  });
}

async function finalizeDmTurn(sessionId: string, lock: DmTurnLock) {
  try {
    await withTimeout(
      publishDmEvent(sessionId, lock, "dm_thinking", { active: false }),
      DM_FINALIZATION_TIMEOUT_MS,
    );
  } catch {
    // Lease loss or a stuck event bus must not retain the admission lock.
  } finally {
    await releaseDmTurnLock(lock);
  }
  schedulePendingTurnDrain(sessionId);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("DM finalization timed out"));
    }, timeoutMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
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

async function combatTurnAdmission(
  campaignId: string,
  actor: ActingIdentity,
): Promise<{
  active: boolean;
  block: { error: "not_your_turn"; active: string | null } | null;
}> {
  const encounter = await prisma.encounter.findFirst({
    where: { campaignId, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: { initiative: true, activeTurn: true },
  });
  if (!encounter) return { active: false, block: null };
  if (actor.actorKind !== "player" || !actor.characterId) {
    return { active: true, block: null };
  }
  const allowed = isActiveTurnForCharacter({
    initiative: encounter.initiative,
    turnIndex: encounter.activeTurn,
    characterId: actor.characterId,
    characterName: actor.displayName,
  });
  return {
    active: true,
    block: allowed
      ? null
      : {
          error: "not_your_turn",
          active: activeInitiativeName(
            encounter.initiative,
            encounter.activeTurn,
          ),
        },
  };
}

function buildRollInput(input: {
  displayName: string;
  notation: string;
  total: number;
  breakdown: string;
  reason?: string;
}) {
  return [
    `${input.displayName} hat ${input.notation} gewürfelt: ${input.total}.`,
    input.reason ? `Anlass: ${input.reason}.` : "",
    `Details: ${input.breakdown}.`,
    "Werte das Ergebnis als DM aus.",
  ]
    .filter(Boolean)
    .join(" ");
}

registerPendingTurnDrainer(drainPendingTurns);
