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
