import { describe, expect, it } from "vitest";
import { runToolCall, type ToolCtx, type ToolEvent } from "./tools";

function narrateCall(text: string) {
  return {
    id: "call_narrate",
    type: "function",
    function: {
      name: "narrate",
      arguments: JSON.stringify({ text }),
    },
  } as const;
}

describe("narrate style gate", () => {
  const ctx = (events: ToolEvent[]): ToolCtx => ({
    campaignId: "campaign_1",
    sessionId: "session_1",
    userId: "user_1",
    emit: (event) => {
      events.push(event);
    },
  });

  it("rejects pseudo-dialect and translated German before emitting", async () => {
    const events: ToolEvent[] = [];
    const result = await runToolCall(
      ctx(events),
      narrateCall(
        '"Du kannst fuer mich sichtbar gehen, mit meinem Siegel und meinen Fragen. Dann kommst du durch verschlossene Tueren, aber die Dockratten schliessen ihre Muender. Oder du gehst leise, ohne meinen Namen, und ich gebe dir nur, was ich unter der Hand geben kann."',
      ),
    );

    expect(result).toContain("Narration rejected");
    expect(result).toContain("Do not invent dialects");
    expect(events).toEqual([]);
  });

  it("still emits idiomatic standard German narration", async () => {
    const events: ToolEvent[] = [];
    const text =
      '"Du kannst offen fuer mich auftreten: mit meinem Siegel und meinen Fragen. Das oeffnet dir verschlossene Tueren, aber manche Leute am Dock werden dann schweigen."';

    const result = await runToolCall(ctx(events), narrateCall(text));

    expect(result).toBe("narration delivered");
    expect(events).toEqual([
      {
        type: "narrate",
        payload: {
          text,
          speakerNpcId: null,
          speakerName: null,
          speakerPortraitUrl: null,
          mood: "neutral",
        },
      },
    ]);
  });
});
