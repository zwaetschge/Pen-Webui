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
      "Ihr befindet euch in Cypress Hollow. Cypress Hollow liegt unter einem bleigrauen Nachmittag.",
    );
    expect(intro.establishingShot).not.toContain("Beschreibe");
  });

  it("filters prefixed writing directions from beat titles and narration", () => {
    const intro = buildIntroSequence({
      sceneTitle: "Opening",
      introPlan: {
        establishingShot:
          "Für den Auftakt: Beschreibe Cypress Hollow im kalten Regen.",
        setupBeats: [
          {
            title: "Für den Auftakt: Beschreibe den ersten Verdacht",
            text: "Elinor Hale mustert die Fremden.",
          },
          {
            title: "Blicke im Diner",
            text: "Regie: Zeige, wie Elinor Hale die Fremden mustert.",
          },
          {
            title: "Der erste Verdacht",
            text: "Der DM zeigt, wie ein Schatten an der Hintertür vorbeizieht.",
          },
          {
            title: "Die verschlossene Tür",
            text: "Hinter der Küche fällt ein schwerer Riegel ins Schloss.",
          },
        ],
        characterHookStyle: null,
        objective: null,
        stakes: null,
        firstPrompt:
          "Für den Auftakt: Beschreibe, wie die Gruppe ihre erste Entscheidung trifft.",
      },
      brief: {
        objective: "Prueft Noras Camper.",
        whyHere: "Eine anonyme Nachricht fuehrt euch nach Cypress Hollow.",
        stakes: "Roman erreicht den Camper zuerst, wenn ihr zoegert.",
        nextActions: ["Elinor befragen."],
      },
      locationName: "Cypress Hollow",
      locationDescription:
        "Regen glaenzt auf den Veranden, waehrend das Diner fast leer bleibt.",
      presentNpcNames: ["Elinor Hale"],
      characters: [],
    });

    expect(intro.establishingShot).toBe(
      "Ihr befindet euch in Cypress Hollow. Regen glaenzt auf den Veranden, waehrend das Diner fast leer bleibt.",
    );
    expect(intro.setupBeats).toContainEqual({
      title: "Die verschlossene Tür",
      text: "Hinter der Küche fällt ein schwerer Riegel ins Schloss.",
    });
    for (const beat of intro.setupBeats) {
      expect(beat.title).not.toMatch(/Beschreibe|Regie|\bDM\b/iu);
      expect(beat.text).not.toMatch(/Beschreibe|Regie|\bDM\b/iu);
    }
    expect(intro.firstPrompt).not.toMatch(/Für den Auftakt|Beschreibe/iu);
  });

  it("keeps three complete planned beats without artificial filler", () => {
    const plannedBeats = [
      { title: "Der leere Tisch", text: "Vier Tassen stehen unberührt da." },
      { title: "Ein fremder Wagen", text: "Vor dem Diner läuft ein Motor." },
      { title: "Das Klopfen", text: "Dreimal klopft es an der Hintertür." },
    ];
    const intro = buildIntroSequence({
      sceneTitle: "Auftakt",
      introPlan: {
        establishingShot: "Regen liegt über Cypress Hollow.",
        setupBeats: plannedBeats,
        characterHookStyle: null,
        objective: null,
        stakes: null,
        firstPrompt: null,
      },
      brief: {
        objective: "Öffnet die Hintertür.",
        whyHere: "Eine Nachricht führt euch hierher.",
        stakes: "Die Spur verschwindet.",
        nextActions: [],
      },
      locationName: "Cypress Hollow",
      locationDescription: "Das Diner liegt im Regen.",
      presentNpcNames: ["Elinor Hale"],
      characters: [],
    });

    expect(intro.setupBeats).toEqual(plannedBeats);
  });

  it("uses distinct natural titles for generated fallback beats", () => {
    const intro = buildIntroSequence({
      sceneTitle: "Auftakt",
      introPlan: {
        establishingShot: null,
        setupBeats: [],
        characterHookStyle: null,
        objective: null,
        stakes: null,
        firstPrompt: null,
      },
      brief: {
        objective: "Findet die vermisste Person.",
        whyHere: "Eine anonyme Nachricht führt euch zum Diner.",
        stakes: "Die Spur erkaltet noch vor Einbruch der Nacht.",
        nextActions: [],
      },
      locationName: "Cypress Hollow",
      locationDescription: "Das Diner ist hell, aber fast leer.",
      presentNpcNames: ["Elinor Hale"],
      characters: [],
    });

    expect(intro.setupBeats).toHaveLength(3);
    expect(new Set(intro.setupBeats.map((beat) => beat.title)).size).toBe(3);
    expect(intro.setupBeats.map((beat) => beat.title)).not.toContain(
      "Ein neuer Moment",
    );
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
