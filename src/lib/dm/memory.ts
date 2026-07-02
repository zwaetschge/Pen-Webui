/**
 * Conversation memory + compaction.
 *
 * Each game session has an append-only EventLog. The DM orchestrator pulls
 * the last N turns and summarises older turns into a single rolling
 * "campaign so far" memo to keep the prompt within a sane token budget.
 *
 * We persist the compacted memo on `GameSession.summary` so it survives
 * restarts; the live transcript is rebuilt from EventLog rows.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { redis } from "../redis";
import type {
  ChatCompletionMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";

const LIVE_EVENT_LIMIT = 60;
const COMPACT_THRESHOLD = 80;
const COMPACT_BATCH_LIMIT = 120;
const COMPACT_LOCK_TTL_MS = 5 * 60 * 1000;
const COMPACT_EVENT_TYPES = [
  "player_input",
  "assistant_message",
  "tool_result",
] as const;
const COMPACT_EVENT_TYPE_LIST = [...COMPACT_EVENT_TYPES];
const localCompactionLocks = new Set<string>();

export type StoredMessageEvent =
  | {
      kind: "player_input";
      actorId: string | null;
      displayName: string;
      text: string;
      characterId?: string | null;
      actorKind?: "dm" | "player";
    }
  | {
      kind: "assistant_message";
      content: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: string;
      }>;
    }
  | {
      kind: "tool_result";
      toolCallId: string;
      name: string;
      result: string;
    };

type StoredDiceRollEvent = {
  notation?: string;
  total?: number;
  breakdown?: string;
  reason?: string;
  actor?: string;
  displayName?: string;
  characterId?: string | null;
};

export async function appendChatEvent(
  sessionId: string,
  actorId: string | null,
  event: StoredMessageEvent,
): Promise<void> {
  await prisma.eventLog.create({
    data: {
      sessionId,
      actorId: actorId ?? undefined,
      type: event.kind,
      payload: event as never,
    },
  });
}

/**
 * Reconstruct OpenAI-style message array from EventLog + summary.
 * Returns at most LIVE_EVENT_LIMIT recent messages, with the rolling
 * summary prepended as a system message.
 */
export async function loadConversation(
  sessionId: string,
): Promise<ChatCompletionMessageParam[]> {
  const session = await prisma.gameSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { summary: true },
  });

  const events = await prisma.eventLog.findMany({
    where: {
      sessionId,
      type: {
        in: ["player_input", "assistant_message", "tool_result", "dice_roll"],
      },
    },
    orderBy: { ts: "desc" },
    take: LIVE_EVENT_LIMIT,
  });
  events.reverse();

  const out: ChatCompletionMessageParam[] = [];
  if (session.summary) {
    out.push({
      role: "system",
      content:
        "Story so far (compact memo — canonical, do not contradict):\n" +
        session.summary,
    });
  }

  for (const ev of events) {
    const payload = ev.payload as StoredMessageEvent;
    if (ev.type === "dice_roll") {
      const roll = ev.payload as StoredDiceRollEvent;
      if (roll.actor === "dm") continue;
      const displayName = roll.displayName ?? "Spieler";
      const parts = [
        `${displayName} würfelt ${roll.notation ?? "Würfel"} = ${roll.total ?? "?"}.`,
        roll.reason ? `Anlass: ${roll.reason}.` : "",
        roll.breakdown ? `Details: ${roll.breakdown}.` : "",
        "Werte dieses Ergebnis als DM aus und beschreibe die Konsequenz.",
      ].filter(Boolean);
      out.push({
        role: "user",
        name: messageName(displayName),
        content: parts.join(" "),
      });
      continue;
    }

    switch (payload.kind) {
      case "player_input": {
        const content = formatPlayerInputForDm(payload);
        const msg: ChatCompletionUserMessageParam = {
          role: "user",
          name: messageName(payload.displayName),
          content,
        };
        out.push(msg);
        break;
      }
      case "assistant_message": {
        const msg: ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: payload.content || null,
          tool_calls: payload.toolCalls?.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
        out.push(msg);
        break;
      }
      case "tool_result": {
        const msg: ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: payload.toolCallId,
          content: payload.result,
        };
        out.push(msg);
        break;
      }
    }
  }
  return out;
}

