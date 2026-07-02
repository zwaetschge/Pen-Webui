-- Plum Tabletop — initial schema
-- Generated to match prisma/schema.prisma (Prisma 5.22).
-- Postgres extensions (also enforced by scripts/db-init.sql for fresh installs).

CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ───── enums ────────────────────────────────────────────────────────────
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'generating', 'ready', 'playing', 'archived');
CREATE TYPE "AssetKind" AS ENUM (
  'npc_portrait', 'npc_token', 'character_portrait', 'character_token',
  'location_background', 'location_tactical_map', 'item_icon',
  'scene_keyframe', 'custom'
);
CREATE TYPE "AssetStatus" AS ENUM ('pending', 'queued', 'generating', 'ready', 'failed');
CREATE TYPE "SceneType" AS ENUM ('intro', 'exploration', 'social', 'combat', 'rest', 'cutscene', 'outro');
CREATE TYPE "EncounterStatus" AS ENUM ('prepared', 'active', 'resolved', 'fled');
CREATE TYPE "SRDType" AS ENUM (
  'spell', 'monster', 'rule', 'item', 'class', 'race',
  'background', 'feat', 'condition', 'feature'
);

-- ───── User ─────────────────────────────────────────────────────────────
CREATE TABLE "User" (
  "id"           TEXT PRIMARY KEY,
  "username"     CITEXT NOT NULL UNIQUE,
  "email"        CITEXT UNIQUE,
  "displayName"  TEXT,
  "isDM"         BOOLEAN NOT NULL DEFAULT FALSE,
  "encOpenAIKey" BYTEA,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "lastSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ───── Campaign ────────────────────────────────────────────────────────
CREATE TABLE "Campaign" (
  "id"                   TEXT PRIMARY KEY,
  "hostId"               TEXT NOT NULL REFERENCES "User"("id"),
  "title"                TEXT NOT NULL,
  "theme"                TEXT NOT NULL,
  "tone"                 TEXT,
  "systemPromptOverride" TEXT,
  "status"               "CampaignStatus" NOT NULL DEFAULT 'draft',
  "styleSuffix"          TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Campaign_hostId_idx" ON "Campaign"("hostId");
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- ───── CampaignWorld ────────────────────────────────────────────────────
CREATE TABLE "CampaignWorld" (
  "campaignId" TEXT PRIMARY KEY REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "plot"       JSONB NOT NULL,
  "factions"   JSONB NOT NULL DEFAULT '[]',
  "worldFacts" JSONB NOT NULL DEFAULT '[]',
  "threads"    JSONB NOT NULL DEFAULT '[]',
  "updatedAt"  TIMESTAMP(3) NOT NULL
);

-- ───── Asset (defined before Character/NPC/Location/Item because they FK into it) ───
CREATE TABLE "Asset" (
  "id"             TEXT PRIMARY KEY,
  "campaignId"     TEXT REFERENCES "Campaign"("id") ON DELETE SET NULL,
  "kind"           "AssetKind" NOT NULL,
  "status"         "AssetStatus" NOT NULL DEFAULT 'pending',
  "prompt"         TEXT NOT NULL,
  "negativePrompt" TEXT,
  "backend"        TEXT,
  "s3Key"          TEXT,
  "url"            TEXT,
  "width"          INTEGER,
  "height"         INTEGER,
  "errorMsg"       TEXT,
  "jobId"          TEXT,
  "meta"           JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedAt"    TIMESTAMP(3)
);
CREATE INDEX "Asset_campaignId_kind_idx" ON "Asset"("campaignId", "kind");
CREATE INDEX "Asset_status_idx"          ON "Asset"("status");

-- ───── Character ────────────────────────────────────────────────────────
CREATE TABLE "Character" (
  "id"               TEXT PRIMARY KEY,
  "campaignId"       TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "ownerId"          TEXT NOT NULL REFERENCES "User"("id"),
  "name"             TEXT NOT NULL,
  "sheet"            JSONB NOT NULL,
  "tokenAssetId"     TEXT REFERENCES "Asset"("id"),
  "portraitAssetId"  TEXT REFERENCES "Asset"("id"),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Character_campaignId_idx" ON "Character"("campaignId");
CREATE INDEX "Character_ownerId_idx"    ON "Character"("ownerId");

-- ───── NPC ──────────────────────────────────────────────────────────────
CREATE TABLE "NPC" (
  "id"              TEXT PRIMARY KEY,
  "campaignId"      TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "role"            TEXT,
  "description"     TEXT,
  "sheet"           JSONB NOT NULL,
  "portraitAssetId" TEXT REFERENCES "Asset"("id"),
  "tokenAssetId"    TEXT REFERENCES "Asset"("id"),
  "visibility"      TEXT NOT NULL DEFAULT 'hidden',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE INDEX "NPC_campaignId_idx" ON "NPC"("campaignId");

-- ───── Location ─────────────────────────────────────────────────────────
CREATE TABLE "Location" (
  "id"                  TEXT PRIMARY KEY,
  "campaignId"          TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "ambience"            TEXT,
  "backgroundAssetId"   TEXT REFERENCES "Asset"("id"),
  "tacticalMapAssetId"  TEXT REFERENCES "Asset"("id"),
  "gridConfig"          JSONB,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Location_campaignId_idx" ON "Location"("campaignId");

-- ───── Item ─────────────────────────────────────────────────────────────
CREATE TABLE "Item" (
  "id"          TEXT PRIMARY KEY,
  "campaignId"  TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "data"        JSONB NOT NULL,
  "iconAssetId" TEXT REFERENCES "Asset"("id"),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Item_campaignId_idx" ON "Item"("campaignId");

-- ───── Scene ────────────────────────────────────────────────────────────
CREATE TABLE "Scene" (
  "id"         TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "order"      INTEGER NOT NULL,
  "type"       "SceneType" NOT NULL,
  "title"      TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "visited"    BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Scene_campaignId_order_unique" UNIQUE ("campaignId", "order")
);
CREATE INDEX "Scene_campaignId_idx" ON "Scene"("campaignId");

-- ───── Encounter ───────────────────────────────────────────────────────
CREATE TABLE "Encounter" (
  "id"         TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "name"       TEXT NOT NULL,
  "monsters"   JSONB NOT NULL,
  "initiative" JSONB NOT NULL DEFAULT '[]',
  "status"     "EncounterStatus" NOT NULL DEFAULT 'prepared',
  "locationId" TEXT,
  "round"      INTEGER NOT NULL DEFAULT 0,
  "activeTurn" INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Encounter_campaignId_idx" ON "Encounter"("campaignId");

-- ───── GameSession ─────────────────────────────────────────────────────
CREATE TABLE "GameSession" (
  "id"         TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"    TIMESTAMP(3),
  "summary"    TEXT
);
CREATE INDEX "GameSession_campaignId_idx" ON "GameSession"("campaignId");

-- ───── SessionMember ───────────────────────────────────────────────────
CREATE TABLE "SessionMember" (
  "id"          TEXT PRIMARY KEY,
  "sessionId"   TEXT NOT NULL REFERENCES "GameSession"("id") ON DELETE CASCADE,
  "userId"      TEXT REFERENCES "User"("id"),
  "inviteId"    TEXT,
  "displayName" TEXT NOT NULL,
  "characterId" TEXT,
  "joinedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt"      TIMESTAMP(3)
);
CREATE INDEX "SessionMember_sessionId_idx" ON "SessionMember"("sessionId");
CREATE INDEX "SessionMember_userId_idx"    ON "SessionMember"("userId");

-- ───── EventLog ────────────────────────────────────────────────────────
CREATE TABLE "EventLog" (
  "id"        TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL REFERENCES "GameSession"("id") ON DELETE CASCADE,
  "actorId"   TEXT REFERENCES "User"("id"),
  "type"      TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "ts"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EventLog_sessionId_ts_idx" ON "EventLog"("sessionId", "ts");
CREATE INDEX "EventLog_type_idx"         ON "EventLog"("type");

-- ───── Invite ──────────────────────────────────────────────────────────
CREATE TABLE "Invite" (
  "id"          TEXT PRIMARY KEY,
  "campaignId"  TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "issuedById"  TEXT NOT NULL REFERENCES "User"("id"),
  "code"        TEXT NOT NULL UNIQUE,
  "displayName" TEXT,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "usedAt"      TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Invite_campaignId_idx" ON "Invite"("campaignId");

-- ───── SRDChunk ────────────────────────────────────────────────────────
CREATE TABLE "SRDChunk" (
  "id"        TEXT PRIMARY KEY,
  "type"      "SRDType" NOT NULL,
  "name"      TEXT NOT NULL,
  "slug"      TEXT NOT NULL UNIQUE,
  "source"    TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "data"      JSONB,
  "embedding" halfvec(3072),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SRDChunk_type_idx" ON "SRDChunk"("type");
CREATE INDEX "SRDChunk_name_idx" ON "SRDChunk"("name");

-- HNSW + trigram indexes for hybrid search (also recreated idempotently by
-- scripts/sync-srd.ts so it works on a fresh DB without this migration).
CREATE INDEX IF NOT EXISTS "srd_embedding_idx"
  ON "SRDChunk" USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX IF NOT EXISTS "srd_name_trgm_idx"
  ON "SRDChunk" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "srd_content_trgm_idx"
  ON "SRDChunk" USING gin (content gin_trgm_ops);
