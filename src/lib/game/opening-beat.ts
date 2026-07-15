export type OpeningBeat = { title: string; text: string };

export function normalizeOpeningBeats(
  value: unknown,
  limit = 6,
): OpeningBeat[] {
  if (!Array.isArray(value)) return [];
  const beats: OpeningBeat[] = [];
  for (const [index, item] of value.entries()) {
    const beat =
      typeof item === "string"
        ? openingBeatFromLegacy(item, index)
        : openingBeatFromObject(item);
    if (beat) beats.push(beat);
    if (beats.length >= limit) break;
  }
  return beats;
}

export function openingBeatFromLegacy(
  value: string,
  index: number,
): OpeningBeat | null {
  const text = clean(value);
  if (!text) return null;
  return { title: legacyHeadline(text, index), text };
}

function openingBeatFromObject(value: unknown): OpeningBeat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? clean(record.title) : null;
  const text = typeof record.text === "string" ? clean(record.text) : null;
  return title && text ? { title, text } : null;
}

const FALLBACK_HEADLINES = [
  "Die ersten Zeichen",
  "Eine neue Spur",
  "Die Lage verändert sich",
  "Ein unerwarteter Moment",
  "Die Entscheidung rückt näher",
  "Der nächste Schritt",
] as const;

function legacyHeadline(text: string, index: number) {
  const sentence = text.split(/[.!?]/u)[0]?.trim() ?? text;
  const inverted = sentence.match(
    /^(?:Im|Am|In|An|Bei|Unter|Vor|Hinter)\b[^,.]{1,90}?\b(?:mustert|beobachtet|empfängt|warnt|begrüßt|fordert)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+){1,2})\b/u,
  );
  if (inverted?.[1]) return `Begegnung mit ${inverted[1]}`;
  const direct = sentence.match(
    /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+){1,2})\s+(?:mustert|beobachtet|empfängt|warnt|begrüßt|fordert)\b/u,
  );
  if (direct?.[1]) return `Begegnung mit ${direct[1]}`;
  const arrival = sentence.match(
    /\bkommt\b.*?\b(am|im|in der|in dem|in den|in|bei|an der|an dem|an den)\s+([A-ZÄÖÜ][^,.]{1,36}?)\s+an\b/u,
  );
  if (arrival?.[1] && arrival[2])
    return `Ankunft ${arrival[1]} ${arrival[2].trim()}`;
  return FALLBACK_HEADLINES[index] ?? `Moment ${index + 1}`;
}

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ") || null;
}
