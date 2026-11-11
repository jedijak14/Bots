CREATE TABLE IF NOT EXISTS "privacy_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "bot_id" uuid REFERENCES "bots"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "privacy_audit_events_user_idx" ON "privacy_audit_events" ("user_id", "created_at");

ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "archived" boolean NOT NULL DEFAULT false;
