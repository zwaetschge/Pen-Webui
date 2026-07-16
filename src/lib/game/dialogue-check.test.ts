import { describe, expect, it } from "vitest";
import { dialogueCheckOutcome, dialogueSkillModifier } from "./gameplay-api";

describe("server-owned dialogue checks", () => {
  it("resolves criticals before comparing the total with the DC", () => {
    expect(dialogueCheckOutcome(1, 30, 10)).toBe("critical_failure");
    expect(dialogueCheckOutcome(20, 8, 30)).toBe("critical_success");
    expect(dialogueCheckOutcome(12, 15, 15)).toBe("success");
    expect(dialogueCheckOutcome(12, 14, 15)).toBe("failure");
  });

  it("derives trained and expert skill modifiers from the character sheet", () => {
    const sheet = {
      abilities: { cha: 16, str: 8 },
      proficiencyBonus: 3,
      skills: { Persuasion: "proficient", Intimidation: "expert" },
    };
    expect(dialogueSkillModifier(sheet, "persuasion")).toBe(6);
    expect(dialogueSkillModifier(sheet, "Intimidation")).toBe(9);
    expect(dialogueSkillModifier(sheet, "Athletics")).toBe(-1);
  });
});