/**
 * Compact older turns into the rolling summary if the live transcript is
 * getting long.  Returns true if compaction ran.
 */
export async function maybeCompact(
  sessionId: string,
  summariser: (transcript: string, prev: string | null) => Promise<string>,
): Promise<boolean> {
  const total = await prisma.eventLog.count({
    where: {
      sessionId,
      type: { in: COMPACT_EVENT_TYPE_LIST },
    },
  });
  if (total <= COMPACT_THRESHOLD) return false;

  const lock = await acquireCompactionLock(sessionId);
  if (!lock) return false;

  try {
    const freshTotal = await prisma.eventLog.count({
      where: {
        sessionId,
        type: { in: COMPACT_EVENT_TYPE_LIST },
      },
    });
    if (freshTotal <= COMPACT_THRESHOLD) return false;

  // pull all but the last LIVE_EVENT_LIMIT for summarisation
    const olderCount = Math.min(
      freshTotal - LIVE_EVENT_LIMIT,
      COMPACT_BATCH_LIMIT,
    );
    const older = await prisma.eventLog.findMany({
      where: {
        sessionId,
        type: { in: COMPACT_EVENT_TYPE_LIST },
      },
      orderBy: { ts: "asc" },
      take: olderCount,
    });
    if (older.length === 0) return false;

    const transcript = older
      .map((e) => {
        const p = e.payload as StoredMessageEvent;
        if (p.kind === "player_input")
          return `[Spieler ${p.displayName}] ${p.text}`;
        if (p.kind === "assistant_message") return `[DM] ${p.content}`;
        if (p.kind === "tool_result")
          return `[Tool ${p.name}] ${p.result.slice(0, 240)}`;
        return "";
      })
      .filter(Boolean)
      .join("\n");

    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { summary: true },
    });
    const updated = await summariser(transcript, session?.summary ?? null);

    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { summary: updated },
    });

  // Mark the now-summarised events so they aren't re-summarised next time.
    await prisma.eventLog.updateMany({
      where: { id: { in: older.map((e) => e.id) } },
      data: { type: "archived" },
    });
    return true;
  } finally {
    await releaseCompactionLock(lock);
  }
}

type CompactionLock = {
  key: string;
  token: string;
  redisBacked: boolean;
};

async function acquireCompactionLock(
  sessionId: string,
): Promise<CompactionLock | null> {
  const key = `lock:session:${sessionId}:compact`;
  if (localCompactionLocks.has(key)) return null;

  const token = randomUUID();
  localCompactionLocks.add(key);
  try {
    const ok = await redis.set(key, token, "PX", COMPACT_LOCK_TTL_MS, "NX");
    if (ok !== "OK") {
      localCompactionLocks.delete(key);
      return null;
    }
    return { key, token, redisBacked: true };
  } catch {
    return { key, token, redisBacked: false };
  }
}

async function releaseCompactionLock(lock: CompactionLock) {
  localCompactionLocks.delete(lock.key);
  if (!lock.redisBacked) return;
  try {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lock.key,
      lock.token,
    );
  } catch {
    /* lock expires by TTL */
  }
}

function formatPlayerInputForDm(
  payload: Extract<StoredMessageEvent, { kind: "player_input" }>,
) {
  if (payload.actorKind === "dm" && !payload.characterId) {
    return `Tischhinweis des Hosts an die KI-Spielleitung: ${payload.text}`;
  }
  if (payload.characterId) {
    return `${payload.displayName} handelt als Spielercharakter: ${payload.text}`;
  }
  return `${payload.displayName} handelt oder spricht als Spieler: ${payload.text}`;
}

function messageName(displayName: string) {
  return displayName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "Spieler";
}
