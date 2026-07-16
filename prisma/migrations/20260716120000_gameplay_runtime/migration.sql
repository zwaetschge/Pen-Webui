-- Versioned runtime envelopes for systemic combat and party play.
-- JSONB keeps the first playable slice compact while every envelope carries
-- an explicit version and is validated by the application before use.
ALTER TABLE "CampaignWorld"
  ADD COLUMN "gameState" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "Character"
  ADD COLUMN "runtime" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "Encounter"
  ADD COLUMN "runtime" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "GameSession"
  ADD COLUMN "runtime" JSONB NOT NULL DEFAULT '{}'::jsonb;
