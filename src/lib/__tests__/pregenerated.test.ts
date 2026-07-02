import { describe, expect, it } from "vitest";
import { findPregenAsset } from "../asset/pregen-catalog";

describe("pregenerated asset catalog", () => {
  it("matches common SRD monster names", () => {
    const hit = findPregenAsset("monster_token", { name: "Goblin ambusher" });
    expect(hit?.slug).toBe("goblin");
  });

  it("matches NPC roles to archetype portraits", () => {
    const hit = findPregenAsset("npc_portrait", {
      role: "friendly tavern innkeeper",
    });
    expect(hit?.slug).toBe("innkeeper");
  });

  it("prefers specific dragon variants", () => {
    const hit = findPregenAsset("monster_token", {
      name: "Young Red Dragon",
    });
    expect(hit?.slug).toBe("young-red-dragon");
  });

  it("can skip already-used static variants", () => {
    const hit = findPregenAsset("npc_portrait", {
      role: "guard captain",
      excludeSlugs: ["guard"],
    });
    expect(hit?.slug).toBe("captain");
  });

  it("does not match NPCs from weak personality or setting overlap", () => {
    expect(
      findPregenAsset("npc_portrait", {
        name: "Chief Gribnock Cracked-Moon",
        role: "Leader of the goblin raiders",
        description:
          "Blustery, insecure, clever enough to know he is in trouble.",
      }),
    ).toBeNull();
    expect(
      findPregenAsset("npc_portrait", {
        name: "Elowen Thatch",
        role: "Mayor of Brindleford",
        description:
          "Practical, brave under pressure, quietly terrified of failing her people.",
      }),
    ).toBeNull();
    expect(
      findPregenAsset("npc_portrait", {
        name: "Thane Huldra Shieldvein",
        role: "Undead dwarven guardian spirit",
      }),
    ).toBeNull();
  });
});
