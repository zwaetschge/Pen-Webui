import { prisma } from "@/lib/db";
import { publishEvent } from "./bus";
import {
  CURRENT_BOOTSTRAP_EVENT_TYPE,
  LEGACY_BOOTSTRAP_EVENT_TYPES,
} from "./events";
import {
  normalizeOpeningBeats,
  openingBeatFromLegacy,
  type OpeningBeat,
} from "./opening-beat";

type JsonRecord = Record<string, unknown>;

export async function ensureSessionBootstrap(sessionId: string) {
  const existing = await prisma.eventLog.findFirst({
    where: { sessionId, type: CURRENT_BOOTSTRAP_EVENT_TYPE },
    select: { id: true },
  });
  if (existing) return false;

  const legacy = await prisma.eventLog.findFirst({
    where: {
      sessionId,
      type: {
        in: LEGACY_BOOTSTRAP_EVENT_TYPES,
      },
    },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  if (legacy) {
    await archiveLegacyBootstrap(sessionId, legacy.ts);
  }

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: {
      campaign: {
        include: {
          world: true,
          scenes: { orderBy: { order: "asc" }, take: 1 },
          locations: {
            include: { backgroundAsset: true, tacticalMapAsset: true },
          },
          npcs: { include: { portraitAsset: true } },
          characters: {
            orderBy: { createdAt: "asc" },
            include: { portraitAsset: true },
          },
        },
      },
    },
  });
  if (!session) return false;

  const opening = session.campaign.scenes[0] ?? null;
  const openingPayload = asRecord(opening?.payload);
  const openingLocationId = stringOrNull(openingPayload.locationId);
  const openingNpcIds = stringArray(openingPayload.presentNpcIds);
  const location =
    session.campaign.locations.find((loc) => loc.id === openingLocationId) ??
    session.campaign.locations[0] ??
    null;
  const locationName = localizeLocationName(location?.name ?? null);
  const locationDescription = localizeLocationDescription(
    location?.description ?? null,
    locationName,
  );
  const presentNpcs = session.campaign.npcs
    .filter((npc) => openingNpcIds.includes(npc.id))
    .slice(0, 6);
  const presentNpcSummaries = presentNpcs.map((npc) => ({
    name: npc.name,
    role: localizeNpcRole(npc.role),
  }));

  if (presentNpcs.length > 0) {
    await prisma.nPC.updateMany({
      where: { id: { in: presentNpcs.map((npc) => npc.id) } },
      data: { visibility: "revealed" },
    });
  }

  const summary = stringOrNull(openingPayload.summary);
  const hook = stringOrNull(openingPayload.hook);
  const introPlan = parseIntroPlan(openingPayload.introPlan);
  const briefCharacters = session.campaign.characters.map((character) => {
    const sheet = asRecord(character.sheet);
    return {
      name: character.name,
      className: stringOrNull(sheet.class),
      background: stringOrNull(sheet.background),
      backstory: stringOrNull(sheet.backstory),
    };
  });
  const characters = session.campaign.characters.map((character) => {
    const sheet = asRecord(character.sheet);
    return {
      id: character.id,
      name: character.name,
      className: stringOrNull(sheet.class),
      race: stringOrNull(sheet.race),
      portraitUrl: character.portraitAsset?.url ?? null,
    };
  });
  const worldFacts = stringArray(session.campaign.world?.worldFacts);
  const threads = stringArray(session.campaign.world?.threads);
  const plot = asRecord(session.campaign.world?.plot);
  const act1 = asRecord(plot.act1);
  const brief = buildOpeningBrief({
    campaignTitle: session.campaign.title,
    theme: session.campaign.theme,
    sceneTitle: opening?.title ?? "Auftakt",
    summary,
    hook,
    locationName,
    locationDescription,
    presentNpcs: presentNpcSummaries,
    characters: briefCharacters,
    threads,
    worldFacts,
    act1Summary: stringOrNull(act1.summary),
    act1Beats: stringArray(act1.beats),
    introPlan,
  });
  const introSequence = buildIntroSequence({
    sceneTitle: opening?.title ?? "Auftakt",
    introPlan,
    brief,
    locationName,
    locationDescription,
    presentNpcNames: presentNpcs.map((npc) => npc.name),
    characters: session.campaign.characters.map((character) => {
      const sheet = asRecord(character.sheet);
      return {
        id: character.id,
        name: character.name,
        className: stringOrNull(sheet.class),
        race: stringOrNull(sheet.race),
        appearance: stringOrNull(sheet.appearance),
        portraitUrl: character.portraitAsset?.url ?? null,
      };
    }),
  });
  const bootstrapPayload = {
    version: 12,
    campaignTitle: session.campaign.title,
    theme: session.campaign.theme,
    sceneTitle: opening?.title ?? "Auftakt",
    summary,
    hook,
    objective: brief.objective,
    whyHere: brief.whyHere,
    stakes: brief.stakes,
    nextActions: brief.nextActions,
    locationId: location?.id ?? null,
    locationName,
    locationDescription,
    backgroundUrl: location?.backgroundAsset?.url ?? null,
    tacticalMapUrl: location?.tacticalMapAsset?.url ?? null,
    gridConfig: location?.gridConfig ?? null,
    presentNpcs: presentNpcs.map((npc) => ({
      id: npc.id,
      name: npc.name,
      role: localizeNpcRole(npc.role),
      portraitUrl: npc.portraitAsset?.url ?? null,
    })),
    characters,
    introSequence,
  };

  await publishEvent(
    sessionId,
    CURRENT_BOOTSTRAP_EVENT_TYPE,
    bootstrapPayload,
  );

  if (location) {
    await publishEvent(sessionId, "scene_set", {
      locationId: location.id,
      locationName,
      locationDescription,
      backgroundUrl: location.backgroundAsset?.url ?? null,
      tacticalMapUrl: location.tacticalMapAsset?.url ?? null,
      gridConfig: location.gridConfig ?? null,
      beat: hook ?? summary,
      summary,
      hook,
      objective: brief.objective,
      whyHere: brief.whyHere,
      stakes: brief.stakes,
      nextActions: brief.nextActions,
      introSequence,
      sceneTitle: opening?.title ?? "Auftakt",
      presentNpcs: bootstrapPayload.presentNpcs,
      characters,
    });
  }

  await publishEvent(sessionId, "intro_sequence", introSequence);

  for (const text of buildIntroNarrationBeats(introSequence)) {
    await publishEvent(sessionId, "narrate", {
      text,
      speakerNpcId: null,
      speakerName: null,
      speakerPortraitUrl: null,
      mood: "mysterious",
    });
  }

  return true;
}

