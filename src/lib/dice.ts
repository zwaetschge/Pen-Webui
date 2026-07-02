/**
 * Dice notation parser + roller.
 *
 * Supported grammar (subset of common DnD usage):
 *
 *    expr     := term ((+|-) term)*
 *    term     := dice | modifier
 *    dice     := <count>? "d" <sides> [<dropKeep>] [<advantage>]
 *    dropKeep := "kh"<n> | "kl"<n> | "dh"<n> | "dl"<n>      (keep/drop high/low)
 *    advantage:= "adv" | "dis"                              (sugar over 2d20kh1/kl1)
 *    modifier := <int>
 *
 * Examples: "2d6+3", "1d20+5", "1d20adv", "4d6dl1", "d8"
 */

const MAX_DICE_PER_GROUP = 200;
const MAX_SIDES = 1000;

export type DieRoll = { die: number; value: number; dropped?: boolean };

export type DiceResult = {
  notation: string;
  total: number;
  rolls: DieRoll[];
  breakdown: string;
  groups: Array<{
    count: number;
    sides: number;
    rolls: DieRoll[];
    kept: number[];
    sum: number;
    sign: 1 | -1;
  }>;
  modifierSum: number;
};

type RNG = () => number;
const defaultRNG: RNG = Math.random;

export function rollDice(notation: string, rng: RNG = defaultRNG): DiceResult {
  const n = notation.replace(/\s+/g, "").toLowerCase();
  if (!n) throw new Error("empty dice notation");

  // Split on + / - while keeping the operators.
  const tokens = n.split(/(?=[+-])/);
  let total = 0;
  const allRolls: DieRoll[] = [];
  const groups: DiceResult["groups"] = [];
  const segments: string[] = [];
  let modifierSum = 0;

  for (const raw of tokens) {
    const tok = raw.startsWith("+") || raw.startsWith("-") ? raw : "+" + raw;
    const sign: 1 | -1 = tok.startsWith("-") ? -1 : 1;
    const body = tok.slice(1);
    if (!body) continue;

    // pure integer
    if (/^\d+$/.test(body)) {
      const v = Number(body) * sign;
      total += v;
      modifierSum += v;
      segments.push(sign === 1 ? `+${body}` : `-${body}`);
      continue;
    }

    const m = body.match(
      /^(\d*)d(\d+)(?:(kh|kl|dh|dl)(\d+))?(adv|dis)?$/,
    );
    if (!m) throw new Error(`bad dice token: ${raw}`);

    let count = m[1] ? Number(m[1]) : 1;
    const sides = Number(m[2]);
    const kdMode = m[3] as "kh" | "kl" | "dh" | "dl" | undefined;
    const kdN = m[4] ? Number(m[4]) : undefined;
    const adv = m[5];

    if (sides < 2) throw new Error(`die sides must be ≥ 2 (${raw})`);
    if (sides > MAX_SIDES) throw new Error(`die sides too large (${raw})`);

    let mode = kdMode;
    let modeN = kdN;
    if (adv) {
      count = 2;
      mode = adv === "adv" ? "kh" : "kl";
      modeN = 1;
    }
    if (count < 1) throw new Error(`die count must be ≥ 1 (${raw})`);
    if (count > MAX_DICE_PER_GROUP) {
      throw new Error(`too many dice in one group (${raw})`);
    }

    const rolls: DieRoll[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push({ die: sides, value: 1 + Math.floor(rng() * sides) });
    }

    let kept = rolls.map((r) => r.value);
    if (mode && modeN) {
      const sorted = [...rolls].sort((a, b) => a.value - b.value);
      const drop = new Set<number>();
      if (mode === "kh") {
        for (let i = 0; i < rolls.length - modeN; i++)
          drop.add(rolls.indexOf(sorted[i]));
      } else if (mode === "kl") {
        for (let i = rolls.length - 1; i >= modeN; i--)
          drop.add(rolls.indexOf(sorted[i]));
      } else if (mode === "dh") {
        for (let i = rolls.length - 1; i >= rolls.length - modeN; i--)
          drop.add(rolls.indexOf(sorted[i]));
      } else if (mode === "dl") {
        for (let i = 0; i < modeN; i++) drop.add(rolls.indexOf(sorted[i]));
      }
      rolls.forEach((r, i) => {
        if (drop.has(i)) r.dropped = true;
      });
      kept = rolls.filter((r) => !r.dropped).map((r) => r.value);
    }

    const sum = kept.reduce((a, b) => a + b, 0) * sign;
    total += sum;
    allRolls.push(...rolls);
    groups.push({ count, sides, rolls, kept, sum: sum * sign, sign });

    const breakdownPart =
      `${count}d${sides}` +
      (mode ? `${mode}${modeN ?? ""}` : "") +
      `[${rolls.map((r) => (r.dropped ? `~~${r.value}~~` : r.value)).join(",")}]`;
    segments.push((sign === 1 ? "+" : "-") + breakdownPart);
  }

  const breakdown = segments.join(" ").replace(/^\+/, "").trim();
  return {
    notation,
    total,
    rolls: allRolls,
    breakdown,
    groups,
    modifierSum,
  };
}

export function isValidNotation(notation: string): boolean {
  try {
    rollDice(notation);
    return true;
  } catch {
    return false;
  }
}
