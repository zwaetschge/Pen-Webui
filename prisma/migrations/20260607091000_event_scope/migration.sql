ALTER TABLE "EventLog"
  ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'all';

CREATE INDEX IF NOT EXISTS "EventLog_sessionId_scope_ts_idx"
  ON "EventLog" ("sessionId", "scope", "ts");
