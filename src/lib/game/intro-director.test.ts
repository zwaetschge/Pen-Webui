import { describe, expect, it } from "vitest";
import {
  buildIntroDirectorChapters,
  introDirectorStorageKey,
} from "./intro-director";
import type { IntroSequenceState } from "./store";

const intro: IntroSequenceState = {
  title: "Opening",
  establishingShot: "Nebel liegt auf dem Dorfplatz.",
  setupBeats: ["Die Glocke schweigt.", "Ein Zeuge wartet."],
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
  });

  it("condenses arrival beats into readable chapter titles", () => {
    const chapters = buildIntroDirectorChapters({
      intro: {
        ...intro,
        setupBeats: [
          "Die Figur kommt mit Brinna Lows kleinem Boot am Lichterkai an, während die Hafenglocke stumm bleibt und Wachlaternen alle Ausfahrten sperren.",
        ],
      },
      scene: { sceneTitle: "Opening", locationName: "Lichterkai" },
    });

    expect(chapters[1]?.title).toBe("Ankunft am Lichterkai");
  });

  it("condenses npc encounter beats into readable chapter titles", () => {
    const chapters = buildIntroDirectorChapters({
      intro: {
        ...intro,
        setupBeats: [
          "Mara Venn empfängt sie unter einer tropfenden Markise mit einem Auftrag und einem Blick, der hier niemandem traut.",
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
  });
});
