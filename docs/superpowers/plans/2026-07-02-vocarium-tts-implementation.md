# Vocarium TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side Vocarium text-to-speech playback for readable game messages, using campaign-host clone voices and protected cached audio.

**Architecture:** Plum Tabletop owns all browser-facing TTS APIs. Campaign voice catalogs and TTS calls use `Remote-User = session.campaign.host.username`; the browser never calls Vocarium and never sees Vocarium tenant routing. Generated audio is cached as Prisma `Bytes` and streamed through session-authorized endpoints.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind, Zustand, Prisma 5/Postgres, Vitest, Vocarium `/v1/voices?source=clone`, Vocarium `/v1/audio/speech`.

## Global Constraints

- Voice tenant rule: `vocariumUser = session.campaign.host.username`.
- Clone voices are listed through Vocarium `GET /v1/voices?source=clone`.
- TTS for clone/default voices is generated through Vocarium `POST /v1/audio/speech`.
- TTS requests send the real `voice_id` as `voice`, not only a display name.
- Do not expose direct Vocarium URLs or tenant logic to the browser.
- Do not generate audio inside the DM turn loop.
- Do not store TTS audio in the existing public-read MinIO asset bucket.
- Store generated TTS audio in `TtsAudioCache.audio` and stream it only after `resolveAccess`.
- Live Vocarium generation is not part of CI because GPU and queue state are not deterministic.
- Routes that touch auth/session state keep `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
- Guest invite browser calls must use route files rooted at `/api/invite/sessions/` because those routes bypass Authelia in Traefik.
- No emoji in UI strings.

---

## File Structure

Create or modify these files:

- Modify `prisma/schema.prisma`: add `VoiceTargetType`, `TtsAudioStatus`, `VoiceAssignment`, `TtsAudioCache`, and relations from `Campaign`/`GameSession`.
- Create `prisma/migrations/20260702120000_vocarium_tts/migration.sql`: hand-authored SQL migration for the new enums, tables, unique constraints, and indexes.
- Modify `src/lib/env.ts`: add `VOCARIUM_API_URL`.
- Modify `.env.example` and `docker-compose.yml`: document and pass `VOCARIUM_API_URL`.
- Create `src/lib/tts/types.ts`: shared TTS target, voice, assignment, and response types.
- Create `src/lib/tts/vocarium-client.ts`: typed server-only Vocarium HTTP client.
- Create `src/lib/tts/voice-resolution.ts`: pure event text/target extraction and voice fallback resolution.
- Create `src/lib/tts/campaign-access.ts`: campaign/session access helper for Authelia users and invite guests.
- Create `src/lib/tts/campaign-api.ts`: handlers for voice list and assignment endpoints.
- Create `src/lib/tts/session-api.ts`: handlers for session TTS generation and protected audio streaming.
- Create `src/app/api/campaigns/[id]/voices/route.ts`.
- Create `src/app/api/campaigns/[id]/voice-assignments/route.ts`.
- Create `src/app/api/invite/sessions/[id]/voices/[token]/route.ts`.
- Create `src/app/api/invite/sessions/[id]/voice-assignments/[token]/route.ts`.
- Create `src/app/api/sessions/[id]/tts/route.ts`.
- Create `src/app/api/sessions/[id]/tts/[cacheId]/route.ts`.
- Create `src/app/api/invite/sessions/[id]/tts/[token]/route.ts`.
- Create `src/app/api/invite/sessions/[id]/tts/[cacheId]/[token]/route.ts`.
- Modify `src/app/play/_components/PlaySessionRoom.tsx`: pass `campaignId` into `GameRoom`.
- Modify `src/components/game/GameRoom.tsx`: add voice menu state and wrap game UI with TTS provider.
- Create `src/components/game/TtsProvider.tsx`: shared playback state, local autoplay flag, and POST/play/stop logic.
- Create `src/components/game/AudioLineButton.tsx`: compact accessible play/stop/loading/error control.
- Create `src/components/game/VoiceMenu.tsx`: in-game voice assignment menu.
- Modify `src/components/game/CinematicView.tsx`: add play/stop and autoplay control to the nameplate.
- Modify `src/components/game/ChatLog.tsx`: add play/stop controls to narrate/player lines.
- Create `src/lib/tts/voice-resolution.test.ts`.
- Create `src/lib/tts/vocarium-client.test.ts`.
- Create `src/lib/tts/campaign-api.test.ts`.
- Create `src/lib/tts/session-api.test.ts`.
- Create `src/components/game/tts-paths.test.ts`.
- Modify `docs/ops.md`: add Vocarium/TTS operational notes and smoke commands.

---

### Task 1: Database And Runtime Configuration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260702120000_vocarium_tts/migration.sql`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces Prisma delegates: `prisma.voiceAssignment` and `prisma.ttsAudioCache`.
- Produces enums: `VoiceTargetType` values `narrator | npc | character`; `TtsAudioStatus` values `ready | failed`.
- Produces env value: `env().VOCARIUM_API_URL`.

- [ ] **Step 1: Add Prisma models and relations**

Add these enum/model blocks near the live game session models in `prisma/schema.prisma`:

```prisma
enum VoiceTargetType {
  narrator
  npc
  character
}

enum TtsAudioStatus {
  ready
  failed
}

model VoiceAssignment {
  id           String          @id @default(cuid())
  campaignId   String
  campaign     Campaign        @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  targetType   VoiceTargetType
  targetId     String
  vocariumUser String
  voiceId      String
  voiceName    String
  voiceSource  String          @default("clone")
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@unique([campaignId, targetType, targetId])
  @@index([campaignId, targetType])
  @@index([voiceId])
}

model TtsAudioCache {
  id         String         @id @default(cuid())
  sessionId  String
  session    GameSession    @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  eventId    String
  voiceId    String
  textHash   String
  audio      Bytes?
  mimeType   String?
  byteLength Int            @default(0)
  status     TtsAudioStatus
  error      String?
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  @@unique([sessionId, eventId, voiceId, textHash])
  @@index([sessionId, eventId])
  @@index([status, updatedAt])
}
```

Add `voiceAssignments VoiceAssignment[]` inside the existing `Campaign` model.
Add `ttsAudioCache TtsAudioCache[]` inside the existing `GameSession` model.

- [ ] **Step 2: Write the hand-authored migration**

Create `prisma/migrations/20260702120000_vocarium_tts/migration.sql`:

```sql
CREATE TYPE "VoiceTargetType" AS ENUM ('narrator', 'npc', 'character');
CREATE TYPE "TtsAudioStatus" AS ENUM ('ready', 'failed');

CREATE TABLE "VoiceAssignment" (
  "id"           TEXT PRIMARY KEY,
  "campaignId"   TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "targetType"   "VoiceTargetType" NOT NULL,
  "targetId"     TEXT NOT NULL,
  "vocariumUser" TEXT NOT NULL,
  "voiceId"      TEXT NOT NULL,
  "voiceName"    TEXT NOT NULL,
  "voiceSource"  TEXT NOT NULL DEFAULT 'clone',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VoiceAssignment_campaign_target_unique"
    UNIQUE ("campaignId", "targetType", "targetId")
);

CREATE INDEX "VoiceAssignment_campaignId_targetType_idx"
  ON "VoiceAssignment"("campaignId", "targetType");

CREATE INDEX "VoiceAssignment_voiceId_idx"
  ON "VoiceAssignment"("voiceId");

CREATE TABLE "TtsAudioCache" (
  "id"         TEXT PRIMARY KEY,
  "sessionId"  TEXT NOT NULL REFERENCES "GameSession"("id") ON DELETE CASCADE,
  "eventId"    TEXT NOT NULL,
  "voiceId"    TEXT NOT NULL,
  "textHash"   TEXT NOT NULL,
  "audio"      BYTEA,
  "mimeType"   TEXT,
  "byteLength" INTEGER NOT NULL DEFAULT 0,
  "status"     "TtsAudioStatus" NOT NULL,
  "error"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TtsAudioCache_session_event_voice_text_unique"
    UNIQUE ("sessionId", "eventId", "voiceId", "textHash")
);

CREATE INDEX "TtsAudioCache_sessionId_eventId_idx"
  ON "TtsAudioCache"("sessionId", "eventId");

CREATE INDEX "TtsAudioCache_status_updatedAt_idx"
  ON "TtsAudioCache"("status", "updatedAt");
```

- [ ] **Step 3: Add the Vocarium base URL env var**

In `src/lib/env.ts`, add the field after `REDIS_URL`:

```ts
VOCARIUM_API_URL: z.string().url().default("http://vocarium-api:8280"),
```

In `.env.example`, add:

