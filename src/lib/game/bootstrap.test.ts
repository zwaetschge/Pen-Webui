import { describe, expect, it } from "vitest";
import { buildIntroSequence, buildOpeningBrief } from "./bootstrap";

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

  it("does not show worldbuilding directions as opening narration", () => {
    const intro = buildIntroSequence({
      sceneTitle: "Opening",
      introPlan: {
        establishingShot:
          "Beschreibe Cypress Hollow als regennasse Kleinstadt unter einem bleigrauen Nachmittag: nasse Veranden und flackernde Diner-Schrift.",
        setupBeats: [],
        characterHookStyle: null,
        objective: null,
        stakes: null,
        firstPrompt: null,
      },
      brief: {
        objective: "Prueft Noras Camper.",
        whyHere: "Eine anonyme Nachricht fuehrt euch nach Cypress Hollow.",
        stakes: "Roman erreicht den Camper zuerst, wenn ihr zoegert.",
        nextActions: ["Elinor befragen."],
      },
      locationName: "Cypress Hollow",
      locationDescription:
        "Cypress Hollow liegt unter einem bleigrauen Nachmittag. Regen glaenzt auf den Veranden.",
      presentNpcNames: [],
      characters: [],
    });

    expect(intro.establishingShot).toBe(
      "Die Kamera findet euch in Cypress Hollow. Cypress Hollow liegt unter einem bleigrauen Nachmittag.",
    );
    expect(intro.establishingShot).not.toContain("Beschreibe");
  });

  it("does not show worldbuilding directions as objective or stakes", () => {
    const intro = buildIntroSequence({
      sceneTitle: "Opening",
      introPlan: {
        establishingShot: null,
        setupBeats: [],
        characterHookStyle: null,
        objective: "Beschreibe, wie die Gruppe Lias Bitte untersucht.",
        stakes: "Zeige, wie Roman den Camper zuerst erreicht.",
        firstPrompt: null,
      },
      brief: {
        objective: "Untersucht Noras Camper.",
        whyHere: "Eine anonyme Nachricht fuehrt euch nach Cypress Hollow.",
        stakes: "Roman erreicht den Camper zuerst, wenn ihr zoegert.",
        nextActions: ["Elinor befragen."],
      },
      locationName: "Cypress Hollow",
      locationDescription: null,
      presentNpcNames: [],
      characters: [],
    });

    expect(intro.objective).toBe("Untersucht Noras Camper.");
    expect(intro.stakes).toBe(
      "Roman erreicht den Camper zuerst, wenn ihr zoegert.",
    );
  });

  it("uses the narrative hook instead of joining an objective with weil", () => {
    const brief = buildOpeningBrief({
      campaignTitle: "Projekt Seraphid",
      theme: "Mystery",
      sceneTitle: "Opening",
      summary:
        "Vier Fremde erreichen Cypress Hollow im kalten Regen und folgen derselben Nachricht.",
      hook: "Eine namenlose Nachricht und Lias ruhige Bitte ziehen die Gruppe nach Cypress Hollow.",
      locationName: "Cypress Hollow",
      locationDescription: "Eine regennasse Kleinstadt.",
      presentNpcs: [],
      characters: [
        {
          name: "Lia",
          className: null,
          background: null,
          backstory: null,
        },
      ],
      threads: [],
      worldFacts: [],
      act1Summary: null,
      act1Beats: [],
      introPlan: {
        establishingShot: null,
        setupBeats: [],
        characterHookStyle: null,
        objective:
          "Die Gruppe soll entscheiden, ob sie Lias Bitte annimmt oder den Camper untersucht.",
        stakes: null,
        firstPrompt: null,
      },
    });

    expect(brief.whyHere).toBe(
      "Eine namenlose Nachricht und Lias ruhige Bitte ziehen die Gruppe nach Cypress Hollow.",
    );
    expect(brief.whyHere).not.toContain("weil die Gruppe soll");
  });
});
