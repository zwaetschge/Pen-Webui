import { describe, expect, it } from "vitest";
import {
  NARRATOR_TARGET_ID,
  readableEventFromLog,
  resolveVoiceForTarget,
} from "./voice-resolution";

const assignments = [
  {
    targetType: "npc" as const,
    targetId: "npc_moss",
    vocariumUser: "zwaetschge",
    voiceId: "2abffe14",
    voiceName: "Maurice Moss",
    voiceSource: "clone",
  },
  {
    targetType: "character" as const,
    targetId: "char_robert",
    vocariumUser: "zwaetschge",
    voiceId: "83b59aca",
    voiceName: "Michael Scott",
    voiceSource: "clone",
  },
  {
    targetType: "narrator" as const,
    targetId: NARRATOR_TARGET_ID,
    vocariumUser: "zwaetschge",
    voiceId: "f58b5eb8",
    voiceName: "Rufus Beck",
    voiceSource: "clone",
  },
];

describe("readableEventFromLog", () => {
  it("extracts NPC narration as an npc target", () => {
    expect(
      readableEventFromLog({
        id: "ev_1",
        type: "narrate",
        payload: { text: "Ich habe einen Plan.", speakerNpcId: "npc_moss" },
      }),
    ).toEqual({
      eventId: "ev_1",
      text: "Ich habe einen Plan.",
      target: { targetType: "npc", targetId: "npc_moss" },
    });
  });

  it("extracts player input as a character target when characterId exists", () => {
    expect(
      readableEventFromLog({
        id: "ev_2",
        type: "player_input",
        payload: { text: "Ich pruefe die Tuer.", characterId: "char_robert" },
      }),
    ).toEqual({
      eventId: "ev_2",
      text: "Ich pruefe die Tuer.",
      target: { targetType: "character", targetId: "char_robert" },
    });
  });

  it("uses the narrator target for narration without an NPC speaker", () => {
    expect(
      readableEventFromLog({
        id: "ev_3",
        type: "narrate",
        payload: { text: "Regen faellt auf das Dach." },
      }),
    ).toMatchObject({
      target: { targetType: "narrator", targetId: NARRATOR_TARGET_ID },
    });
  });

  it("rejects non-readable event types", () => {
    expect(
      readableEventFromLog({
        id: "ev_roll",
        type: "dice_roll",
        payload: { notation: "1d20" },
      }),
    ).toBeNull();
  });
});

describe("resolveVoiceForTarget", () => {
  it("prefers the exact NPC assignment", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "npc", targetId: "npc_moss" },
        assignments,
        vocariumUser: "zwaetschge",
      }),
    ).toMatchObject({ voiceId: "2abffe14", voiceName: "Maurice Moss" });
  });

  it("prefers the exact character assignment", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "character", targetId: "char_robert" },
        assignments,
        vocariumUser: "zwaetschge",
      }),
    ).toMatchObject({ voiceId: "83b59aca", voiceName: "Michael Scott" });
  });

  it("falls back to narrator assignment", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "npc", targetId: "npc_unknown" },
        assignments,
        vocariumUser: "zwaetschge",
      }),
    ).toMatchObject({ voiceId: "f58b5eb8", voiceName: "Rufus Beck" });
  });

  it("falls back to Vocarium default when no assignment exists", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "npc", targetId: "npc_unknown" },
        assignments: [],
        vocariumUser: "zwaetschge",
      }),
    ).toEqual({
      voiceId: "default",
      voiceName: "Default",
      voiceSource: "clone",
      vocariumUser: "zwaetschge",
      fallback: "default",
    });
  });
});