```dotenv
# --- Vocarium TTS -------------------------------------------------------
# Must point at the Vocarium gateway reachable from the Next.js container.
# If Vocarium runs in a separate compose project, connect both stacks to a
# shared Docker network or set this to a routable host URL.
VOCARIUM_API_URL=http://vocarium-api:8280
```

In `docker-compose.yml`, add to `x-common-env`:

```yaml
  VOCARIUM_API_URL: ${VOCARIUM_API_URL:-http://vocarium-api:8280}
```

- [ ] **Step 4: Generate Prisma client and check schema parsing**

Run:

```bash
npx prisma generate
```

Expected: Prisma client generation succeeds and exposes `VoiceAssignment` and `TtsAudioCache`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260702120000_vocarium_tts/migration.sql src/lib/env.ts .env.example docker-compose.yml
git commit -m "feat: add tts persistence schema"
```

---

### Task 2: Vocarium Client And Voice Resolution

**Files:**
- Create: `src/lib/tts/types.ts`
- Create: `src/lib/tts/vocarium-client.ts`
- Create: `src/lib/tts/voice-resolution.ts`
- Create: `src/lib/tts/voice-resolution.test.ts`
- Create: `src/lib/tts/vocarium-client.test.ts`

**Interfaces:**
- Consumes: `env().VOCARIUM_API_URL`; Prisma enum string values from Task 1.
- Produces: `listCloneVoices(vocariumUser)`, `synthesizeCloneSpeech(input)`, `readableEventFromLog(event)`, `resolveVoiceForTarget(input)`.

- [ ] **Step 1: Write failing voice-resolution tests**

Create `src/lib/tts/voice-resolution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NARRATOR_TARGET_ID,
  readableEventFromLog,
  resolveVoiceForTarget,
} from "./voice-resolution";

const assignments = [
  {
    targetType: "npc" as const,
    targetId: "npc_moss",
    vocariumUser: "zwaetschge",
    voiceId: "2abffe14",
    voiceName: "Maurice Moss",
    voiceSource: "clone",
  },
  {
    targetType: "character" as const,
    targetId: "char_robert",
    vocariumUser: "zwaetschge",
    voiceId: "83b59aca",
    voiceName: "Michael Scott",
    voiceSource: "clone",
  },
  {
    targetType: "narrator" as const,
    targetId: NARRATOR_TARGET_ID,
    vocariumUser: "zwaetschge",
    voiceId: "f58b5eb8",
    voiceName: "Rufus Beck",
    voiceSource: "clone",
  },
];

describe("readableEventFromLog", () => {
  it("extracts NPC narration as an npc target", () => {
    expect(
      readableEventFromLog({
        id: "ev_1",
        type: "narrate",
        payload: { text: "Ich habe einen Plan.", speakerNpcId: "npc_moss" },
      }),
    ).toEqual({
      eventId: "ev_1",
      text: "Ich habe einen Plan.",
      target: { targetType: "npc", targetId: "npc_moss" },
    });
  });

  it("extracts player input as a character target when characterId exists", () => {
    expect(
      readableEventFromLog({
        id: "ev_2",
        type: "player_input",
        payload: { text: "Ich pruefe die Tuer.", characterId: "char_robert" },
      }),
    ).toEqual({
      eventId: "ev_2",
      text: "Ich pruefe die Tuer.",
      target: { targetType: "character", targetId: "char_robert" },
    });
  });

  it("uses the narrator target for narration without an NPC speaker", () => {
    expect(
      readableEventFromLog({
        id: "ev_3",
        type: "narrate",
        payload: { text: "Regen faellt auf das Dach." },
      }),
    ).toMatchObject({
      target: { targetType: "narrator", targetId: NARRATOR_TARGET_ID },
    });
  });

  it("rejects non-readable event types", () => {
    expect(
      readableEventFromLog({
        id: "ev_roll",
        type: "dice_roll",
        payload: { notation: "1d20" },
      }),
    ).toBeNull();
  });
});

describe("resolveVoiceForTarget", () => {
  it("prefers the exact NPC assignment", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "npc", targetId: "npc_moss" },
        assignments,
        vocariumUser: "zwaetschge",
      }),
    ).toMatchObject({ voiceId: "2abffe14", voiceName: "Maurice Moss" });
  });

  it("prefers the exact character assignment", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "character", targetId: "char_robert" },
        assignments,
        vocariumUser: "zwaetschge",
      }),
    ).toMatchObject({ voiceId: "83b59aca", voiceName: "Michael Scott" });
  });

  it("falls back to narrator assignment", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "npc", targetId: "npc_unknown" },
        assignments,
        vocariumUser: "zwaetschge",
      }),
    ).toMatchObject({ voiceId: "f58b5eb8", voiceName: "Rufus Beck" });
  });

  it("falls back to Vocarium default when no assignment exists", () => {
    expect(
      resolveVoiceForTarget({
        target: { targetType: "npc", targetId: "npc_unknown" },
        assignments: [],
        vocariumUser: "zwaetschge",
      }),
    ).toEqual({
      voiceId: "default",
      voiceName: "Default",
      voiceSource: "clone",
      vocariumUser: "zwaetschge",
      fallback: "default",
    });
  });
});
```

- [ ] **Step 2: Implement shared TTS types**

Create `src/lib/tts/types.ts`:

```ts
import { z } from "zod";

export const voiceTargetTypeSchema = z.enum(["narrator", "npc", "character"]);
export type VoiceTargetType = z.infer<typeof voiceTargetTypeSchema>;

export const voiceTargetSchema = z.object({
  targetType: voiceTargetTypeSchema,
  targetId: z.string().min(1).max(160),
});
export type VoiceTarget = z.infer<typeof voiceTargetSchema>;

export const voiceAssignmentInputSchema = z.object({
  targetType: voiceTargetTypeSchema,
  targetId: z.string().min(1).max(160),
  voiceId: z.string().min(1).max(160),
});

export const voiceAssignmentsPutSchema = z.object({
  assignments: z.array(voiceAssignmentInputSchema).min(1).max(50),
});

export type VoiceAssignmentInput = z.infer<typeof voiceAssignmentInputSchema>;

export type VocariumVoice = {
  voiceId: string;
  name: string;
  language: string | null;
  source: "clone";
  vocariumUser: string;
};

export type StoredVoiceAssignment = {
  targetType: VoiceTargetType;
  targetId: string;
  vocariumUser: string;
  voiceId: string;
  voiceName: string;
  voiceSource: string;
};
```

- [ ] **Step 3: Implement voice extraction and fallback resolution**

Create `src/lib/tts/voice-resolution.ts`:

```ts
import type {
  StoredVoiceAssignment,
  VoiceTarget,
  VoiceTargetType,
} from "./types";

export const NARRATOR_TARGET_ID = "narrator";

export type ReadableEventLog = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

export type ReadableTtsEvent = {
  eventId: string;
  text: string;
  target: VoiceTarget;
};

export type ResolvedVoice = {
  voiceId: string;
  voiceName: string;
  voiceSource: "clone";
  vocariumUser: string;
  fallback?: "narrator" | "default";
};

export function readableEventFromLog(
  event: ReadableEventLog,
): ReadableTtsEvent | null {
  const text = stringField(event.payload.text);
  if (!text) return null;

  if (event.type === "narrate") {
    const speakerNpcId = stringField(event.payload.speakerNpcId);
    return {
      eventId: event.id,
      text,
      target: speakerNpcId
        ? { targetType: "npc", targetId: speakerNpcId }
        : { targetType: "narrator", targetId: NARRATOR_TARGET_ID },
    };
  }

  if (event.type === "player_input") {
    const characterId = stringField(event.payload.characterId);
    return {
      eventId: event.id,
      text,
      target: characterId
        ? { targetType: "character", targetId: characterId }
        : { targetType: "narrator", targetId: NARRATOR_TARGET_ID },
    };
  }

  return null;
}

export function resolveVoiceForTarget(input: {
  target: VoiceTarget;
  assignments: StoredVoiceAssignment[];
  vocariumUser: string;
}): ResolvedVoice {
  const exact = findAssignment(input.assignments, input.target);
  if (exact) return fromAssignment(exact);

  const narrator = findAssignment(input.assignments, {
    targetType: "narrator",
    targetId: NARRATOR_TARGET_ID,
  });
  if (narrator) return { ...fromAssignment(narrator), fallback: "narrator" };

  return {
    voiceId: "default",
    voiceName: "Default",
    voiceSource: "clone",
    vocariumUser: input.vocariumUser,
    fallback: "default",
  };
}

function findAssignment(
  assignments: StoredVoiceAssignment[],
  target: { targetType: VoiceTargetType; targetId: string },
) {
  return assignments.find(
    (assignment) =>
      assignment.targetType === target.targetType &&
      assignment.targetId === target.targetId,
  );
}

