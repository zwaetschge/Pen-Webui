# Structured Opening Beats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace prose-derived, truncated intro headings with explicit short titles and natural narration while replaying legacy campaigns safely.

**Architecture:** Introduce a pure `OpeningBeat` normalization boundary shared by server bootstrap and client event replay. New worldbuild output uses `{ title, text }` objects; legacy string payloads are upgraded at read time and never rewritten in place.

**Tech Stack:** TypeScript, Zod, Next.js 15, Zustand, Vitest

## Global Constraints

- No additional model call at session startup.
- Existing Scene/EventLog JSON containing `string[]` remains readable.
- Player-facing text remains German and does not decide actions for player characters.
- Unknown legacy prose never becomes a cut-off headline with an ellipsis.
- Tests run through the repository-pinned Vitest binary.

---

### Task 1: Opening-beat normalization boundary

**Files:**
- Create: `src/lib/game/opening-beat.ts`
- Create: `src/lib/game/opening-beat.test.ts`

**Interfaces:**
- Produces: `OpeningBeat = { title: string; text: string }`
- Produces: `normalizeOpeningBeats(value: unknown, limit?: number): OpeningBeat[]`
- Produces: `openingBeatFromLegacy(text: string, index: number): OpeningBeat | null`

- [ ] **Step 1: Write failing normalization and headline tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeOpeningBeats, openingBeatFromLegacy } from "./opening-beat";

