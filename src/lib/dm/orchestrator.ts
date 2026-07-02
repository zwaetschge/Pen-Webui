/**
 * DM turn orchestrator.
 *
 * For each player message we:
 *   1. Persist the player input as an EventLog row.
 *   2. Build the system prompt from the live world digest.
 *   3. Reconstruct the conversation from EventLog (with rolling summary).
 *   4. Call the configured DM runtime (Codex CLI primary, API fallback).
 *   5. If the model emits tool calls, execute each (which emits scene events
 *      to the client via the supplied `emit` callback) and feed the results
 *      back in as `tool` messages, looping until the model returns a final
 *      assistant message.
 *   6. Persist every turn-message and trigger compaction if the transcript
 *      is growing.
 *
 * Hard ceilings:
 *   - MAX_TOOL_ROUNDS: prevents runaway loops if the model keeps calling tools.
 *   - MAX_OUTPUT_TOKENS: per-turn output cap.
 *
 * Compaction summariser uses the configured DM runtime with low temperature.
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { buildDigest } from "./digest";
import { completeDmChat } from "./llm";
import { buildSystemPrompt } from "./prompts";
import {
  allToolDefinitions,
  runToolCall,
  type ToolCtx,
  type ToolEvent,
} from "./tools";
import { appendChatEvent, loadConversation, maybeCompact } from "./memory";
import { narrationStyleRejection } from "./narration-style";

const MAX_TOOL_ROUNDS = 6;
const MAX_OUTPUT_TOKENS = 4096;

export type DMRunOptions = {
  sessionId: string;
  campaignId: string;
  userId: string;
  /** Player message text (free-form). */
  playerInput: {
    text: string;
    actorId: string | null;
    displayName: string;
    characterId?: string | null;
    actorKind?: "dm" | "player";
    alreadyPersisted?: boolean;
  };
  emit: (event: ToolEvent) => void | Promise<void>;
};

export type DMRunResult = {
  finalText: string;
  toolEvents: ToolEvent[];
  tokensUsed: number;
};

export async function runDmTurn(opts: DMRunOptions): Promise<DMRunResult> {
  const { sessionId, campaignId, userId, playerInput, emit } = opts;

  // 1. persist player input unless the HTTP route already published the
  // canonical player_input event for immediate UI feedback.
  if (!playerInput.alreadyPersisted) {
    await appendChatEvent(sessionId, playerInput.actorId, {
      kind: "player_input",
      actorId: playerInput.actorId,
      displayName: playerInput.displayName,
      text: playerInput.text,
      characterId: playerInput.characterId ?? null,
      actorKind: playerInput.actorKind,
    });
  }

  // 2. build system prompt
  const { persona, digest } = await buildDigest(campaignId, sessionId);
  const systemPrompt = buildSystemPrompt(persona, digest);

  // 3. load conversation
  const history = await loadConversation(sessionId);
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const collectedEvents: ToolEvent[] = [];
  const captureEmit = async (e: ToolEvent) => {
    collectedEvents.push(e);
    await emit(e);
  };

  const toolCtx: ToolCtx = {
    campaignId,
    sessionId,
    userId,
    emit: captureEmit,
  };

  let finalText = "";
  let totalTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await completeDmChat({
      userId,
      messages,
      tools: allToolDefinitions(),
      maxCompletionTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.8,
    });
    totalTokens += resp.tokensUsed;

    const toolCalls = resp.toolCalls;
    const content = resp.content;

    // record the assistant turn
    messages.push({
      role: "assistant",
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });
    await appendChatEvent(sessionId, null, {
      kind: "assistant_message",
      content,
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    });

    if (toolCalls.length === 0) {
      finalText = content;
      break;
    }

    // execute tools in declared order
    let waitingForPlayerRoll = false;
    for (const call of toolCalls as ChatCompletionMessageToolCall[]) {
      const result = await runToolCall(toolCtx, call);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
      await appendChatEvent(sessionId, null, {
        kind: "tool_result",
        toolCallId: call.id,
        name: call.function.name,
        result,
      });
      if (call.function.name === "request_skill_check") {
        waitingForPlayerRoll = true;
      }
    }

    if (waitingForPlayerRoll) {
      finalText = "";
      break;
    }
  }

  if (!collectedEvents.some(isVisibleDmOutput)) {
    const text =
      cleanFallbackNarration(finalText) ??
      "Die Spielleitung sammelt die Lage: Die Szene bleibt offen, die Spannung hält an, und deine letzte Handlung verlangt eine klare Entscheidung. Was tust du als Nächstes?";
    await captureEmit({
      type: "narrate",
      payload: {
        text,
        speakerNpcId: null,
        speakerName: null,
        speakerPortraitUrl: null,
        mood: "neutral",
      },
    });
  }

  // 4. async compaction (don't block the turn)
  void maybeCompact(sessionId, async (transcript, prev) => {
    const s = await completeDmChat({
      userId,
      temperature: 0.2,
      maxCompletionTokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "Compact the following DnD session transcript into a concise " +
            "canonical memo. Preserve: NPC names introduced, items gained/lost, " +
            "promises made, places visited, current state of the party, open " +
            "plot threads. Output prose, no headings.",
        },
        ...(prev
          ? [
              {
                role: "system" as const,
                content: "PREVIOUS MEMO (extend, do not repeat):\n" + prev,
              },
            ]
          : []),
        { role: "user", content: transcript.slice(0, 60_000) },
      ],
    });
    return s.content ?? prev ?? "";
  }).catch(() => {});

  return { finalText, toolEvents: collectedEvents, tokensUsed: totalTokens };
}

function isVisibleDmOutput(event: ToolEvent) {
  return [
    "narrate",
    "skill_check_requested",
    "combat_started",
    "combat_ended",
    "party_defeated",
    "game_over",
    "session_ended",
    "scene_set",
    "scene_ended",
  ].includes(event.type);
}

export function cleanFallbackNarration(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/^dm\s*:\s*/i, "")
    .replace(/^spielleitung\s*:\s*/i, "")
    .trim();
  if (!cleaned || narrationStyleRejection(cleaned)) return null;
  return cleaned;
}