function fromAssignment(assignment: StoredVoiceAssignment): ResolvedVoice {
  return {
    voiceId: assignment.voiceId,
    voiceName: assignment.voiceName,
    voiceSource: "clone",
    vocariumUser: assignment.vocariumUser,
  };
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
```

- [ ] **Step 4: Write failing Vocarium client tests**

Create `src/lib/tts/vocarium-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  env: vi.fn(() => ({ VOCARIUM_API_URL: "http://vocarium.test" })),
}));

vi.mock("@/lib/env", () => envMock);

describe("vocarium client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists clone voices with the campaign host as Remote-User", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: "83b59aca",
              name: "Michael Scott",
              language: "German",
              source: "clone",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { listCloneVoices } = await import("./vocarium-client");
    const voices = await listCloneVoices("zwaetschge");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://vocarium.test/v1/voices?source=clone",
      expect.objectContaining({
        headers: expect.objectContaining({ "Remote-User": "zwaetschge" }),
      }),
    );
    expect(voices).toEqual([
      {
        voiceId: "83b59aca",
        name: "Michael Scott",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);
  });

  it("synthesizes clone speech through /v1/audio/speech", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      }),
    );

    const { synthesizeCloneSpeech } = await import("./vocarium-client");
    const audio = await synthesizeCloneSpeech({
      vocariumUser: "zwaetschge",
      voiceId: "2abffe14",
      text: "Kurzer Test.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://vocarium.test/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Remote-User": "zwaetschge",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "tts-1",
          input: "Kurzer Test.",
          voice: "2abffe14",
          response_format: "wav",
        }),
      }),
    );
    expect(audio).toEqual({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "audio/wav",
    });
  });
});
```

- [ ] **Step 5: Implement the Vocarium client**

Create `src/lib/tts/vocarium-client.ts`:

```ts
import { z } from "zod";
import { env } from "@/lib/env";
import type { VocariumVoice } from "./types";

const voiceListResponseSchema = z.object({
  voices: z.array(
    z.object({
      voice_id: z.string().min(1),
      name: z.string().min(1),
      language: z.string().nullable().optional(),
      source: z.string(),
    }),
  ),
});

export class VocariumError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "VocariumError";
  }
}

export async function listCloneVoices(
  vocariumUser: string,
): Promise<VocariumVoice[]> {
  const response = await vocariumFetch("/v1/voices?source=clone", {
    method: "GET",
    vocariumUser,
  });
  const json = await response.json().catch(() => null);
  const parsed = voiceListResponseSchema.safeParse(json);
  if (!parsed.success) throw new VocariumError("invalid_voice_response");

  return parsed.data.voices
    .filter((voice) => voice.source === "clone")
    .map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      language: voice.language ?? null,
      source: "clone",
      vocariumUser,
    }));
}

export async function synthesizeCloneSpeech(input: {
  vocariumUser: string;
  voiceId: string;
  text: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await vocariumFetch("/v1/audio/speech", {
    method: "POST",
    vocariumUser: input.vocariumUser,
    body: JSON.stringify({
      model: "tts-1",
      input: input.text,
      voice: input.voiceId,
      response_format: "wav",
    }),
    headers: { "Content-Type": "application/json" },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new VocariumError("empty_audio_response");
  return {
    bytes,
    mimeType: response.headers.get("content-type") ?? "audio/wav",
  };
}

async function vocariumFetch(
  path: string,
  opts: {
    method: "GET" | "POST";
    vocariumUser: string;
    headers?: Record<string, string>;
    body?: BodyInit;
  },
) {
  const base = env().VOCARIUM_API_URL.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    method: opts.method,
    headers: {
      "Remote-User": opts.vocariumUser,
      ...(opts.headers ?? {}),
    },
    body: opts.body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new VocariumError(`vocarium_${response.status}`, response.status);
  }
  return response;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
./node_modules/.bin/vitest run src/lib/tts/voice-resolution.test.ts src/lib/tts/vocarium-client.test.ts
```

Expected: both test files pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tts/types.ts src/lib/tts/vocarium-client.ts src/lib/tts/voice-resolution.ts src/lib/tts/voice-resolution.test.ts src/lib/tts/vocarium-client.test.ts
git commit -m "feat: add vocarium tts core helpers"
```

---

### Task 3: Campaign Voice Catalog And Assignment APIs

**Files:**
- Create: `src/lib/tts/campaign-access.ts`
- Create: `src/lib/tts/campaign-api.ts`
- Create: `src/lib/tts/campaign-api.test.ts`
- Create: `src/app/api/campaigns/[id]/voices/route.ts`
- Create: `src/app/api/campaigns/[id]/voice-assignments/route.ts`
- Create: `src/app/api/invite/sessions/[id]/voices/[token]/route.ts`
- Create: `src/app/api/invite/sessions/[id]/voice-assignments/[token]/route.ts`

**Interfaces:**
- Consumes: `listCloneVoices`, `voiceAssignmentsPutSchema`, `resolveAccess`, `getSessionUser`, Prisma models from Task 1.
- Produces handlers:
  - `handleCampaignVoices(req, campaignId, opts?)`
  - `handleGetVoiceAssignments(req, campaignId, opts?)`
  - `handlePutVoiceAssignments(req, campaignId, opts?)`
  - `handleInviteSessionVoices(req, sessionId, inviteToken)`
  - `handleInviteSessionVoiceAssignments(req, sessionId, inviteToken)`

- [ ] **Step 1: Write failing API tests for access, list, and assignment persistence**

Create `src/lib/tts/campaign-api.test.ts` with mocked Prisma, auth, access, and Vocarium client. Include these cases:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  campaignFindUnique: vi.fn(),
  voiceAssignmentFindMany: vi.fn(),
  voiceAssignmentUpsert: vi.fn(),
  characterFindFirst: vi.fn(),
}));

const authMock = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
const accessMock = vi.hoisted(() => ({ resolveAccess: vi.fn() }));
const vocariumMock = vi.hoisted(() => ({ listCloneVoices: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: { findUnique: db.campaignFindUnique },
    voiceAssignment: {
      findMany: db.voiceAssignmentFindMany,
      upsert: db.voiceAssignmentUpsert,
    },
    character: { findFirst: db.characterFindFirst },
  },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: authMock.getSessionUser,
}));

vi.mock("@/lib/game/access", () => ({
  resolveAccess: accessMock.resolveAccess,
}));

