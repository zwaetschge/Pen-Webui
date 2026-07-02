import type { ChatLine, VisualDie } from "./store";

export type DiceRollLine = Extract<ChatLine, { kind: "roll" }>;

export type VisibleDice = {
  dice: VisualDie[];
  extraCount: number;
};

export type DieGeometryKind =
  | "d4"
  | "d6"
  | "d8"
  | "d10"
  | "d12"
  | "d20"
  | "generic";

export function latestDiceRoll(chat: ChatLine[]): DiceRollLine | null {
  for (let index = chat.length - 1; index >= 0; index--) {
    const line = chat[index];
    if (line?.kind === "roll") return line;
  }
  return null;
}

export function visibleDiceForRoll(
  roll: DiceRollLine,
  maxDice = 8,
): VisibleDice {
  const dice =
    roll.dice && roll.dice.length > 0
      ? roll.dice
      : [{ sides: sidesFromNotation(roll.notation) ?? 20, value: roll.total }];
  const safeMax = Math.max(1, Math.floor(maxDice));
  return {
    dice: dice.slice(0, safeMax),
    extraCount: Math.max(0, dice.length - safeMax),
  };
}

export function dieGeometryKind(sides: number): DieGeometryKind {
  if (sides === 4) return "d4";
  if (sides === 6) return "d6";
  if (sides === 8) return "d8";
  if (sides === 10 || sides === 100) return "d10";
  if (sides === 12) return "d12";
  if (sides === 20) return "d20";
  return "generic";
}

function sidesFromNotation(notation: string) {
  const match = notation.toLowerCase().match(/d(\d+)/);
  if (!match) return null;
  const sides = Number(match[1]);
  return Number.isFinite(sides) && sides >= 2 ? sides : null;
}
