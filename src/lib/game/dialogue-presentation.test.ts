import { describe, expect, it } from "vitest";
import {
  dialoguePresentationForEvent,
  latestDialoguePresentation,
  speakerForNarration,
} from "./dialogue-presentation";
import type { ChatLine, SceneState } from "./store";

describe("dialogue presentation", () => {
  const scene: SceneState = {
    presentNpcs: [
      {
        id: "npc_elara",
        name: "Elara",
        role: "Archivarin",
        portraitUrl: "https://assets.example/elara.png",
      },
    ],
    characters: [
      {
        id: "char_robert",
        name: "Robert",
        className: "Fighter",
        portraitUrl: "https://assets.example/robert.png",
      },
    ],
  };

  it("uses the active npc as the speaker for npc narration", () => {
    const speaker = speakerForNarration(
      {
        kind: "narrate",
        id: "line_1",
        ts: 1,
        text: "Ihr seid spaet.",
        speakerNpcId: "npc_elara",
        mood: "concerned",
      },
      {
        ...scene,
        activeNpc: {
          id: "npc_elara",
          name: "Elara",
          portraitUrl: "https://assets.example/elara-close.png",
          mood: "concerned",
        },
      },
    );

    expect(speaker).toEqual({
      label: "Elara",
      mood: "concerned",
      portraitUrl: "https://assets.example/elara-close.png",
    });
  });

  it("falls back to present npc metadata when the active npc is missing", () => {
    const speaker = speakerForNarration(
      {
        kind: "narrate",
        id: "line_1",
        ts: 1,
        text: "Folgt dem roten Faden.",
        speakerNpcId: "npc_elara",
      },
      scene,
    );

    expect(speaker).toEqual({
      label: "Elara",
      mood: undefined,
      portraitUrl: "https://assets.example/elara.png",
    });
  });

  it("projects the latest player or narration line for visual novel UI", () => {
    const chat: ChatLine[] = [
      {
        kind: "roll",
        id: "roll_1",
        ts: 1,
        actor: "player",
        displayName: "Robert",
        notation: "1d20",
        total: 12,
        breakdown: "12",
      },
      {
        kind: "player",
        id: "player_1",
        ts: 2,
        displayName: "Robert",
        text: "Ich pruefe die Tuer.",
      },
      {
        kind: "system",
        id: "system_1",
        ts: 3,
        text: "Probe gefordert.",
      },
    ];

    expect(latestDialoguePresentation(chat, scene)).toEqual({
      id: "player_1",
      kind: "player",
      speakerLabel: "Robert",
      text: "Ich pruefe die Tuer.",
      mood: undefined,
      portraitUrl: "https://assets.example/robert.png",
    });
  });

  it("labels narration without an npc speaker as the narrator", () => {
    const chat: ChatLine[] = [
      {
        kind: "narrate",
        id: "narrate_1",
        ts: 1,
        text: "Regen trommelt auf die Plane.",
      },
    ];

    expect(latestDialoguePresentation(chat, scene)).toEqual({
      id: "narrate_1",
      kind: "narrator",
      speakerLabel: "Erzähler",
      text: "Regen trommelt auf die Plane.",
      mood: undefined,
      portraitUrl: undefined,
    });
  });

  it("pins a cinematic presentation to its triggering event", () => {
    const chat: ChatLine[] = [
      {
        kind: "narrate",
        id: "npc_line",
        ts: 1,
        text: "Bleibt, wo ihr seid.",
        speakerNpcId: "npc_elara",
      },
      {
        kind: "player",
        id: "player_line",
        ts: 2,
        displayName: "Robert",
        text: "Warum?",
      },
    ];

    expect(dialoguePresentationForEvent(chat, scene, "npc_line")).toEqual({
      id: "npc_line",
      kind: "npc",
      speakerLabel: "Elara",
      text: "Bleibt, wo ihr seid.",
      mood: undefined,
      portraitUrl: "https://assets.example/elara.png",
    });
  });
});