vi.mock("./vocarium-client", () => ({
  listCloneVoices: vocariumMock.listCloneVoices,
}));

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("campaign voice APIs", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(db).forEach((mock) => mock.mockReset());
    authMock.getSessionUser.mockReset();
    accessMock.resolveAccess.mockReset();
    vocariumMock.listCloneVoices.mockReset();
  });

  it("lists clone voices using the campaign host username", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({ id: "host_1", username: "zwaetschge" });
    vocariumMock.listCloneVoices.mockResolvedValue([
      {
        voiceId: "83b59aca",
        name: "Michael Scott",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);

    const { handleCampaignVoices } = await import("./campaign-api");
    const response = await handleCampaignVoices(
      new Request("http://app/api/campaigns/camp_1/voices"),
      "camp_1",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      voices: [
        {
          voiceId: "83b59aca",
          name: "Michael Scott",
          language: "German",
          source: "clone",
          vocariumUser: "zwaetschge",
        },
      ],
    });
    expect(vocariumMock.listCloneVoices).toHaveBeenCalledWith("zwaetschge");
  });

  it("lets the host assign narrator and NPC voices", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({ id: "host_1", username: "zwaetschge" });
    vocariumMock.listCloneVoices.mockResolvedValue([
      {
        voiceId: "2abffe14",
        name: "Maurice Moss",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);
    db.voiceAssignmentUpsert.mockResolvedValue({
      id: "va_1",
      campaignId: "camp_1",
      targetType: "npc",
      targetId: "npc_moss",
      voiceId: "2abffe14",
      voiceName: "Maurice Moss",
      voiceSource: "clone",
      vocariumUser: "zwaetschge",
    });

    const { handlePutVoiceAssignments } = await import("./campaign-api");
    const response = await handlePutVoiceAssignments(
      jsonRequest("http://app/api/campaigns/camp_1/voice-assignments", {
        assignments: [
          { targetType: "npc", targetId: "npc_moss", voiceId: "2abffe14" },
        ],
      }),
      "camp_1",
    );

    expect(response.status).toBe(200);
    expect(db.voiceAssignmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId_targetType_targetId: {
            campaignId: "camp_1",
            targetType: "npc",
            targetId: "npc_moss",
          },
        },
        create: expect.objectContaining({
          vocariumUser: "zwaetschge",
          voiceName: "Maurice Moss",
          voiceSource: "clone",
        }),
      }),
    );
  });

  it("lets a player assign only their own character voice", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({ id: "player_1", username: "player" });
    db.characterFindFirst.mockResolvedValue({ id: "char_robert" });
    vocariumMock.listCloneVoices.mockResolvedValue([
      {
        voiceId: "83b59aca",
        name: "Michael Scott",
        language: "German",
        source: "clone",
        vocariumUser: "zwaetschge",
      },
    ]);
    db.voiceAssignmentUpsert.mockResolvedValue({
      id: "va_2",
      campaignId: "camp_1",
      targetType: "character",
      targetId: "char_robert",
      voiceId: "83b59aca",
      voiceName: "Michael Scott",
      voiceSource: "clone",
      vocariumUser: "zwaetschge",
    });

    const { handlePutVoiceAssignments } = await import("./campaign-api");
    const response = await handlePutVoiceAssignments(
      jsonRequest("http://app/api/campaigns/camp_1/voice-assignments", {
        assignments: [
          {
            targetType: "character",
            targetId: "char_robert",
            voiceId: "83b59aca",
          },
        ],
      }),
      "camp_1",
    );

    expect(response.status).toBe(200);
  });

  it("blocks a player assigning an NPC voice", async () => {
    db.campaignFindUnique.mockResolvedValue({
      id: "camp_1",
      hostId: "host_1",
      host: { username: "zwaetschge" },
    });
    authMock.getSessionUser.mockResolvedValue({ id: "player_1", username: "player" });
    db.characterFindFirst.mockResolvedValue({ id: "char_robert" });

    const { handlePutVoiceAssignments } = await import("./campaign-api");
    const response = await handlePutVoiceAssignments(
      jsonRequest("http://app/api/campaigns/camp_1/voice-assignments", {
        assignments: [
          { targetType: "npc", targetId: "npc_moss", voiceId: "2abffe14" },
        ],
      }),
      "camp_1",
    );

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Implement campaign/session voice access helper**

Create `src/lib/tts/campaign-access.ts`:

```ts
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveAccess } from "@/lib/game/access";

export type VoiceAccess =
  | {
      role: "host";
      campaignId: string;
      userId: string;
      characterId: null;
      hostUsername: string;
    }
  | {
      role: "player";
      campaignId: string;
      userId: string | null;
      characterId: string | null;
      hostUsername: string;
    };

export async function resolveCampaignVoiceAccess(input: {
  campaignId: string;
  req: Request;
  sessionId?: string | null;
  inviteToken?: string | null;
}): Promise<VoiceAccess | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      hostId: true,
      host: { select: { username: true } },
    },
  });
  if (!campaign) return null;

  const sessionId =
    input.sessionId ?? new URL(input.req.url).searchParams.get("sessionId");
  if (sessionId) {
    const access = await resolveAccess({
      sessionId,
      inviteToken: input.inviteToken,
    });
    if (access?.campaignId === campaign.id) {
      return access.role === "host"
        ? {
            role: "host",
            campaignId: campaign.id,
            userId: access.userId,
            characterId: null,
            hostUsername: campaign.host.username,
          }
        : {
            role: "player",
            campaignId: campaign.id,
            userId: access.userId,
            characterId: access.characterId,
            hostUsername: campaign.host.username,
          };
    }
  }

  const user = await getSessionUser();
  if (!user) return null;
  if (campaign.hostId === user.id) {
    return {
      role: "host",
      campaignId: campaign.id,
      userId: user.id,
      characterId: null,
      hostUsername: campaign.host.username,
    };
  }

  const character = await prisma.character.findFirst({
    where: { campaignId: campaign.id, ownerId: user.id },
    select: { id: true },
  });
  if (!character) return null;
  return {
    role: "player",
    campaignId: campaign.id,
    userId: user.id,
    characterId: character.id,
    hostUsername: campaign.host.username,
  };
}

export async function campaignIdForInviteSession(
  sessionId: string,
  inviteToken: string,
) {
  const access = await resolveAccess({ sessionId, inviteToken });
  return access ? { campaignId: access.campaignId, access } : null;
}
```

- [ ] **Step 3: Implement campaign API handlers**

Create `src/lib/tts/campaign-api.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listCloneVoices } from "./vocarium-client";
import {
  campaignIdForInviteSession,
  resolveCampaignVoiceAccess,
} from "./campaign-access";
import { voiceAssignmentsPutSchema } from "./types";

export async function handleCampaignVoices(
  req: Request,
  campaignId: string,
  opts: { sessionId?: string | null; inviteToken?: string | null } = {},
) {
  const access = await resolveCampaignVoiceAccess({ campaignId, req, ...opts });
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const voices = await listCloneVoices(access.hostUsername);
  return NextResponse.json({ voices });
}

export async function handleGetVoiceAssignments(
  req: Request,
  campaignId: string,
  opts: { sessionId?: string | null; inviteToken?: string | null } = {},
) {
  const access = await resolveCampaignVoiceAccess({ campaignId, req, ...opts });
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await prisma.voiceAssignment.findMany({
    where: { campaignId },
    orderBy: [{ targetType: "asc" }, { targetId: "asc" }],
    select: {
      id: true,
      targetType: true,
      targetId: true,
      vocariumUser: true,
      voiceId: true,
      voiceName: true,
      voiceSource: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ assignments: rows });
}

export async function handlePutVoiceAssignments(
  req: Request,
  campaignId: string,
  opts: { sessionId?: string | null; inviteToken?: string | null } = {},
) {
  const access = await resolveCampaignVoiceAccess({ campaignId, req, ...opts });
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = voiceAssignmentsPutSchema.safeParse(
    await req.json().catch(() => ({})),
  );
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );
  }

  for (const assignment of body.data.assignments) {
    if (!canWriteAssignment(access, assignment)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const voices = await listCloneVoices(access.hostUsername);
  const voiceById = new Map(voices.map((voice) => [voice.voiceId, voice]));

  const saved = [];
  for (const assignment of body.data.assignments) {
    const voice = voiceById.get(assignment.voiceId);
    if (!voice) {
      return NextResponse.json(
        { error: "unknown_voice", voiceId: assignment.voiceId },
        { status: 400 },
      );
    }
    saved.push(
      await prisma.voiceAssignment.upsert({
        where: {
          campaignId_targetType_targetId: {
            campaignId,
            targetType: assignment.targetType,
            targetId: assignment.targetId,
          },
        },
        create: {
          campaignId,
          targetType: assignment.targetType,
          targetId: assignment.targetId,
          vocariumUser: access.hostUsername,
          voiceId: voice.voiceId,
          voiceName: voice.name,
          voiceSource: voice.source,
        },
        update: {
          vocariumUser: access.hostUsername,
          voiceId: voice.voiceId,
          voiceName: voice.name,
          voiceSource: voice.source,
        },
      }),
    );
  }

  return NextResponse.json({ assignments: saved });
}

export async function handleInviteSessionVoices(
  req: Request,
  sessionId: string,
  inviteToken: string,
) {
  const resolved = await campaignIdForInviteSession(sessionId, inviteToken);
  if (!resolved) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return handleCampaignVoices(req, resolved.campaignId, { sessionId, inviteToken });
}

export async function handleInviteSessionVoiceAssignments(
  req: Request,
  sessionId: string,
  inviteToken: string,
) {
  const resolved = await campaignIdForInviteSession(sessionId, inviteToken);
  if (!resolved) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return req.method === "PUT"
    ? handlePutVoiceAssignments(req, resolved.campaignId, {
        sessionId,
        inviteToken,
      })
    : handleGetVoiceAssignments(req, resolved.campaignId, {
        sessionId,
        inviteToken,
      });
}

function canWriteAssignment(
  access: { role: "host" | "player"; characterId: string | null },
  assignment: { targetType: string; targetId: string },
) {
  if (access.role === "host") return true;
  return (
    assignment.targetType === "character" &&
    Boolean(access.characterId) &&
    assignment.targetId === access.characterId
  );
}
```

- [ ] **Step 4: Add route wrappers**

Create `src/app/api/campaigns/[id]/voices/route.ts`:

```ts
import { handleCampaignVoices } from "@/lib/tts/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleCampaignVoices(req, id);
}
```

Create `src/app/api/campaigns/[id]/voice-assignments/route.ts`:

```ts
import {
  handleGetVoiceAssignments,
  handlePutVoiceAssignments,
} from "@/lib/tts/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleGetVoiceAssignments(req, id);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handlePutVoiceAssignments(req, id);
}
```

Create `src/app/api/invite/sessions/[id]/voices/[token]/route.ts`:

```ts
import { handleInviteSessionVoices } from "@/lib/tts/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleInviteSessionVoices(req, id, token);
}
```

Create `src/app/api/invite/sessions/[id]/voice-assignments/[token]/route.ts`:

```ts
import { handleInviteSessionVoiceAssignments } from "@/lib/tts/campaign-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleInviteSessionVoiceAssignments(req, id, token);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleInviteSessionVoiceAssignments(req, id, token);
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
./node_modules/.bin/vitest run src/lib/tts/campaign-api.test.ts
```

Expected: campaign voice API tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tts/campaign-access.ts src/lib/tts/campaign-api.ts src/lib/tts/campaign-api.test.ts src/app/api/campaigns src/app/api/invite/sessions
git commit -m "feat: add campaign voice APIs"
```

---

### Task 4: Session TTS Generation And Protected Audio Streaming

**Files:**
- Create: `src/lib/tts/session-api.ts`
- Create: `src/lib/tts/session-api.test.ts`
- Create: `src/app/api/sessions/[id]/tts/route.ts`
- Create: `src/app/api/sessions/[id]/tts/[cacheId]/route.ts`
- Create: `src/app/api/invite/sessions/[id]/tts/[token]/route.ts`
- Create: `src/app/api/invite/sessions/[id]/tts/[cacheId]/[token]/route.ts`

**Interfaces:**
- Consumes: `resolveAccess`, `eventForClient`, `readableEventFromLog`, `resolveVoiceForTarget`, `synthesizeCloneSpeech`, Prisma `TtsAudioCache`.
- Produces:
  - `handleSessionTts(req, sessionId, inviteToken?)`
  - `handleSessionTtsAudio(req, sessionId, cacheId, inviteToken?)`
- Response from `POST`: `{ status: "ready", cacheId, audioUrl, mimeType, byteLength, voice }`.

- [ ] **Step 1: Write failing session API tests**

Create `src/lib/tts/session-api.test.ts` covering:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gameSessionFindUnique: vi.fn(),
  eventLogFindFirst: vi.fn(),
  voiceAssignmentFindMany: vi.fn(),
  ttsAudioCacheFindFirst: vi.fn(),
  ttsAudioCacheCreate: vi.fn(),
}));

const accessMock = vi.hoisted(() => ({ resolveAccess: vi.fn() }));
const vocariumMock = vi.hoisted(() => ({ synthesizeCloneSpeech: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    gameSession: { findUnique: db.gameSessionFindUnique },
    eventLog: { findFirst: db.eventLogFindFirst },
    voiceAssignment: { findMany: db.voiceAssignmentFindMany },
    ttsAudioCache: {
      findFirst: db.ttsAudioCacheFindFirst,
      create: db.ttsAudioCacheCreate,
    },
  },
}));

vi.mock("@/lib/game/access", () => ({
  resolveAccess: accessMock.resolveAccess,
}));

vi.mock("./vocarium-client", () => ({
  synthesizeCloneSpeech: vocariumMock.synthesizeCloneSpeech,
}));

function post(eventId: string) {
  return new Request("http://app/api/sessions/sess_1/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId }),
  });
}

describe("session TTS API", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(db).forEach((mock) => mock.mockReset());
    accessMock.resolveAccess.mockReset();
    vocariumMock.synthesizeCloneSpeech.mockReset();
  });

  it("returns cached audio without calling Vocarium", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        targetType: "npc",
        targetId: "npc_moss",
        vocariumUser: "zwaetschge",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    ]);
    db.ttsAudioCacheFindFirst.mockResolvedValue({
      id: "cache_1",
      status: "ready",
      mimeType: "audio/wav",
      byteLength: 12,
      voiceId: "2abffe14",
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_1"), "sess_1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      cacheId: "cache_1",
      audioUrl: "/api/sessions/sess_1/tts/cache_1",
    });
    expect(vocariumMock.synthesizeCloneSpeech).not.toHaveBeenCalled();
  });

  it("generates audio with the campaign host tenant and stores bytes", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_1",
      sessionId: "sess_1",
      type: "narrate",
      scope: "all",
      ts: new Date(),
      payload: { text: "Hallo.", speakerNpcId: "npc_moss" },
    });
    db.voiceAssignmentFindMany.mockResolvedValue([
      {
        targetType: "npc",
        targetId: "npc_moss",
        vocariumUser: "zwaetschge",
        voiceId: "2abffe14",
        voiceName: "Maurice Moss",
        voiceSource: "clone",
      },
    ]);
    db.ttsAudioCacheFindFirst.mockResolvedValue(null);
    vocariumMock.synthesizeCloneSpeech.mockResolvedValue({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "audio/wav",
    });
    db.ttsAudioCacheCreate.mockResolvedValue({
      id: "cache_new",
      status: "ready",
      mimeType: "audio/wav",
      byteLength: 3,
      voiceId: "2abffe14",
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_1"), "sess_1");

    expect(response.status).toBe(200);
    expect(vocariumMock.synthesizeCloneSpeech).toHaveBeenCalledWith({
      vocariumUser: "zwaetschge",
      voiceId: "2abffe14",
      text: "Hallo.",
    });
    expect(db.ttsAudioCacheCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: "sess_1",
          eventId: "ev_1",
          voiceId: "2abffe14",
          audio: Buffer.from([1, 2, 3]),
          mimeType: "audio/wav",
          byteLength: 3,
          status: "ready",
        }),
      }),
    );
  });

  it("blocks unreadable event types", async () => {
    accessMock.resolveAccess.mockResolvedValue({
      role: "host",
      sessionId: "sess_1",
      campaignId: "camp_1",
      userId: "host_1",
      displayName: "DM",
      memberId: "member_1",
    });
    db.gameSessionFindUnique.mockResolvedValue({
      id: "sess_1",
      campaignId: "camp_1",
      campaign: { host: { username: "zwaetschge" } },
    });
    db.eventLogFindFirst.mockResolvedValue({
      id: "ev_roll",
      sessionId: "sess_1",
      type: "dice_roll",
      scope: "all",
      ts: new Date(),
      payload: { notation: "1d20" },
    });

    const { handleSessionTts } = await import("./session-api");
    const response = await handleSessionTts(post("ev_roll"), "sess_1");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "not_readable" });
  });
});
```

- [ ] **Step 2: Implement session TTS handlers**

Create `src/lib/tts/session-api.ts`:

```ts
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveAccess } from "@/lib/game/access";
import { eventForClient } from "@/lib/game/events";
import {
  readableEventFromLog,
  resolveVoiceForTarget,
} from "./voice-resolution";
import { synthesizeCloneSpeech } from "./vocarium-client";

const bodySchema = z.object({ eventId: z.string().min(1).max(160) });

export async function handleSessionTts(
  req: Request,
  sessionId: string,
  inviteToken?: string | null,
) {
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "bad_request", issues: body.error.format() },
      { status: 400 },
    );
  }

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      campaignId: true,
      campaign: { select: { host: { select: { username: true } } } },
    },
  });
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const event = await prisma.eventLog.findFirst({
    where: { id: body.data.eventId, sessionId },
    select: { id: true, type: true, payload: true, scope: true, ts: true },
  });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const visible = eventForClient(
    {
      id: event.id,
      type: event.type,
      payload: payloadRecord(event.payload),
      scope: event.scope === "dm" ? "dm" : "all",
      ts: event.ts.getTime(),
    },
    access.role,
  );
  if (!visible) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const readable = readableEventFromLog({
    id: visible.id,
    type: visible.type,
    payload: visible.payload,
  });
  if (!readable) {
    return NextResponse.json({ error: "not_readable" }, { status: 400 });
  }

  const vocariumUser = session.campaign.host.username;
  const assignments = await prisma.voiceAssignment.findMany({
    where: {
      campaignId: session.campaignId,
      OR: [
        {
          targetType: readable.target.targetType,
          targetId: readable.target.targetId,
        },
        { targetType: "narrator", targetId: "narrator" },
      ],
    },
    select: {
      targetType: true,
      targetId: true,
      vocariumUser: true,
      voiceId: true,
      voiceName: true,
      voiceSource: true,
    },
  });
  const voice = resolveVoiceForTarget({
    target: readable.target,
    assignments,
    vocariumUser,
  });
  const textHash = sha256(readable.text);

  const cached = await prisma.ttsAudioCache.findFirst({
    where: {
      sessionId,
      eventId: readable.eventId,
      voiceId: voice.voiceId,
      textHash,
    },
    select: {
      id: true,
      status: true,
      mimeType: true,
      byteLength: true,
      voiceId: true,
      error: true,
    },
  });
  if (cached?.status === "ready") {
    return NextResponse.json(readyBody(req, sessionId, inviteToken, cached, voice));
  }
  if (cached?.status === "failed") {
    return NextResponse.json(
      { error: "tts_failed", message: cached.error ?? "TTS failed" },
      { status: 502 },
    );
  }

  try {
    const audio = await synthesizeCloneSpeech({
      vocariumUser,
      voiceId: voice.voiceId,
      text: readable.text,
    });
    const row = await prisma.ttsAudioCache.create({
      data: {
        sessionId,
        eventId: readable.eventId,
        voiceId: voice.voiceId,
        textHash,
        audio: audio.bytes,
        mimeType: audio.mimeType,
        byteLength: audio.bytes.byteLength,
        status: "ready",
      },
      select: {
        id: true,
        status: true,
        mimeType: true,
        byteLength: true,
        voiceId: true,
      },
    });
    return NextResponse.json(readyBody(req, sessionId, inviteToken, row, voice));
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 240) : "unknown";
    await prisma.ttsAudioCache.create({
      data: {
        sessionId,
        eventId: readable.eventId,
        voiceId: voice.voiceId,
        textHash,
        status: "failed",
        byteLength: 0,
        error: message,
      },
    });
    return NextResponse.json(
      { error: "vocarium_failed", message },
      { status: 502 },
    );
  }
}

export async function handleSessionTtsAudio(
  _req: Request,
  sessionId: string,
  cacheId: string,
  inviteToken?: string | null,
) {
  const access = await resolveAccess({ sessionId, inviteToken });
  if (!access) return new Response("forbidden", { status: 403 });

  const cached = await prisma.ttsAudioCache.findFirst({
    where: { id: cacheId, sessionId, status: "ready" },
    select: { audio: true, mimeType: true, byteLength: true },
  });
  if (!cached?.audio) return new Response("not found", { status: 404 });

  return new Response(cached.audio, {
    headers: {
      "content-type": cached.mimeType ?? "audio/wav",
      "content-length": String(cached.byteLength),
      "cache-control": "private, max-age=86400",
    },
  });
}

function readyBody(
  _req: Request,
  sessionId: string,
  inviteToken: string | null | undefined,
  cached: { id: string; mimeType: string | null; byteLength: number },
  voice: { voiceId: string; voiceName: string; vocariumUser: string },
) {
  return {
    status: "ready",
    cacheId: cached.id,
    audioUrl: inviteToken
      ? `/api/invite/sessions/${encodeURIComponent(sessionId)}/tts/${encodeURIComponent(
          cached.id,
        )}/${encodeURIComponent(inviteToken)}`
      : `/api/sessions/${encodeURIComponent(sessionId)}/tts/${encodeURIComponent(
          cached.id,
        )}`,
    mimeType: cached.mimeType,
    byteLength: cached.byteLength,
    voice,
  };
}

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
```

- [ ] **Step 3: Add route wrappers**

Create `src/app/api/sessions/[id]/tts/route.ts`:

```ts
import { handleSessionTts } from "@/lib/tts/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSessionTts(req, id);
}
```

Create `src/app/api/sessions/[id]/tts/[cacheId]/route.ts`:

```ts
import { handleSessionTtsAudio } from "@/lib/tts/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; cacheId: string }> },
) {
  const { id, cacheId } = await params;
  return handleSessionTtsAudio(req, id, cacheId);
}
```

Create `src/app/api/invite/sessions/[id]/tts/[token]/route.ts`:

```ts
import { handleSessionTts } from "@/lib/tts/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await params;
  return handleSessionTts(req, id, token);
}
```

Create `src/app/api/invite/sessions/[id]/tts/[cacheId]/[token]/route.ts`:

```ts
import { handleSessionTtsAudio } from "@/lib/tts/session-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; cacheId: string; token: string }> },
) {
  const { id, cacheId, token } = await params;
  return handleSessionTtsAudio(req, id, cacheId, token);
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
./node_modules/.bin/vitest run src/lib/tts/session-api.test.ts
```

Expected: session TTS tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tts/session-api.ts src/lib/tts/session-api.test.ts src/app/api/sessions src/app/api/invite/sessions
git commit -m "feat: add protected session tts endpoints"
```

---

### Task 5: Browser TTS Playback Infrastructure

**Files:**
- Create: `src/components/game/TtsProvider.tsx`
- Create: `src/components/game/AudioLineButton.tsx`
- Create: `src/components/game/tts-paths.ts`
- Create: `src/components/game/tts-paths.test.ts`
- Modify: `src/components/game/GameRoom.tsx`

**Interfaces:**
- Consumes: `POST /api/sessions/[id]/tts` and invite equivalent from Task 4.
- Produces React hook: `useTtsPlayback()`.
- Produces helper: `ttsPostPath(sessionId, inviteToken?)`.

- [ ] **Step 1: Write path helper tests**

Create `src/components/game/tts-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ttsPostPath } from "./tts-paths";

describe("ttsPostPath", () => {
  it("uses the authenticated session endpoint", () => {
    expect(ttsPostPath("sess_1")).toBe("/api/sessions/sess_1/tts");
  });

  it("uses the invite endpoint when an invite token exists", () => {
    expect(ttsPostPath("sess_1", "tok/with spaces")).toBe(
      "/api/invite/sessions/sess_1/tts/tok%2Fwith%20spaces",
    );
  });
});
```

- [ ] **Step 2: Implement TTS path helper**

Create `src/components/game/tts-paths.ts`:

```ts
export function ttsPostPath(sessionId: string, inviteToken?: string) {
  return inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(sessionId)}/tts/${encodeURIComponent(
        inviteToken,
      )}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/tts`;
}
```

- [ ] **Step 3: Implement the playback provider**

Create `src/components/game/TtsProvider.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ttsPostPath } from "./tts-paths";

type PlaybackStatus = "idle" | "loading" | "playing" | "error";

type TtsContextValue = {
  activeEventId: string | null;
  statusByEventId: Record<string, PlaybackStatus>;
  autoplay: boolean;
  setAutoplay: (value: boolean) => void;
  play: (eventId: string) => Promise<void>;
  stop: () => void;
  toggle: (eventId: string) => Promise<void>;
};

const TtsContext = createContext<TtsContextValue | null>(null);
const AUTOPLAY_KEY = "plum.tts.autoplay.v1";

export function TtsProvider(props: {
  sessionId: string;
  inviteToken?: string;
  children: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [statusByEventId, setStatusByEventId] = useState<
    Record<string, PlaybackStatus>
  >({});
  const [autoplay, setAutoplayState] = useState(false);

  useEffect(() => {
    setAutoplayState(window.localStorage.getItem(AUTOPLAY_KEY) === "true");
  }, []);

  const setAutoplay = useCallback((value: boolean) => {
    setAutoplayState(value);
    window.localStorage.setItem(AUTOPLAY_KEY, value ? "true" : "false");
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setStatusByEventId((state) =>
      activeEventId ? { ...state, [activeEventId]: "idle" } : state,
    );
    setActiveEventId(null);
  }, [activeEventId]);

  const play = useCallback(
    async (eventId: string) => {
      audioRef.current?.pause();
      setActiveEventId(eventId);
      setStatusByEventId((state) => ({ ...state, [eventId]: "loading" }));
      try {
        const response = await fetch(ttsPostPath(props.sessionId, props.inviteToken), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId }),
        });
        if (!response.ok) throw new Error("tts_failed");
        const body = (await response.json()) as { audioUrl: string };
        const audio = new Audio(body.audioUrl);
        audioRef.current = audio;
        audio.onended = () => {
          setStatusByEventId((state) => ({ ...state, [eventId]: "idle" }));
          setActiveEventId(null);
        };
        audio.onerror = () => {
          setStatusByEventId((state) => ({ ...state, [eventId]: "error" }));
          setActiveEventId(null);
        };
        await audio.play();
        setStatusByEventId((state) => ({ ...state, [eventId]: "playing" }));
      } catch {
        setStatusByEventId((state) => ({ ...state, [eventId]: "error" }));
        setActiveEventId(null);
      }
    },
    [props.inviteToken, props.sessionId],
  );

  const toggle = useCallback(
    async (eventId: string) => {
      if (activeEventId === eventId) {
        stop();
        return;
      }
      await play(eventId);
    },
    [activeEventId, play, stop],
  );

  const value = useMemo(
    () => ({
      activeEventId,
      statusByEventId,
      autoplay,
      setAutoplay,
      play,
      stop,
      toggle,
    }),
    [activeEventId, autoplay, play, setAutoplay, statusByEventId, stop, toggle],
  );

  return <TtsContext.Provider value={value}>{props.children}</TtsContext.Provider>;
}

export function useTtsPlayback() {
  const ctx = useContext(TtsContext);
  if (!ctx) throw new Error("useTtsPlayback must be used inside TtsProvider");
  return ctx;
}
```

- [ ] **Step 4: Implement the audio line button**

Create `src/components/game/AudioLineButton.tsx`:

```tsx
"use client";

import { cn } from "@/lib/cn";
import { useTtsPlayback } from "./TtsProvider";

export function AudioLineButton(props: {
  eventId: string;
  className?: string;
  compact?: boolean;
}) {
  const tts = useTtsPlayback();
  const status = tts.statusByEventId[props.eventId] ?? "idle";
  const active = tts.activeEventId === props.eventId;
  const label =
    active && status === "playing"
      ? "Vorlesen stoppen"
      : status === "loading"
        ? "Audio wird geladen"
        : status === "error"
          ? "Audio erneut versuchen"
          : "Vorlesen";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={status === "loading"}
      onClick={() => void tts.toggle(props.eventId)}
      className={cn(
        "inline-flex aspect-square h-7 shrink-0 items-center justify-center rounded-md border border-brass-700/45 bg-ink-600/80 text-brass-300 hover:border-brass-400/70 disabled:cursor-wait disabled:opacity-70",
        status === "error" && "border-blood-500/60 text-blood-500",
        props.className,
      )}
    >
      {status === "loading" ? (
        <span aria-hidden="true" className="text-[10px] leading-none">
          ...
        </span>
      ) : active && status === "playing" ? (
        <StopIcon />
      ) : (
        <PlayIcon />
      )}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
      <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
      <rect x="4" y="4" width="8" height="8" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 5: Wrap GameRoom with TtsProvider**

Modify `src/components/game/GameRoom.tsx`:

```tsx
import { TtsProvider } from "./TtsProvider";
import { VoiceMenu } from "./VoiceMenu";
```

Add `campaignId` to props:

```tsx
campaignId: string;
```

Add menu state:

```tsx
const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
```

Add a header button next to `Journal`:

```tsx
<button
  type="button"
  onClick={() => setVoiceMenuOpen((open) => !open)}
  className="rounded-md border border-brass-700/50 bg-ink-600/70 px-4 py-1.5 text-sm text-brass-300 shadow-lg hover:border-brass-400/70"
>
  Stimmen
</button>
```

Wrap the play surface content:

```tsx
<TtsProvider sessionId={props.sessionId} inviteToken={props.inviteToken}>
  {/* existing stage, drawer, overlays, and ActionBar */}
  {voiceMenuOpen ? (
    <VoiceMenu
      campaignId={props.campaignId}
      sessionId={props.sessionId}
      inviteToken={props.inviteToken}
      role={props.role}
      localCharacters={props.localCharacters ?? []}
      onClose={() => setVoiceMenuOpen(false)}
    />
  ) : null}
</TtsProvider>
```

- [ ] **Step 6: Pass campaignId from the session page**

Modify `src/app/play/_components/PlaySessionRoom.tsx` campaign select:

```ts
campaign: {
  select: {
    id: true,
    title: true,
    theme: true,
    characters: {
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    },
  },
},
```

Pass the prop:

```tsx
<GameRoom
  campaignId={session.campaign.id}
  sessionId={sessionId}
  inviteToken={inviteToken ?? undefined}
  campaignTitle={session.campaign.title}
  campaignTheme={session.campaign.theme}
  role={access.role}
  localCharacters={localCharacters}
/>
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
./node_modules/.bin/vitest run src/components/game/tts-paths.test.ts
```

Expected: path helper tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/game/TtsProvider.tsx src/components/game/AudioLineButton.tsx src/components/game/tts-paths.ts src/components/game/tts-paths.test.ts src/components/game/GameRoom.tsx src/app/play/_components/PlaySessionRoom.tsx
git commit -m "feat: add browser tts playback state"
```

---

### Task 6: In-Game TTS Controls And Voice Menu

**Files:**
- Create: `src/components/game/VoiceMenu.tsx`
- Modify: `src/components/game/CinematicView.tsx`
- Modify: `src/components/game/ChatLog.tsx`
- Modify: `src/components/game/GameRoom.tsx`

**Interfaces:**
- Consumes: `useTtsPlayback`, `AudioLineButton`, voice APIs from Task 3.
- Produces direct play/stop controls on cinematic and chat readable lines, plus the `Stimmen` menu.

- [ ] **Step 1: Create endpoint helpers inside VoiceMenu**

Create `src/components/game/VoiceMenu.tsx` with these request-path helpers at the top:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/lib/game/store";
import { cn } from "@/lib/cn";

type Voice = {
  voiceId: string;
  name: string;
  language: string | null;
  source: "clone";
  vocariumUser: string;
};

type Assignment = {
  targetType: "narrator" | "npc" | "character";
  targetId: string;
  voiceId: string;
  voiceName: string;
};

function voicesPath(input: {
  campaignId: string;
  sessionId: string;
  inviteToken?: string;
}) {
  return input.inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(input.sessionId)}/voices/${encodeURIComponent(
        input.inviteToken,
      )}`
    : `/api/campaigns/${encodeURIComponent(
        input.campaignId,
      )}/voices?sessionId=${encodeURIComponent(input.sessionId)}`;
}

function assignmentsPath(input: {
  campaignId: string;
  sessionId: string;
  inviteToken?: string;
}) {
  return input.inviteToken
    ? `/api/invite/sessions/${encodeURIComponent(
        input.sessionId,
      )}/voice-assignments/${encodeURIComponent(input.inviteToken)}`
    : `/api/campaigns/${encodeURIComponent(
        input.campaignId,
      )}/voice-assignments?sessionId=${encodeURIComponent(input.sessionId)}`;
}
```

- [ ] **Step 2: Implement VoiceMenu body**

Continue `src/components/game/VoiceMenu.tsx`:

```tsx
export function VoiceMenu(props: {
  campaignId: string;
  sessionId: string;
  inviteToken?: string;
  role: "host" | "player";
  localCharacters: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const presentNpcs = useGame((state) => state.scene.presentNpcs ?? []);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(() => {
    const base = props.role === "host"
      ? [{ targetType: "narrator" as const, targetId: "narrator", label: "Erzaehler" }]
      : [];
    const characters = props.localCharacters.map((character) => ({
      targetType: "character" as const,
      targetId: character.id,
      label: character.name,
    }));
    const npcs =
      props.role === "host"
        ? presentNpcs.map((npc) => ({
            targetType: "npc" as const,
            targetId: npc.id,
            label: npc.name,
          }))
        : [];
    return [...base, ...characters, ...npcs];
  }, [presentNpcs, props.localCharacters, props.role]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      const [voiceResponse, assignmentResponse] = await Promise.all([
        fetch(voicesPath(props)),
        fetch(assignmentsPath(props)),
      ]);
      if (!voiceResponse.ok || !assignmentResponse.ok) {
        throw new Error("load_failed");
      }
      const voiceBody = (await voiceResponse.json()) as { voices: Voice[] };
      const assignmentBody = (await assignmentResponse.json()) as {
        assignments: Assignment[];
      };
      if (!cancelled) {
        setVoices(voiceBody.voices);
        setAssignments(assignmentBody.assignments);
      }
    }
    load().catch(() => {
      if (!cancelled) setError("Stimmen konnten nicht geladen werden.");
    });
    return () => {
      cancelled = true;
    };
  }, [props.campaignId, props.inviteToken, props.sessionId]);

  async function saveAssignment(target: {
    targetType: "narrator" | "npc" | "character";
    targetId: string;
  }, voiceId: string) {
    const key = `${target.targetType}:${target.targetId}`;
    setSavingKey(key);
    setError(null);
    try {
      const response = await fetch(assignmentsPath(props), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignments: [{ ...target, voiceId }],
        }),
      });
      if (!response.ok) throw new Error("save_failed");
      const body = (await response.json()) as { assignments: Assignment[] };
      setAssignments((current) => {
        const next = current.filter(
          (assignment) =>
            !body.assignments.some(
              (saved) =>
                saved.targetType === assignment.targetType &&
                saved.targetId === assignment.targetId,
            ),
        );
        return [...next, ...body.assignments];
      });
    } catch {
      setError("Stimme konnte nicht gespeichert werden.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="absolute right-3 top-16 z-40 w-[min(26rem,calc(100%-1.5rem))] border border-brass-700/45 bg-ink-500/95 shadow-2xl">
      <div className="flex items-center justify-between border-b border-brass-700/45 px-4 py-3">
        <div>
          <p className="font-display text-[10px] uppercase tracking-[0.24em] text-brass-400">
            Stimmen
          </p>
          <p className="text-xs text-ink-100">Vocarium Clone-Voices des Hosts</p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-md border border-brass-700/45 bg-ink-600/70 px-3 py-1.5 text-xs text-brass-300 hover:border-brass-400/70"
        >
          Schliessen
        </button>
      </div>

      <div className="max-h-[min(32rem,70vh)] overflow-y-auto px-4 py-3">
        {error ? <p className="mb-3 text-sm text-blood-500">{error}</p> : null}
        {targets.length === 0 ? (
          <p className="text-sm text-ink-100">Keine eigene Figur fuer Stimmen verfuegbar.</p>
        ) : (
          <div className="space-y-3">
            {targets.map((target) => {
              const key = `${target.targetType}:${target.targetId}`;
              const assigned = assignments.find(
                (assignment) =>
                  assignment.targetType === target.targetType &&
                  assignment.targetId === target.targetId,
              );
              return (
                <label key={key} className="block">
                  <span className="mb-1 block truncate font-display text-[10px] uppercase tracking-[0.18em] text-parchment-100">
                    {target.label}
                  </span>
                  <select
                    disabled={savingKey === key}
                    value={assigned?.voiceId ?? ""}
                    onChange={(event) => void saveAssignment(target, event.target.value)}
                    className={cn(
                      "w-full rounded-md border border-brass-700/45 bg-ink-600 px-3 py-2 text-sm text-parchment-100 focus:border-brass-400/70 focus:outline-none",
                      savingKey === key && "opacity-70",
                    )}
                  >
                    <option value="">Default</option>
                    {voices.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add play and autoplay controls to CinematicView**

Modify `src/components/game/CinematicView.tsx`:

```tsx
import { useEffect } from "react";
import { AudioLineButton } from "./AudioLineButton";
import { useTtsPlayback } from "./TtsProvider";
```

Inside `CinematicView`, after `dialogue` is computed:

```tsx
const { autoplay, play, setAutoplay } = useTtsPlayback();

useEffect(() => {
  if (!dialogue || !autoplay) return;
  if (dialogue.kind === "player") return;
  void play(dialogue.id);
}, [autoplay, dialogue?.id, dialogue?.kind, play]);
```

Replace the nameplate contents with a flex row:

```tsx
<div className="renpy-nameplate absolute -top-3 left-4 flex max-w-[calc(100%-2rem)] items-center gap-2 px-2 py-1.5 sm:left-6">
  <AudioLineButton eventId={dialogue.id} className="h-6" />
  <span className="truncate font-display text-xs uppercase tracking-[0.22em] text-parchment-50">
    {dialogue.speakerLabel}
  </span>
  {dialogue.mood ? (
    <span className="font-serif text-xs italic text-brass-300">
      {dialogue.mood}
    </span>
  ) : null}
  {dialogue.kind !== "player" ? (
    <button
      type="button"
      onClick={() => setAutoplay(!autoplay)}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
        autoplay
          ? "border-brass-400/70 bg-brass-700/35 text-parchment-100"
          : "border-brass-700/45 bg-ink-600/80 text-brass-300",
      )}
    >
      Auto
    </button>
  ) : null}
