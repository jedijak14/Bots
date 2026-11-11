CREATE TABLE IF NOT EXISTS "conversation_archives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bot_id" uuid NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL DEFAULT 'Archived conversation',
  "messages" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "conversation_archives_user_idx" ON "conversation_archives" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "conversation_archives_bot_idx" ON "conversation_archives" ("bot_id", "created_at");

CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bot_id" uuid NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'document',
  "content" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "artifacts_user_idx" ON "artifacts" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "privacy_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "bot_id" uuid REFERENCES "bots"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'idle',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "privacy_sessions_user_idx" ON "privacy_sessions" ("user_id", "created_at");

ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
