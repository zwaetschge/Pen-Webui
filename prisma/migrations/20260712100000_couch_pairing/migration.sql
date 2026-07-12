ALTER TABLE "Invite" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "Invite" ADD COLUMN "characterId" TEXT;

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Invite_sessionId_idx" ON "Invite"("sessionId");
CREATE INDEX "Invite_sessionId_characterId_idx"
  ON "Invite"("sessionId", "characterId");
CREATE INDEX "SessionMember_sessionId_characterId_idx"
  ON "SessionMember"("sessionId", "characterId");

-- One phone may actively control a character in a session. Historical members
-- remain available after re-pairing because rows with leftAt are excluded.
CREATE UNIQUE INDEX "SessionMember_active_character_unique"
  ON "SessionMember"("sessionId", "characterId")
  WHERE "characterId" IS NOT NULL AND "leftAt" IS NULL;
