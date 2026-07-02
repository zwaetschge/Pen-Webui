import { describe, it, expect } from "vitest";
import { rollDice, isValidNotation } from "../dice";

// deterministic RNG: returns the i-th value in the cycle each time it's called
const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("rollDice", () => {
  it("rolls a fixed d20+5", () => {
    const r = rollDice("1d20+5", seq([0.5])); // 0.5 → floor(0.5*20)+1 = 11
    expect(r.total).toBe(16);
    expect(r.rolls).toHaveLength(1);
  });

  it("handles 2d6+3", () => {
    const r = rollDice("2d6+3", seq([0, 0.99]));
    // 1 + 6 + 3 = 10
    expect(r.total).toBe(10);
  });

  it("supports advantage (2d20kh1)", () => {
    const r = rollDice("1d20adv", seq([0.1, 0.95]));
    // 3, 20 → keep high = 20
    expect(r.total).toBe(20);
    expect(r.rolls.filter((x) => !x.dropped)).toHaveLength(1);
  });

  it("supports disadvantage", () => {
    const r = rollDice("1d20dis", seq([0.1, 0.95]));
    expect(r.total).toBe(3);
  });

  it("supports 4d6 drop lowest (ability scores)", () => {
    const r = rollDice("4d6dl1", seq([0, 0.5, 0.5, 0.5]));
    // 1, 4, 4, 4 → drop the 1 → 12
    expect(r.total).toBe(12);
  });

  it("supports negative modifiers", () => {
    const r = rollDice("1d8-2", seq([0]));
    expect(r.total).toBe(-1);
  });

  it("rejects too many dice", () => {
    expect(() => rollDice("999d6")).toThrow();
  });

  it("rejects nonsense", () => {
    expect(isValidNotation("nonsense")).toBe(false);
    expect(isValidNotation("1d20+abc")).toBe(false);
  });

  it("accepts 'd20' shorthand", () => {
    const r = rollDice("d20", seq([0.5]));
    expect(r.total).toBe(11);
  });
});
