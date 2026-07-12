import { describe, expect, it } from "vitest";
import { companionHitPoints } from "./CompanionOverview";

describe("companionHitPoints", () => {
  it("uses the character sheet while exploration is active", () => {
    expect(
      companionHitPoints({
        combatActive: false,
        sheet: { current: 9, max: 12 },
        token: { current: 4, max: 12 },
      }),
    ).toEqual({ current: 9, max: 12 });
  });

  it("uses the live combat token while combat is active", () => {
    expect(
      companionHitPoints({
        combatActive: true,
        sheet: { current: 9, max: 12 },
        token: { current: 4, max: 12 },
      }),
    ).toEqual({ current: 4, max: 12 });
  });

  it("falls back safely when the live token has incomplete values", () => {
    expect(
      companionHitPoints({
        combatActive: true,
        sheet: { current: 7.9, max: 0 },
        token: { current: undefined, max: undefined },
      }),
    ).toEqual({ current: 7, max: 1 });
  });
});
