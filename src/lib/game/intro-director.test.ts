import { describe, expect, it } from "vitest";
import {
  buildIntroDirectorChapters,
  introDirectorStorageKey,
  playerFacingLegacyOpeningCopy,
} from "./intro-director";
import type { IntroSequenceState } from "./store";

const intro: IntroSequenceState = {
  title: "Opening",
  establishingShot: "Nebel liegt auf dem Dorfplatz.",
  setupBeats: [
    { title: "Die schweigende Glocke", text: "Die Glocke schweigt." },
    { title: "Der wartende Zeuge", text: "Ein Zeuge wartet." },
  ],
  whyHere: "Die Spur beginnt hier.",
  characterHookStyle: null,
  characterIntros: [
    {
      characterId: "hero",
      name: "Robert",
      summary: "Human Fighter",
      prompt: "Robert, was sieht man zuerst?",
      portraitUrl: "https://assets.example/robert.png",
    },
  ],
  objective: "Findet die vermisste Kundschafterin.",
  stakes: "Die Spur erkaltet vor Sonnenuntergang.",
  firstPrompt: "Stellt euch kurz vor.",
  nextActions: ["Den Zeugen befragen."],
};

describe("intro director", () => {
  it("renders explicit setup beat titles without deriving a headline", () => {
    const chapters = buildIntroDirectorChapters({
      intro: {
        ...intro,
        setupBeats: [
          {
            title: "Blicke im Diner",
            text: "Elinor Hale mustert die Fremden.",
          },
        ],
      },
      scene: { sceneTitle: "Opening", locationName: "Cypress Hollow" },
    });

    expect(chapters[1]).toMatchObject({
      title: "Blicke im Diner",
      body: "Elinor Hale mustert die Fremden.",
    });
  });

  it("builds cinematic chapters in playback order", () => {
    const chapters = buildIntroDirectorChapters({
      intro,
      scene: { sceneTitle: "Am Brunnen", locationName: "Dorfplatz" },
    });

    expect(chapters.map((chapter) => chapter.kind)).toEqual([
      "establishing",
      "beat",
      "beat",
      "character",
      "mission",
    ]);
    expect(chapters[0]).toMatchObject({
      title: "Dorfplatz",
      body: "Nebel liegt auf dem Dorfplatz.",
      meta: "Die Spur beginnt hier.",
    });
    expect(chapters[3]).toMatchObject({
      label: "Auftritt",
      title: "Robert",
      body: "Robert, was sieht man zuerst?",
      portraitUrl: "https://assets.example/robert.png",
    });
    expect(chapters[4]?.body).toContain("Stellt euch kurz vor.");
    expect(chapters.map((chapter) => chapter.label)).toEqual([
      "Ort",
      "Auftakt",
      "Auftakt",
      "Auftritt",
      "Auftrag",
    ]);
    expect(chapters.map((chapter) => chapter.label)).not.toEqual(
      expect.arrayContaining(["Totale", "Regie", "Kamera", "Spannung"]),
    );
  });

  it("renders an explicit arrival beat title", () => {
    const chapters = buildIntroDirectorChapters({
      intro: {
        ...intro,
        setupBeats: [
          {
            title: "Ankunft am Lichterkai",
            text: "Die Figur kommt mit Brinna Lows kleinem Boot am Lichterkai an, während die Hafenglocke stumm bleibt und Wachlaternen alle Ausfahrten sperren.",
          },
        ],
      },
      scene: { sceneTitle: "Opening", locationName: "Lichterkai" },
    });

    expect(chapters[1]?.title).toBe("Ankunft am Lichterkai");
  });

  it("renders an explicit npc encounter beat title", () => {
    const chapters = buildIntroDirectorChapters({
      intro: {
        ...intro,
        setupBeats: [
          {
            title: "Begegnung mit Mara Venn",
            text: "Mara Venn empfängt sie unter einer tropfenden Markise mit einem Auftrag und einem Blick, der hier niemandem traut.",
          },
        ],
      },
      scene: { sceneTitle: "Opening", locationName: "Lichterkai" },
    });

    expect(chapters[1]?.title).toBe("Begegnung mit Mara Venn");
  });

  it("uses stable storage keys that change with intro content", () => {
    expect(introDirectorStorageKey("session-a", intro)).toBe(
      introDirectorStorageKey("session-a", intro),
    );
    expect(introDirectorStorageKey("session-a", intro)).not.toBe(
      introDirectorStorageKey("session-b", intro),
    );
    expect(introDirectorStorageKey("session-a", intro)).not.toBe(
      introDirectorStorageKey("session-a", {
        ...intro,
        objective: "Sichert die Brücke.",
      }),
    );
    expect(introDirectorStorageKey("session-a", intro)).not.toBe(
      introDirectorStorageKey("session-a", {
        ...intro,
        setupBeats: [
          { ...intro.setupBeats[0]!, title: "Ein anderer Titel" },
          ...intro.setupBeats.slice(1),
        ],
      }),
    );
  });

  it("turns legacy prompt directions into natural player-facing copy", () => {
    expect(
      playerFacingLegacyOpeningCopy(
        "Beschreibe Cypress Hollow als regennasse Kleinstadt unter einem bleigrauen Nachmittag.",
      ),
    ).toBe(
      "Cypress Hollow zeigt sich als regennasse Kleinstadt unter einem bleigrauen Nachmittag.",
    );
    expect(
      playerFacingLegacyOpeningCopy(
        "Lia ist in Cypress Hollow, weil die Gruppe soll: Entscheiden, ob sie eingreift.",
      ),
    ).toBe(
      "Lia ist in Cypress Hollow. Die Gruppe soll entscheiden, ob sie eingreift.",
    );
  });
});
