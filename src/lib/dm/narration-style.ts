export type NarrationStyleIssue = {
  code: string;
  detail: string;
};

type StylePattern = {
  code: string;
  pattern: RegExp;
  detail: string;
};

const FORBIDDEN_PATTERNS: StylePattern[] = [
  {
    code: "made_up_harbor_slang",
    pattern: /\bdockratten\b/,
    detail: "made-up harbor slang like 'Dockratten'",
  },
  {
    code: "literal_english_calque",
    pattern: /\bfuer mich sichtbar gehen\b|\bfür mich sichtbar gehen\b|\bsichtbar gehen\b/,
    detail: "literal translated phrasing like 'fuer mich sichtbar gehen'",
  },
  {
    code: "literal_english_calque",
    pattern: /\bdu gehst leise, ohne meinen namen\b|\bdu gehst leise ohne meinen namen\b/,
    detail: "literal translated phrasing like 'du gehst leise'",
  },
  {
    code: "awkward_idiom",
    pattern: /\bunter der hand geben kann\b/,
    detail: "awkward idiom reuse like 'unter der Hand geben kann'",
  },
  {
    code: "malformed_compound",
    pattern: /\bhafenmeister[- ]deckung\b/,
    detail: "malformed fantasy compound like 'Hafenmeister-Deckung'",
  },
];

export function assessNarrationStyle(text: string): NarrationStyleIssue[] {
  const folded = foldGerman(text);
  const seen = new Set<string>();
  const issues: NarrationStyleIssue[] = [];

  for (const item of FORBIDDEN_PATTERNS) {
    if (!item.pattern.test(folded)) continue;
    const key = `${item.code}:${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ code: item.code, detail: item.detail });
  }

  return issues;
}

export function narrationStyleRejection(text: string): string | null {
  const issues = assessNarrationStyle(text);
  if (issues.length === 0) return null;

  return [
    "Narration rejected: German style contract violation.",
    "Detected: " + issues.map((issue) => issue.detail).join("; ") + ".",
    "Rewrite the same content in idiomatic contemporary Standard German.",
    "Do not invent dialects, pseudo-regional slang, made-up harbor slang, malformed fantasy compounds, or literal English calques.",
    "Call narrate again with corrected text.",
  ].join(" ");
}

function foldGerman(value: string) {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}
