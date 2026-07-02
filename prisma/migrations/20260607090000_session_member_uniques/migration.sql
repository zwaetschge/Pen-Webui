CREATE UNIQUE INDEX IF NOT EXISTS "SessionMember_session_user_unique"
  ON "SessionMember" ("sessionId", "userId")
  WHERE "userId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "SessionMember_session_invite_unique"
  ON "SessionMember" ("sessionId", "inviteId")
  WHERE "inviteId" IS NOT NULL;
