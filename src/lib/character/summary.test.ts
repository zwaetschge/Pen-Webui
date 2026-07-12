import { describe, expect, it } from "vitest";
import { companionSummary } from "./summary";

describe("companionSummary", () => {
  it("returns safe tabletop defaults for an invalid Prisma JSON sheet", () => {
    expect(companionSummary(null)).toEqual({
      level: 1,
      className: "Abenteurer",
      race: "Unbekannt",
      hpCurrent: 0,
      hpMax: 1,
      hpTemp: 0,
      ac: 10,
      speed: 30,
      passivePerception: 10,
    });
    expect(companionSummary(["not", "a", "sheet"])).toEqual(
      companionSummary(null),
    );
  });

  it("trims labels and normalizes finite numeric resources", () => {
    expect(
      companionSummary({
        level: 4.9,
        class: "  Waldlaeufer  ",
        race: "  Elf  ",
        hpCurrent: -4,
        hpMax: 27.8,
        hpTemp: 3.7,
        ac: 15.9,
        speed: 35.5,
        passivePerception: 14.8,
      }),
    ).toEqual({
      level: 4,
      className: "Waldlaeufer",
      race: "Elf",
      hpCurrent: 0,
      hpMax: 27,
      hpTemp: 3,
      ac: 15,
      speed: 35,
      passivePerception: 14,
    });
  });

  it("does not pass non-finite or wrongly typed values to the client", () => {
    expect(
      companionSummary({
        level: Number.NaN,
        class: 42,
        race: "   ",
        hpCurrent: "12",
        hpMax: Number.POSITIVE_INFINITY,
        ac: -5,
      }),
    ).toMatchObject({
      level: 1,
      className: "Abenteurer",
      race: "Unbekannt",
      hpCurrent: 0,
      hpMax: 1,
      ac: 0,
    });
  });
});
