import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ensureSchema } from "./bootstrap";

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

// Kick off schema provisioning on first import. It is idempotent and runs in the
// background; routes that cannot work without a table await `schemaReady`.
export const schemaReady = ensureSchema(pool);

export const db = drizzle(pool);

/**
 * Kept for the email settings route: the columns it needs are part of the
 * schema bootstrap, so this simply waits for that.
 */
export function ensureEmailColumns(): Promise<void> {
  // The full bootstrap already adds these, and is idempotent; keeping the old
  // entry point means call sites did not have to change.
  return schemaReady;
}