type OpeningIntroPlan = {
  establishingShot: string | null;
  setupBeats: OpeningBeat[];
  characterHookStyle: string | null;
  objective: string | null;
  stakes: string | null;
  firstPrompt: string | null;
};

type CharacterIntroInput = {
  id: string;
  name: string;
  className: string | null;
  race: string | null;
  appearance: string | null;
  portraitUrl: string | null;
};

function parseIntroPlan(value: unknown): OpeningIntroPlan {
  const raw = asRecord(value);
  return {
    establishingShot: stringOrNull(raw.establishingShot),
    setupBeats: normalizeOpeningBeats(raw.setupBeats),
    characterHookStyle: stringOrNull(raw.characterHookStyle),
    objective: stringOrNull(raw.objective),
    stakes: stringOrNull(raw.stakes),
    firstPrompt: stringOrNull(raw.firstPrompt),
  };
}

export function buildIntroSequence(input: {
  sceneTitle: string;
  introPlan: OpeningIntroPlan;
  brief: ReturnType<typeof buildOpeningBrief>;
  locationName: string | null;
  locationDescription: string | null;
  presentNpcNames: string[];
  characters: CharacterIntroInput[];
}) {
  const establishingShot =
    playerFacingGerman(input.introPlan.establishingShot) ??
    fallbackEstablishingShot(input.locationName, input.locationDescription);
  const setupBeats = buildSetupBeats(input);
  const characterIntros = input.characters.map((character) =>
    buildCharacterIntro(character),
  );
  const objective = normalizeSentence(
    playerFacingGerman(input.introPlan.objective) ?? input.brief.objective,
  );
  const stakes = normalizeSentence(
    playerFacingGerman(input.introPlan.stakes) ?? input.brief.stakes,
  );
  const firstPrompt =
    playerFacingGerman(input.introPlan.firstPrompt) ??
    fallbackFirstPrompt(characterIntros.map((intro) => intro.name));

  return {
    title: input.sceneTitle,
    establishingShot,
    setupBeats,
    whyHere: input.brief.whyHere,
    characterHookStyle:
      playerFacingGerman(input.introPlan.characterHookStyle) ??
      "Jede Figur bekommt einen kurzen sichtbaren Auftritt, bevor die Gruppe handelt.",
    characterIntros,
    objective,
    stakes,
    firstPrompt,
    nextActions: input.brief.nextActions,
  };
}

