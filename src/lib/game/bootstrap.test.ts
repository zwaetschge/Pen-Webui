import { describe, expect, it } from "vitest";
import { buildIntroSequence } from "./bootstrap";

describe("session bootstrap intro", () => {
  it("preserves explicit setup beat titles and narration", () => {
    const intro = buildIntroSequence({
      sceneTitle: "Opening",
      introPlan: {
        establishingShot: "Regen haengt ueber Cypress Hollow.",
        setupBeats: [
          {
            title: "Blicke im Diner",
            text: "Elinor Hale mustert die Fremden.",
          },
        ],
        characterHookStyle: null,
        objective: null,
        stakes: null,
        firstPrompt: null,
      },
      brief: {
        objective: "Prueft Noras Camper.",
        whyHere: "",
        stakes: "Roman erreicht den Camper zuerst, wenn ihr zoegert.",
        nextActions: ["Elinor befragen."],
      },
      locationName: "Cypress Hollow",
      locationDescription: null,
      presentNpcNames: [],
      characters: [],
    });

    expect(intro.setupBeats).toEqual([
      {
        title: "Blicke im Diner",
        text: "Elinor Hale mustert die Fremden.",
      },
    ]);
  });
});
