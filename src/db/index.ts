import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

// `next build` collects page data, which imports this module without a database
// attached. Let the build through and fail at query time instead; a missing URL
// anywhere else is a genuine misconfiguration.
if (!databaseUrl && process.env.NEXT_PHASE !== "phase-production-build") {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl ?? "postgres://postgres:postgres@127.0.0.1:5432/bots",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

/**
 * Columns added after the first deploy. Drizzle migrations are the source of
 * truth, but a deployment can be running against a database that has not had the
 * newest SQL applied yet, and one missing column would take the whole Settings
 * page down. `ADD COLUMN IF NOT EXISTS` is cheap, idempotent and runs once per
 * process, so the feature that needs these columns brings them with it.
 */
let emailColumns: Promise<void> | null = null;
export function ensureEmailColumns(): Promise<void> {
  emailColumns ??= pool
    .query(
      `alter table user_settings add column if not exists smtp_user text;
       alter table user_settings add column if not exists smtp_pass_enc text;
       alter table user_settings add column if not exists smtp_host text;
       alter table user_settings add column if not exists smtp_port integer;
       alter table user_settings add column if not exists smtp_from text;`,
    )
    .then(() => undefined)
    .catch(() => undefined);
  return emailColumns;
}