function buildSetupBeats(input: {
  introPlan: OpeningIntroPlan;
  brief: ReturnType<typeof buildOpeningBrief>;
  locationName: string | null;
  locationDescription: string | null;
  presentNpcNames: string[];
}) {
  const planned = input.introPlan.setupBeats
    .flatMap((beat) => {
      const title = playerFacingGerman(beat.title);
      const text = playerFacingGerman(beat.text);
      return title && text ? [{ title, text }] : [];
    })
    .slice(0, 6);
  const npcNames = input.presentNpcNames.slice(0, 3);
  const fallback = [
    input.brief.whyHere,
    input.locationDescription ? firstSentence(input.locationDescription) : null,
    npcNames.length > 0
      ? `${npcNames.join(", ")} ${npcNames.length === 1 ? "ist" : "sind"} bereits in der Nähe, aber noch ist nicht klar, wem ihr trauen könnt.`
      : null,
  ]
    .filter((beat): beat is string => Boolean(beat))
    .flatMap((beat, index) => {
      const normalized = openingBeatFromLegacy(beat, planned.length + index);
      return normalized ? [normalized] : [];
    });
  return [...planned, ...fallback].slice(0, 6);
}

function buildCharacterIntro(character: CharacterIntroInput) {
  const identity = [character.race, character.className]
    .filter(Boolean)
    .join(" ");
  const visibleDetail = playerFacingGerman(character.appearance);
  const summary = identity || "Mitglied der Gruppe";
  const prompt = `${character.name}, beschreibe kurz, was die anderen zuerst an dir bemerken und wo du im Bild stehst.`;
  const text = [
    `${character.name}${identity ? `, ${identity},` : ""} bekommt einen eigenen Moment im Bild.`,
    visibleDetail ? firstSentence(visibleDetail) : null,
    prompt,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    characterId: character.id,
    name: character.name,
    summary,
    prompt,
    text,
    portraitUrl: character.portraitUrl,
  };
}

function buildIntroNarrationBeats(
  input: ReturnType<typeof buildIntroSequence>,
) {
  return [
    input.establishingShot,
    ...input.setupBeats.map((beat) => beat.text),
    ...input.characterIntros.map((intro) => intro.text),
    `Euer erstes Ziel: ${input.objective}`,
    `Der Einsatz: ${input.stakes}`,
    input.firstPrompt,
  ].filter((beat): beat is string => Boolean(beat.trim()));
}

function fallbackEstablishingShot(
  locationName: string | null,
  locationDescription: string | null,
) {
  const location = locationName
    ? `Die Kamera findet euch ${locationPhrase(locationName)}.`
    : "Die Kamera findet euch am Rand des ersten Schauplatzes.";
  const description = locationDescription ? ` ${firstSentence(locationDescription)}` : "";
  return `${location}${description}`.trim();
}

