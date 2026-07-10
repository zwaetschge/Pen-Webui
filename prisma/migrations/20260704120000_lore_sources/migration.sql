CREATE TYPE "LoreSourceKind" AS ENUM ('upload', 'web_research');
CREATE TYPE "LoreSourceStatus" AS ENUM ('ready', 'failed');

ALTER TABLE "CampaignWorld"
  ADD COLUMN "loreBible" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE "CampaignLoreSource" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "campaignId"  TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "kind"        "LoreSourceKind" NOT NULL,
  "status"      "LoreSourceStatus" NOT NULL DEFAULT 'ready',
  "title"       TEXT NOT NULL,
  "sourceUrl"   TEXT,
  "contentHash" TEXT NOT NULL,
  "rawText"     TEXT,
  "summary"     TEXT NOT NULL,
  "facts"       JSONB NOT NULL DEFAULT '[]'::jsonb,
  "citations"   JSONB NOT NULL DEFAULT '[]'::jsonb,
  "errorMsg"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CampaignLoreSource_campaignId_kind_idx"
  ON "CampaignLoreSource"("campaignId", "kind");

CREATE INDEX "CampaignLoreSource_contentHash_idx"
  ON "CampaignLoreSource"("contentHash");
