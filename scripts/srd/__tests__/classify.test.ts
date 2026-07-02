import { describe, it, expect } from "vitest";
import { classify, slugify } from "../classify";

describe("classify(path)", () => {
  it("recognises spells", () => {
    expect(classify("Spellcasting/Spells/fireball.md")).toBe("spell");
    expect(classify("spells/cure-wounds.md")).toBe("spell");
    expect(classify("07_Spells/Spells_Each/Fireball.md")).toBe("spell");
  });
  it("recognises monsters", () => {
    expect(classify("Monsters/Owlbear.md")).toBe("monster");
    expect(classify("bestiary/aboleth.md")).toBe("monster");
    expect(classify("10_Monsters/Monsters_Each/Owlbear.md")).toBe("monster");
  });
  it("recognises items", () => {
    expect(classify("Magic Items/bag-of-holding.md")).toBe("item");
    expect(classify("equipment/longsword.md")).toBe("item");
    expect(classify("09_Magic_Items/Magic_Items_Each/Bag_of_Holding.md")).toBe("item");
  });
  it("recognises numbered class and race sections", () => {
    expect(classify("01_Races/Races_Each/Elf.md")).toBe("race");
    expect(classify("02_Classes/Wizard.md")).toBe("class");
  });
  it("recognises rules as fallback", () => {
    expect(classify("Rules/Combat/initiative.md")).toBe("rule");
    expect(classify("about-the-srd.md")).toBe("rule");
  });
  it("recognises conditions", () => {
    expect(classify("Conditions/prone.md")).toBe("condition");
  });
});

describe("slugify", () => {
  it("lowercases and dasherises", () => {
    expect(slugify("Bag of Holding")).toBe("bag-of-holding");
  });
  it("strips smart quotes", () => {
    expect(slugify("Heward’s Handy Spice Pouch")).toBe("hewards-handy-spice-pouch");
  });
  it("trims trailing dashes", () => {
    expect(slugify("...Hello!!!")).toBe("hello");
  });
});
