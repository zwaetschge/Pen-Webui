/**
 * Minimal D&D 5e character-sheet defaults — populated on character creation,
 * edited via the in-game sheet drawer.
 */

export type CharacterSheet = {
  level: number;
  class: string;
  race: string;
  background: string;
  alignment: string;
  abilities: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  };
  proficiencyBonus: number;
  hpMax: number;
  hpCurrent: number;
  hpTemp: number;
  ac: number;
  speed: number;
  initiative: number;
  passivePerception: number;
  skills: Record<string, "proficient" | "expert" | "none">;
  savingThrows: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", boolean>;
  inventory: Array<{ name: string; qty: number; notes?: string }>;
  spells: Array<{ name: string; level: number; prepared: boolean }>;
  features: Array<{ name: string; source: string; description: string }>;
  notes: string;
  appearance: string;
  backstory: string;
  imagePrompt?: string;
};

export const SKILL_LIST = [
  "Acrobatics",
  "Animal Handling",
  "Arcana",
  "Athletics",
  "Deception",
  "History",
  "Insight",
  "Intimidation",
  "Investigation",
  "Medicine",
  "Nature",
  "Perception",
  "Performance",
  "Persuasion",
  "Religion",
  "Sleight of Hand",
  "Stealth",
  "Survival",
] as const;

export function blankSheet(): CharacterSheet {
  const skills: CharacterSheet["skills"] = {};
  for (const s of SKILL_LIST) skills[s] = "none";
  return {
    level: 1,
    class: "Fighter",
    race: "Human",
    background: "Folk Hero",
    alignment: "Neutral Good",
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    hpMax: 10,
    hpCurrent: 10,
    hpTemp: 0,
    ac: 10,
    speed: 30,
    initiative: 0,
    passivePerception: 10,
    skills,
    savingThrows: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    inventory: [],
    spells: [],
    features: [],
    notes: "",
    appearance: "",
    backstory: "",
  };
}

export function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}