function fallbackFirstPrompt(names: string[]) {
  if (names.length === 0) {
    return "Bevor ihr handelt, stellt die Gruppe kurz vor, was man an euch zuerst sieht.";
  }
  return `Bevor ihr handelt: ${partyLabel(names)}, beschreibt kurz, was die anderen zuerst an euch bemerken.`;
}

function buildOpeningBrief(input: {
  campaignTitle: string;
  theme: string;
  sceneTitle: string;
  summary: string | null;
  hook: string | null;
  locationName: string | null;
  locationDescription: string | null;
  presentNpcs: Array<{ name: string; role: string | null }>;
  characters: Array<{
    name: string;
    className: string | null;
    background: string | null;
    backstory: string | null;
  }>;
  threads: string[];
  worldFacts: string[];
  act1Summary: string | null;
  act1Beats: string[];
  introPlan: OpeningIntroPlan;
}) {
  const partyName = partyLabel(input.characters.map((c) => c.name));
  const location = input.locationName ?? "diesem Ort";
  const plannedObjective = playerFacingGerman(input.introPlan.objective);
  const plannedStakes = playerFacingGerman(input.introPlan.stakes);
  const playerHook = playerFacingGerman(input.hook);
  const playerSummary = playerFacingGerman(input.summary);
  const playerThread = input.threads.map(playerFacingGerman).find(Boolean);
  const playerAct1Beat = input.act1Beats.map(playerFacingGerman).find(Boolean);
  const playerAct1Summary = playerFacingGerman(input.act1Summary);
  const mission =
    plannedObjective ??
    playerHook ??
    playerSummary ??
    playerThread ??
    playerAct1Beat ??
    playerAct1Summary ??
    `der erste Auftrag von ${input.campaignTitle} genau hier beginnt`;
  const objective = normalizeSentence(
    plannedObjective ??
      playerHook ??
      playerThread ??
      playerAct1Beat ??
      `Kläre, warum der Auftakt von ${input.campaignTitle} ausgerechnet ${locationPhrase(
        location,
      )} beginnt.`,
  );
  const whyHere = buildWhyHere({
    partyName,
    characterCount: input.characters.length,
    location,
    mission,
  });
  const stakes = normalizeSentence(
    plannedStakes ??
      playerSummary ??
      playerAct1Summary ??
      input.worldFacts.map(playerFacingGerman).find(Boolean) ??
      `Wenn ihr jetzt untätig bleibt, gewinnt die Gegenseite Zeit und wichtige Spuren gehen verloren.`,
  );
  const firstNpc = input.presentNpcs[0];
  const npcAction = firstNpc
    ? `${firstNpc.name}${firstNpc.role ? ` (${firstNpc.role})` : ""} direkt zu dem Auftrag befragen.`
    : "Die nächsten Zeugen am Ort nach ungewöhnlichen Beobachtungen fragen.";
  const locationAction = input.locationDescription
    ? `${location} nach Spuren, Gefahren und versteckten Details absuchen.`
    : "Die Umgebung nach Spuren, Gefahren und versteckten Details absuchen.";
  const pressureAction =
    input.presentNpcs.length > 1
      ? `Einschätzen, wem von ${input.presentNpcs
          .slice(0, 3)
          .map((npc) => npc.name)
          .join(", ")} ihr zuerst vertraut.`
      : "Eine klare Priorität setzen: reden, untersuchen oder sofort handeln.";

  return {
    objective,
    whyHere,
    stakes,
    nextActions: [npcAction, locationAction, pressureAction],
  };
}

function buildWhyHere(input: {
  partyName: string;
  characterCount: number;
  location: string;
  mission: string;
}) {
  const reason = lowerFirst(stripTerminalPunctuation(input.mission));
  const location = locationPhrase(input.location);
  if (input.characterCount === 0) {
    return `Die Gruppe ist ${location}, weil ${reason}.`;
  }
  if (input.characterCount === 1) {
    return `${input.partyName} ist ${location}, weil ${reason}.`;
  }
  return `${input.partyName} sind ${location}, weil ${reason}.`;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeSentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function stripTerminalPunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/, "");
}