</div>
```

- [ ] **Step 4: Add play buttons to ChatLog readable lines**

Modify `src/components/game/ChatLog.tsx`:

```tsx
import { AudioLineButton } from "./AudioLineButton";
```

For `narrate`, update the nameplate:

```tsx
<div className="renpy-log-nameplate absolute -top-2 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 px-2 py-0.5">
  <AudioLineButton eventId={line.id} className="h-5" />
  <span className="truncate font-display text-[10px] uppercase tracking-[0.22em] text-parchment-50">
    {speaker.label}
  </span>
  {speaker.mood ? (
    <span className="font-serif text-[11px] italic text-brass-300">
      {speaker.mood}
    </span>
  ) : null}
</div>
```

For `player`, update the nameplate similarly:

```tsx
<div className="renpy-log-nameplate absolute -top-2 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 px-2 py-0.5">
  <AudioLineButton eventId={line.id} className="h-5" />
  <span className="truncate font-display text-[10px] uppercase tracking-[0.22em] text-arcane-400">
    {line.displayName}
  </span>
</div>
```

- [ ] **Step 5: Run UI-oriented verification commands**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both complete with 0 errors and 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/components/game/VoiceMenu.tsx src/components/game/CinematicView.tsx src/components/game/ChatLog.tsx src/components/game/GameRoom.tsx
git commit -m "feat: add tts controls to game room"
```

