import type { IntroSequenceState, SceneState } from "./store";

export type IntroDirectorChapter = {
  id: string;
  kind: "establishing" | "beat" | "character" | "mission";
  label: string;
  title: string;
  body: string;
  meta?: string | null;
  portraitUrl?: string | null;
  accent: "brass" | "arcane" | "blood";
};

export function buildIntroDirectorChapters({
  intro,
  scene,
}: {
  intro: IntroSequenceState;
  scene: Pick<SceneState, "sceneTitle" | "locationName">;
}): IntroDirectorChapter[] {
  const sceneTitle =
    clean(intro.title) ??
    clean(scene.sceneTitle) ??
    clean(scene.locationName) ??
    "Auftakt";
  const chapters: IntroDirectorChapter[] = [];

  const establishingShot = playerFacingLegacyOpeningCopy(
    intro.establishingShot,
  );
  if (establishingShot) {
    chapters.push({
      id: "establishing",
      kind: "establishing",
      label: "Ort",
      title: clean(scene.locationName) ?? sceneTitle,
      body: establishingShot,
      meta: playerFacingLegacyOpeningCopy(intro.whyHere),
      accent: "brass",
    });
  }

  intro.setupBeats.slice(0, 6).forEach((beat, index) => {
    chapters.push({
      id: `beat-${index + 1}`,
      kind: "beat",
      label: "Auftakt",
      title: beat.title,
      body: playerFacingLegacyOpeningCopy(beat.text) ?? beat.text,
      accent: index % 2 === 0 ? "arcane" : "brass",
    });
  });

  intro.characterIntros.forEach((character, index) => {
    const body =
      playerFacingLegacyOpeningCopy(character.text) ??
      playerFacingLegacyOpeningCopy(character.prompt) ??
      playerFacingLegacyOpeningCopy(character.summary) ??
      null;
    if (!body) return;

    chapters.push({
      id: `character-${character.characterId}`,
      kind: "character",
      label: "Auftritt",
      title: character.name,
      body,
      meta: playerFacingLegacyOpeningCopy(character.summary),
      portraitUrl: clean(character.portraitUrl),
      accent: index % 2 === 0 ? "brass" : "arcane",
    });
  });

  const missionBody = [
    playerFacingLegacyOpeningCopy(intro.stakes),
    playerFacingLegacyOpeningCopy(intro.firstPrompt),
  ].filter((line): line is string => Boolean(line));
  const objective = playerFacingLegacyOpeningCopy(intro.objective);
  if (objective || missionBody.length > 0) {
    chapters.push({
      id: "mission",
      kind: "mission",
      label: "Auftrag",
      title: objective ?? "Erste Entscheidung",
      body: missionBody.join("\n\n") || objective || "",
      meta: playerFacingLegacyOpeningCopy(intro.whyHere),
      accent: "blood",
    });
  }

  return chapters;
}

/**
 * Older worldbuilds accidentally persisted prompt directions as player copy.
 * Keep running sessions state-stable while turning those known directives
 * into natural German at the presentation boundary.
 */
export function playerFacingLegacyOpeningCopy(
  value: string | null | undefined,
) {
  let text = clean(value);
  if (!text) return null;

  text = text.replace(
    /^(?:für den auftakt|regie|dm-anweisung|anweisung|kamera)\s*:\s*/iu,
    "",
  );
  const describeAs = text.match(/^beschreibe\s+(.+?)\s+als\s+(.+)$/iu);
  if (describeAs?.[1] && describeAs[2]) {
    text = `${describeAs[1].trim()} zeigt sich als ${describeAs[2].trim()}`;
  } else {
    text = text.replace(/^(?:beschreibe|zeige)\s+/iu, "");
    text = text.replace(/^der dm zeigt\s+/iu, "");
  }

  text = text.replace(
    /,?\s*weil die gruppe soll\s*:?[ ]*([A-ZÄÖÜ])/giu,
    (_match, first: string) => `. Die Gruppe soll ${first.toLowerCase()}`,
  );
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text[0]!.toUpperCase() + text.slice(1);
}

export function introDirectorStorageKey(
  sessionId: string,
  intro: IntroSequenceState,
) {
  const characterKeys = intro.characterIntros
    .map((character) => `${character.characterId}:${character.name}`)
    .join("|");
  const raw = [
    sessionId,
    intro.title,
    intro.establishingShot,
    intro.setupBeats.map((beat) => `${beat.title}:${beat.text}`).join("|"),
    characterKeys,
    intro.objective,
    intro.stakes,
    intro.firstPrompt,
  ].join("\n");

  return `plum:intro-director:${hashString(raw)}`;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hashString(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
