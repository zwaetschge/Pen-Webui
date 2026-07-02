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

  const establishingShot = clean(intro.establishingShot);
  if (establishingShot) {
    chapters.push({
      id: "establishing",
      kind: "establishing",
      label: "Totale",
      title: clean(scene.locationName) ?? sceneTitle,
      body: establishingShot,
      meta: clean(intro.whyHere),
      accent: "brass",
    });
  }

  intro.setupBeats
    .map(clean)
    .filter((beat): beat is string => Boolean(beat))
    .slice(0, 6)
    .forEach((beat, index) => {
      chapters.push({
        id: `beat-${index + 1}`,
        kind: "beat",
        label: `Auftakt ${index + 1}`,
        title: headlineFromText(beat, sceneTitle),
        body: beat,
        accent: index % 2 === 0 ? "arcane" : "brass",
      });
    });

  intro.characterIntros.forEach((character, index) => {
    const body =
      clean(character.text) ??
      clean(character.prompt) ??
      clean(character.summary) ??
      null;
    if (!body) return;

    chapters.push({
      id: `character-${character.characterId}`,
      kind: "character",
      label: "Auftritt",
      title: character.name,
      body,
      meta: clean(character.summary),
      portraitUrl: clean(character.portraitUrl),
      accent: index % 2 === 0 ? "brass" : "arcane",
    });
  });

  const missionBody = [
    clean(intro.stakes),
    clean(intro.firstPrompt),
  ].filter((line): line is string => Boolean(line));
  const objective = clean(intro.objective);
  if (objective || missionBody.length > 0) {
    chapters.push({
      id: "mission",
      kind: "mission",
      label: "Einsatz",
      title: objective ?? "Erste Entscheidung",
      body: missionBody.join("\n\n") || objective || "",
      meta: clean(intro.whyHere),
      accent: "blood",
    });
  }

  return chapters;
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
    intro.setupBeats.join("|"),
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

function headlineFromText(text: string, fallback: string) {
  const firstSentence = text.split(/[.!?]/)[0]?.trim();
  if (!firstSentence) return fallback;
  const arrival = arrivalHeadline(firstSentence);
  if (arrival) return arrival;
  const encounter = encounterHeadline(firstSentence);
  if (encounter) return encounter;

  const compact = firstSentence.replace(/^die figur\s+/i, "").trim();
  if (compact.length <= 36) return compact;
  return `${compact.slice(0, 33).trimEnd()}...`;
}

function arrivalHeadline(sentence: string) {
  const match = sentence.match(
    /\bkommt\b.*?\b(am|im|in der|in dem|in den|in|bei der|bei dem|bei den|bei|an der|an dem|an den)\s+([A-ZÄÖÜ][^,.]{1,36}?)\s+an\b/u,
  );
  if (!match) return null;

  const preposition = match[1];
  const location = match[2]?.replace(/\s+/g, " ").trim();
  if (!preposition || !location) return null;
  return `Ankunft ${preposition} ${location}`;
}

function encounterHeadline(sentence: string) {
  const match = sentence.match(
    /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+){0,2})\s+(empfängt|wartet|warnt|fordert|begrüßt|beobachtet|mustert|zeigt|reicht|flüstert)\b/u,
  );
  const name = match?.[1]?.trim();
  if (!name || !name.includes(" ")) return null;
  return `Begegnung mit ${name}`;
}

function hashString(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