---

### Task 7: Documentation, Full Verification, And Manual Vocarium Smoke

**Files:**
- Modify: `docs/ops.md`

**Interfaces:**
- Consumes: complete implementation from Tasks 1-6.
- Produces operator notes for Vocarium config, host-tenant voice listing, and manual smoke verification.

- [ ] **Step 1: Add ops notes**

Append this section to `docs/ops.md`:

````markdown
## Vocarium TTS

Set `VOCARIUM_API_URL` to the Vocarium gateway reachable from the `dnd-web`
container. The TTS integration always sends `Remote-User` as the campaign
host username, so host `zwaetschge` loads clone voices such as `Michael Scott`
and `Maurice Moss`; the default `api` tenant will not show those voices.

Voice catalog smoke:

```bash
VOCARIUM_USER=zwaetschge \
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py voices --source clone
```

Before any live generation smoke, check Vocarium resources:

```bash
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py health
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py preflight --kind tts
```

If preflight allows TTS, generate one short manual sample:

```bash
VOCARIUM_USER=zwaetschge \
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py \
  tts --source clone --voice 2abffe14 --text "Kurzer Test." --out /tmp/plum-tts-smoke.wav
```

The application does not run live Vocarium generation in CI.
````

- [ ] **Step 2: Run the automated test suite**