function lowerFirst(value: string) {
  if (!value) return value;
  return value.charAt(0).toLocaleLowerCase("de-DE") + value.slice(1);
}

function firstSentence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/);
  return match ? match[1] : normalizeSentence(trimmed);
}

function playerFacingGerman(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (looksEnglish(trimmed)) return null;
  return trimmed;
}

function localizeLocationName(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  const villageSquare = trimmed.match(/^(.+?)\s+Village Square$/i);
  if (villageSquare) return `Dorfplatz von ${villageSquare[1]}`;
  const townSquare = trimmed.match(/^(.+?)\s+Town Square$/i);
  if (townSquare) return `Marktplatz von ${townSquare[1]}`;
  return trimmed;
}

function localizeLocationDescription(
  value: string | null,
  locationName: string | null,
) {
  const german = playerFacingGerman(value);
  if (german) return german;
  const subject = locationSubject(locationName);
  return `${subject} wirkt angespannt: Spuren, Zeugen und mögliche Gefahren liegen offen vor euch.`;
}

function locationPhrase(location: string) {
  if (/^(Dorfplatz|Marktplatz)\b/.test(location)) return `auf dem ${location}`;
  if (location === "diesem Ort") return "an diesem Ort";
  return `in ${location}`;
}

function locationSubject(locationName: string | null) {
  if (!locationName) return "Der aktuelle Schauplatz";
  if (/^(Dorfplatz|Marktplatz)\b/.test(locationName))
    return `Der ${locationName}`;
  return locationName;
}

function localizeNpcRole(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const englishRole =
    /\b(and|of|the|village|captain|quest|patron|dwarven|prospector|comic|guide|priest|hearth|shrine|innkeeper|rumor|rumour|source|teen|witness|aspiring|adventurer)\b/.test(
      lower,
    );
  const germanRole =
    /\b(und|der|die|das|dorf|hauptmann|hauptfrau|wirt|priester|zeuge|zeugin|fuehrer|führer|auftraggeber)\b/.test(
      lower,
    );
  if (englishRole && !germanRole) return null;
  return playerFacingGerman(trimmed);
}

function looksEnglish(value: string) {
  const lower = value.toLowerCase();
  const englishHits =
    lower.match(
      /\b(a|an|the|and|you|your|of|to|in|after|before|with|for|from|as|by|but|if|old|village|square|urgent|summons|mysterious|investigate|rumors|rumours|missing|strange|ancient|quest|town|mayor|merchant|guard|belonging|identifies|sealed|cave|decades|dwarf|prospector|mine|key|hold|party|raiders|recover|supplies|stop|stirring|lawful|salvage)\b/g,
    ) ?? [];
  const germanHits =
    lower.match(
      /\b(der|die|das|und|du|ihr|euer|eine|einen|einem|weil|dass|nicht|auftrag|dorf|platz|spuren|gefahr|geheimnis|finden|klären)\b/g,
    ) ?? [];
  return (
    englishHits.length > 0 &&
    germanHits.length === 0 &&
    value.trim().split(/\s+/).length > 4
  );
}

function partyLabel(names: string[]) {
  const visible = names.filter(Boolean);
  if (visible.length === 0) return "Die Gruppe";
  if (visible.length === 1) return visible[0];
  if (visible.length === 2) return `${visible[0]} und ${visible[1]}`;
  return `${visible.slice(0, -1).join(", ")} und ${visible.at(-1)}`;
}

async function archiveLegacyBootstrap(sessionId: string, ts: Date) {
  await prisma.eventLog.updateMany({
    where: {
      sessionId,
      type: {
        in: [...LEGACY_BOOTSTRAP_EVENT_TYPES, "scene_set", "narrate"],
      },
      ts: {
        gte: ts,
        lte: new Date(ts.getTime() + 2_000),
      },
    },
    data: { type: "archived" },
  });
}
