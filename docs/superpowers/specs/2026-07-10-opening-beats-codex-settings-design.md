# Structured Opening Beats and Per-DM Codex Settings

**Date:** 2026-07-10  
**Status:** Approved design, pending implementation

## Problem

The cinematic intro currently receives `setupBeats` as plain strings. The UI
derives a chapter heading by cutting the first sentence after 33 characters.
This produces fragments such as `IM DINER ZUR GRAUEN WOLLDECKE MUS...` and
duplicates the same prose in the heading and body. The worldbuilding prompt
also does not distinguish a short display title from narration, so generated
beats can contain meta-language or awkward descriptions of internal decisions.

Codex CLI model selection is currently installation-wide through
`CODEX_MODEL_DM`. The settings page displays that value but cannot change it.
No reasoning-effort override is passed to Codex CLI. A DM therefore cannot tune
quality and latency for their own campaigns without editing container
environment variables and restarting services.

## Goals

- Give every generated opening beat a short, intentional German display title
  and a separate, natural player-facing narration.
- Keep existing campaigns and archived session events readable without a data
  migration of their JSON payloads.
- Let each authenticated DM select the Codex model and reasoning effort in
  `/dm/settings`.
- Preserve environment variables as installation defaults.
- Apply one resolved Codex configuration consistently to live turns,
  worldbuilding, lore processing, and other DM-runtime JSON completions.
- Add no extra model call to session startup.

## Non-goals

- Rewriting all existing campaign prose with an LLM.
- Changing the OpenAI-compatible API fallback model settings.
- Exposing Codex configuration to invited players.
- Persisting arbitrary Codex CLI configuration strings supplied by a user.

## Chosen approach

### Structured opening beats

The canonical worldbuilding shape becomes:

```ts
type OpeningBeat = {
  title: string;
  text: string;
};
```

`openingScene.introPlan.setupBeats` changes from `string[]` to
`OpeningBeat[]` in the worldbuild prompt, Zod blueprint schema, and Codex output
schema. Titles must be two to five natural German words. Text must be one or
two present-tense, player-facing sentences describing observable action. It
must not assign thoughts, decisions, dialogue, or actions to player
characters.

The session bootstrap normalizes both new objects and legacy strings. New
objects retain their authored title and text. Legacy strings retain their full
body and receive a safe derived title:

1. Recognized arrival and NPC-encounter patterns produce semantic titles such
   as `Ankunft am Lichterkai` or `Begegnung mit Elinor Hale`.
2. Unrecognized prose receives a neutral complete title such as
   `Ein neuer Moment`; it is never cut mid-word and never ends in an ellipsis.

The normalized client state carries `OpeningBeat[]`. The Zustand event reducer
accepts both shapes because replayed EventLog entries may still contain string
beats. `IntroDirector` renders `beat.title` and `beat.text`. `SceneBrief`, intro
narration publishing, the storage-key calculation, and tests consume the same
normalized shape.

This design fixes newly generated intros at their source and safely improves
the presentation of existing campaign/session data.

### Per-DM Codex configuration

Two nullable fields are added to `User`:

```prisma
codexModelDm         String?
codexReasoningEffort String?
```

A committed SQL migration adds the columns. `codexReasoningEffort` is
validated at the application boundary as one of `minimal`, `low`, `medium`,
`high`, or `xhigh`; `null` means use the installation default. The model is a
trimmed, length-limited identifier; `null`, an empty string, `auto`, or
`default` means no explicit `--model` argument.

The environment schema gains `CODEX_REASONING_EFFORT_DM`, defaulting to
`medium`. Existing `CODEX_MODEL_DM` remains the model default.

A server-only resolver loads the authenticated DM's overrides and returns the
effective model and effort. Every Codex DM runtime call already receives a
`userId`; this resolver is called before spawning `codex exec`. The generated
arguments use:

```text
--model <effective-model>
-c model_reasoning_effort="<effective-effort>"
```

The values are passed as separate process arguments, not through a shell, so a
saved model cannot inject flags or commands. Only the allow-listed effort
values are accepted.

`GET /api/dm/settings` returns both saved overrides and effective values.
`POST /api/dm/settings` may update Codex settings independently of API fallback
credentials. The settings page adds a dedicated `Codex CLI` panel with:

- a text input for the model, including a visible installation-default option;
- a reasoning-effort select with `Default`, `minimal`, `low`, `medium`, `high`,
  and `xhigh`;
- save feedback and the effective values currently in use.

Changing settings affects the next model invocation and requires no web or
worker restart. Asset image generation remains unchanged because its Codex
flow is an image-generation agent task rather than the DM reasoning runtime.

## Data flow

### Worldbuilding and intro playback

1. Codex returns a blueprint containing structured opening beats.
2. The blueprint schema validates every `title` and `text`.
3. The scene payload stores the structured array as JSON.
4. Session bootstrap normalizes structured or legacy beats.
5. Bootstrap events contain normalized objects.
6. Zustand defensively normalizes replayed legacy events.
7. The Bigscreen uses the explicit title and full narration body.

### Codex settings

1. The DM saves an override in `/dm/settings`.
2. The DM-only route validates and persists the values on `User`.
3. A DM call resolves user overrides over environment defaults.
4. The Codex argument builder emits model and reasoning arguments.
5. `codex exec` runs with the effective values for that invocation.

## Error handling and compatibility

- Invalid effort values return HTTP 400 and are never persisted.
- Model identifiers longer than 120 characters are rejected.
- Missing users or database errors fail the DM call normally and may use the
  existing API fallback path; they do not silently run with another user's
  settings.
- If Codex rejects a model/effort combination, the existing logged warning and
  OpenAI API fallback behavior remain active.
- Legacy scene JSON and EventLog payloads require no database rewrite.
- Structured beats with blank fields are rejected during worldbuilding and
  ignored defensively during event replay.

## Testing

Tests are written before production changes and must demonstrate these cases:

- worldbuild schema accepts structured beats and rejects missing titles/text;
- the prompt explicitly requires short headings and observable German prose;
- bootstrap preserves structured beats and upgrades legacy string beats;
- prepositional NPC sentences produce a complete encounter title;
- unknown legacy prose never becomes a truncated ellipsis headline;
- store replay accepts both legacy and structured event payloads;
- intro chapters render title and body as separate values;
- Codex argument construction emits or omits `--model` correctly and passes an
  allow-listed `model_reasoning_effort` value;
- per-DM values override environment defaults without affecting another user;
- the settings API validates, saves, clears, and reports effective values;
- settings UI saves Codex independently of OpenAI fallback credentials.

Final verification follows the repository checklist: lint, typecheck, pinned
Vitest suite, production build, and focused browser coverage of the settings
form and cinematic intro where feasible.