Run:

```bash
./node_modules/.bin/vitest run
```

Expected: all Vitest tests pass. Use this direct binary locally because `npx vitest` can pull the wrong cached major version.

- [ ] **Step 3: Run lint and typecheck**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: 0 warnings, 0 errors.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: Next.js build completes and route list includes the new TTS and voice routes:

```text
/api/campaigns/[id]/voices
/api/campaigns/[id]/voice-assignments
/api/sessions/[id]/tts
/api/sessions/[id]/tts/[cacheId]
/api/invite/sessions/[id]/voices/[token]
/api/invite/sessions/[id]/voice-assignments/[token]
/api/invite/sessions/[id]/tts/[token]
/api/invite/sessions/[id]/tts/[cacheId]/[token]
```

- [ ] **Step 5: Run the non-generative Vocarium catalog smoke**

Run:

```bash
VOCARIUM_USER=zwaetschge \
python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py voices --source clone
```

Expected: output contains voices with `voice_id` values `83b59aca` for `Michael Scott` and `2abffe14` for `Maurice Moss`.

- [ ] **Step 6: Run a manual in-app smoke against a real session**

With a real session open:

1. Open the `Stimmen` menu.
2. Assign `Maurice Moss` to a present NPC or `Rufus Beck` to `Erzaehler`.
3. Click a play button in the cinematic dialogue or chat log.
4. Confirm the first click creates a `TtsAudioCache` row with `status = 'ready'`.
5. Click the same line again and confirm no new Vocarium request is made.
6. Toggle `Auto`, trigger a new NPC/DM narration line, and confirm audio starts only for the local browser where `Auto` is enabled.

