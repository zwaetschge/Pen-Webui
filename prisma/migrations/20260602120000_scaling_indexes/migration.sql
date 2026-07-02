-- Composite indexes for high-frequency session replay, DM turns, and access checks.

CREATE INDEX "Character_campaignId_createdAt_idx"
  ON "Character"("campaignId", "createdAt");

CREATE INDEX "NPC_campaignId_visibility_updatedAt_idx"
  ON "NPC"("campaignId", "visibility", "updatedAt");

CREATE INDEX "Location_campaignId_name_idx"
  ON "Location"("campaignId", "name");

CREATE INDEX "Encounter_campaignId_status_updatedAt_idx"
  ON "Encounter"("campaignId", "status", "updatedAt");

CREATE INDEX "SessionMember_sessionId_userId_idx"
  ON "SessionMember"("sessionId", "userId");

CREATE INDEX "SessionMember_sessionId_inviteId_idx"
  ON "SessionMember"("sessionId", "inviteId");

CREATE INDEX "EventLog_sessionId_type_ts_id_idx"
  ON "EventLog"("sessionId", "type", "ts", "id");
