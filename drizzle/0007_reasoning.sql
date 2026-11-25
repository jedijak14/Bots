-- Reasoning level for OptiLLM. Off by default: every level above it spends more
-- of the user's own tokens, so it is opt-in rather than presumed.
ALTER TABLE "user_settings" ADD COLUMN "reasoning" text DEFAULT 'off' NOT NULL;