Useful DB check:

```bash
docker compose exec postgres psql -U dnd -d dnd \
  -c "SELECT \"eventId\", \"voiceId\", \"status\", \"byteLength\" FROM \"TtsAudioCache\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

- [ ] **Step 7: Commit docs and final verification fixes**

```bash
git add docs/ops.md
git commit -m "docs: add vocarium tts operations notes"
```

---

## Final Acceptance Checklist

- [ ] `npx prisma generate` succeeds.
- [ ] `./node_modules/.bin/vitest run` succeeds.
- [ ] `npm run lint` succeeds with 0 warnings.
- [ ] `npm run typecheck` succeeds.
- [ ] `npm run build` succeeds.
- [ ] `GET /api/campaigns/[id]/voices?sessionId=<session>` returns host clone voices for authenticated users.
- [ ] `GET /api/invite/sessions/[id]/voices/[token]` returns host clone voices for invite guests.
- [ ] `PUT /api/campaigns/[id]/voice-assignments?sessionId=<session>` lets the host set narrator/NPC/character voices.
- [ ] Player assignment attempts are limited to the player's own character.
- [ ] `POST /api/sessions/[id]/tts` creates one ready cache row for a readable event and reuses it on repeated play.
- [ ] `GET /api/sessions/[id]/tts/[cacheId]` streams audio only after session access passes.
- [ ] Cinematic and ChatLog play buttons show idle, loading, playing, and error states without hiding the text.
- [ ] `Auto` is off by default, local to the browser, and only autoplays new non-player dialogue lines.
- [ ] The manual `VOCARIUM_USER=zwaetschge python3 ~/.claude/skills/vocarium-audio-api/scripts/vocarium_audio.py voices --source clone` smoke shows `Michael Scott` and `Maurice Moss`.
