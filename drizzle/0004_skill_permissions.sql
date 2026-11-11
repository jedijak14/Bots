ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "bot_id" uuid REFERENCES "bots"("id") ON DELETE CASCADE;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "allowed_tools" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "allowed_connectors" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS "skills_bot_idx" ON "skills" ("bot_id", "created_at");
UPDATE "skills" SET "allowed_tools" = '["save_artifact","draft_email","search_gmail","search_youtube","search_notion","list_github_repositories","list_vercel_projects","list_saved_spotify_tracks","get_current_time","run_command","web_search","fetch_page","open_url","write_file","read_file","click","type_text","press_key"]'::jsonb, "allowed_connectors" = '["google","github","notion","vercel","spotify"]'::jsonb WHERE "allowed_tools" = '[]'::jsonb AND "allowed_connectors" = '[]'::jsonb;
