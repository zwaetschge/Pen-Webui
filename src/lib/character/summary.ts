export function companionSummary(value: unknown) {
  const sheet = record(value);
  return {
    level: wholeNumber(sheet.level, 1, 1),
    className: text(sheet.class, "Abenteurer"),
    race: text(sheet.race, "Unbekannt"),
    hpCurrent: wholeNumber(sheet.hpCurrent, 0, 0),
    hpMax: wholeNumber(sheet.hpMax, 1, 1),
    hpTemp: wholeNumber(sheet.hpTemp, 0, 0),
    ac: wholeNumber(sheet.ac, 10, 0),
    speed: wholeNumber(sheet.speed, 30, 0),
    passivePerception: wholeNumber(sheet.passivePerception, 10, 0),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function wholeNumber(value: unknown, fallback: number, minimum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.floor(value))
    : fallback;
}