describe("opening beats", () => {
  it("preserves explicit titles separately from narration", () => {
    expect(normalizeOpeningBeats([
      { title: "Blicke im Diner", text: "Elinor mustert die Fremden." },
    ])).toEqual([
      { title: "Blicke im Diner", text: "Elinor mustert die Fremden." },
    ]);
  });

  it("finds the acting NPC after an inverted location phrase", () => {
    expect(openingBeatFromLegacy(
      "Im Diner Zur Grauen Wolldecke mustert Elinor Hale die Fremden.",
      0,
    )).toMatchObject({ title: "Begegnung mit Elinor Hale" });
  });

  it("uses a complete neutral title for unknown legacy prose", () => {
    const beat = openingBeatFromLegacy(
      "Hinter den regennassen Fenstern verändert sich etwas Unbestimmtes.",
      2,
    );
    expect(beat?.title).toBe("Ein neuer Moment");
    expect(beat?.title).not.toContain("...");
  });

  it("drops malformed and blank entries and respects the limit", () => {
    expect(normalizeOpeningBeats([
      "  ", { title: "", text: "x" }, "Eins.", "Zwei.",
    ], 1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `./node_modules/.bin/vitest run src/lib/game/opening-beat.test.ts`

Expected: FAIL because `src/lib/game/opening-beat.ts` does not exist.

- [ ] **Step 3: Implement the pure normalizer**

```ts
export type OpeningBeat = { title: string; text: string };

export function normalizeOpeningBeats(value: unknown, limit = 6): OpeningBeat[] {
  if (!Array.isArray(value)) return [];
  const beats: OpeningBeat[] = [];
  for (const [index, item] of value.entries()) {
    const beat = typeof item === "string"
      ? openingBeatFromLegacy(item, index)
      : openingBeatFromObject(item);
    if (beat) beats.push(beat);
    if (beats.length >= limit) break;
  }
  return beats;
}

export function openingBeatFromLegacy(value: string, index: number): OpeningBeat | null {
  const text = clean(value);
  if (!text) return null;
  return { title: legacyHeadline(text, index), text };
}

function openingBeatFromObject(value: unknown): OpeningBeat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? clean(record.title) : null;
  const text = typeof record.text === "string" ? clean(record.text) : null;
  return title && text ? { title, text } : null;
}

function legacyHeadline(text: string, _index: number) {
  const sentence = text.split(/[.!?]/u)[0]?.trim() ?? text;
  const inverted = sentence.match(
    /^(?:Im|Am|In|An|Bei|Unter|Vor|Hinter)\b[^,.]{1,90}?\b(?:mustert|beobachtet|empfängt|warnt|begrüßt|fordert)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+){1,2})\b/u,
  );
  if (inverted?.[1]) return `Begegnung mit ${inverted[1]}`;
  const direct = sentence.match(
    /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+){1,2})\s+(?:mustert|beobachtet|empfängt|warnt|begrüßt|fordert)\b/u,
  );
  if (direct?.[1]) return `Begegnung mit ${direct[1]}`;
  const arrival = sentence.match(
    /\bkommt\b.*?\b(am|im|in der|in dem|in den|in|bei|an der|an dem|an den)\s+([A-ZÄÖÜ][^,.]{1,36}?)\s+an\b/u,
  );
  if (arrival?.[1] && arrival[2]) return `Ankunft ${arrival[1]} ${arrival[2].trim()}`;
  return "Ein neuer Moment";
}

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ") || null;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `./node_modules/.bin/vitest run src/lib/game/opening-beat.test.ts`

Expected: 4 tests pass.

- [ ] **Step 5: Commit the boundary**

```bash
git add src/lib/game/opening-beat.ts src/lib/game/opening-beat.test.ts
git commit -m "feat: normalize structured opening beats"
```

---

### Task 2: Generate structured beats at the source

**Files:**
- Modify: `src/lib/dm/prompts.ts`
- Modify: `src/lib/dm/prompts.test.ts`
- Modify: `src/lib/dm/worldbuild.ts`
- Modify: `src/lib/dm/worldbuild.test.ts`
- Modify: `src/lib/dm/worldbuild-output-schema.ts`
- Modify: `src/lib/__tests__/worldbuild-output-schema.test.ts`
- Modify: `src/app/api/dm/worldbuild/route.test.ts`

**Interfaces:**
- Consumes: `OpeningBeat` structural shape `{ title: string; text: string }`
- Produces: `Blueprint["openingScene"]["introPlan"]["setupBeats"]` as structured objects

- [ ] **Step 1: Change test fixtures and add prompt/schema assertions first**

Use this shape in every blueprint fixture:

```ts
setupBeats: [
  { title: "Ankunft im Regen", text: "Regen zeichnet helle Spuren auf die Scheiben." },
  { title: "Blicke am Tresen", text: "Elinor Hale mustert die Neuankömmlinge." },
  { title: "Die erste Wahl", text: "Vor der Hintertür fällt ein schwerer Gegenstand zu Boden." },
],
```

Add prompt and rejection assertions:

```ts
expect(WORLDBUILD_PROMPT).toContain(
  '"setupBeats": [ { "title": string, "text": string } ]',
);
expect(WORLDBUILD_PROMPT).toContain("observable action");
expect(WORLDBUILD_PROMPT).toContain(
  "must not assign thoughts, decisions, dialogue, or actions to player characters",
);
expect(() => blueprintSchema.parse({
  ...validBlueprint,
  openingScene: {
    ...validBlueprint.openingScene,
    introPlan: {
      ...validBlueprint.openingScene.introPlan,
      setupBeats: [{ text: "Kein Titel." }],
    },
  },
})).toThrow();
```

- [ ] **Step 2: Run affected worldbuild tests and verify RED**

Run:

```bash
./node_modules/.bin/vitest run src/lib/dm/prompts.test.ts src/lib/dm/worldbuild.test.ts src/lib/__tests__/worldbuild-output-schema.test.ts src/app/api/dm/worldbuild/route.test.ts
```

Expected: FAIL because the production schema and prompt still require strings.

- [ ] **Step 3: Update prompt, Zod schema, and output schema**

Replace the prompt shape and constraints with:

```text
"setupBeats": [ { "title": string, "text": string } ],

- introPlan.setupBeats must contain 3-6 chronological beats. Each title is a
  natural 2-5 word German display heading. Each text is 1-2 idiomatic German
  present-tense sentences describing observable action.
- Beat text must not use meta-language and must not assign thoughts,
  decisions, dialogue, or actions to player characters.
```

Use this Zod shape:

```ts
setupBeats: z.array(z.object({
  title: z.string().trim().min(2).max(80),
  text: z.string().trim().min(8).max(600),
})).min(3).max(6),
```

In `WORLDBUILD_OUTPUT_SCHEMA`, make each item an object with
`additionalProperties: false`, string properties `title` and `text`, and both
fields in `required`.

- [ ] **Step 4: Run the affected tests and verify GREEN**

Run the command from Step 2.

Expected: all selected suites pass.

- [ ] **Step 5: Commit structured worldbuild output**

```bash
git add src/lib/dm/prompts.ts src/lib/dm/prompts.test.ts src/lib/dm/worldbuild.ts src/lib/dm/worldbuild.test.ts src/lib/dm/worldbuild-output-schema.ts src/lib/__tests__/worldbuild-output-schema.test.ts src/app/api/dm/worldbuild/route.test.ts
git commit -m "feat: generate titled opening beats"
```

---

### Task 3: Normalize bootstrap, replay, and cinematic rendering

**Files:**
- Modify: `src/lib/game/bootstrap.ts`
- Modify: `src/lib/game/bootstrap.test.ts`
- Modify: `src/lib/game/store.ts`
- Modify: `src/lib/game/store.test.ts`
- Modify: `src/lib/game/intro-director.ts`
- Modify: `src/lib/game/intro-director.test.ts`
- Modify: `src/components/game/IntroDirector.tsx`
- Modify: `src/components/game/SceneBrief.tsx`

**Interfaces:**
- Consumes: `normalizeOpeningBeats(value)` and `OpeningBeat`
- Produces: `IntroSequenceState.setupBeats: OpeningBeat[]`
- Preserves: legacy `session_bootstrap_v11` and string-beat event replay

- [ ] **Step 1: Add failing compatibility and presentation tests**

In `bootstrap.test.ts`, cover explicit fields:

```ts
expect(buildIntroSequence({
  ...baseInput,
  introPlan: {
    ...baseInput.introPlan,
    setupBeats: [
      { title: "Blicke im Diner", text: "Elinor Hale mustert die Fremden." },
    ],
  },
}).setupBeats).toEqual([
  { title: "Blicke im Diner", text: "Elinor Hale mustert die Fremden." },
]);
```

In `store.test.ts`, ingest one legacy string event and one structured event and
assert both become `OpeningBeat[]`. In `intro-director.test.ts`, assert:

```ts
expect(chapters[1]).toMatchObject({
  title: "Blicke im Diner",
  body: "Elinor Hale mustert die Fremden.",
});
```

- [ ] **Step 2: Run the three suites and verify RED**

Run:

```bash
./node_modules/.bin/vitest run src/lib/game/bootstrap.test.ts src/lib/game/store.test.ts src/lib/game/intro-director.test.ts
```

Expected: FAIL because all three layers still expose `string[]`.

- [ ] **Step 3: Normalize the server bootstrap**

In `bootstrap.ts`:

```ts
import {
  normalizeOpeningBeats,
  openingBeatFromLegacy,
  type OpeningBeat,
} from "./opening-beat";

const BOOTSTRAP_TYPE = "session_bootstrap_v12";
// Include "session_bootstrap_v11" in LEGACY_BOOTSTRAP_TYPES.

type OpeningIntroPlan = {
  establishingShot: string | null;
  setupBeats: OpeningBeat[];
  characterHookStyle: string | null;
  objective: string | null;
  stakes: string | null;
  firstPrompt: string | null;
};
```

Parse with `normalizeOpeningBeats(raw.setupBeats)`. Preserve explicit titles
while applying `playerFacingGerman` to title/text. Wrap fallback strings with
`openingBeatFromLegacy`, publish narration via
`input.setupBeats.map((beat) => beat.text)`, and set payload `version` to `12`.

- [ ] **Step 4: Normalize replay and render explicit fields**

In `store.ts`:

```ts
import { normalizeOpeningBeats, type OpeningBeat } from "./opening-beat";

export type IntroSequenceState = {
  // retain the existing fields
  setupBeats: OpeningBeat[];
};
```

Replace `stringArrayField(obj.setupBeats)` with
`normalizeOpeningBeats(obj.setupBeats)`. In `intro-director.ts`, remove the
three headline-derivation helpers and map `title: beat.title`,
`body: beat.text`. Hash `${beat.title}:${beat.text}` in the storage key. Render
`beat.text` in `SceneBrief.tsx`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: all selected suites pass, including legacy replay.

- [ ] **Step 6: Run all intro/worldbuild regression tests**

Run:

```bash
./node_modules/.bin/vitest run src/lib/game/opening-beat.test.ts src/lib/game/bootstrap.test.ts src/lib/game/store.test.ts src/lib/game/intro-director.test.ts src/lib/dm/prompts.test.ts src/lib/dm/worldbuild.test.ts src/lib/__tests__/worldbuild-output-schema.test.ts src/app/api/dm/worldbuild/route.test.ts
```

Expected: all selected suites pass.

- [ ] **Step 7: Commit the end-to-end intro pipeline**

```bash
git add src/lib/game/bootstrap.ts src/lib/game/bootstrap.test.ts src/lib/game/store.ts src/lib/game/store.test.ts src/lib/game/intro-director.ts src/lib/game/intro-director.test.ts src/components/game/IntroDirector.tsx src/components/game/SceneBrief.tsx
git commit -m "fix: render complete cinematic intro headings"
```

