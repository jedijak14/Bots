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

/**
 * A pool that survives its connections dying.
 *
 * `pg` re-emits a dropped socket as an `'error'` event on the pool, and Node
 * turns an unhandled `'error'` into a crash — so a server restart, a network
 * blip, or a database that refuses one connection out of many took the whole
 * page down with "Connection terminated unexpectedly". The handler below makes
 * that a logged warning instead: the dead client is discarded and the next
 * query opens a fresh one.
 *
 * The limits are deliberately smaller than the database's own ceiling. A
 * serverless deployment runs one of these per instance, and it is better to
 * queue briefly inside the pool than to be refused by the server.
 */
function createPool(): Pool {
  const created = new Pool({
    connectionString: databaseUrl ?? "postgres://postgres:postgres@127.0.0.1:5432/bots",
    max: Number(process.env.DB_POOL_MAX) || 8,
    idleTimeoutMillis: 30_000,
    // Give up on a truly unreachable host instead of hanging a render.
    connectionTimeoutMillis: 10_000,
    // Recycle clients periodically so a long-lived instance cannot hold a
    // stale socket forever.
    maxLifetimeSeconds: 60 * 30,
    keepAlive: true,
  });

  // Idle clients dying is normal (the server closed them); it must not throw.
  created.on("error", (error) => {
    console.warn("[db] idle client error (pool will reconnect):", error instanceof Error ? error.message : error);
  });

  return created;
}

export const pool = globalForDb.__arenaNextJsPostgresqlPool ?? createPool();

// Reuse the pool across hot reloads in development and across route module
// instances in production, so a request never pays for a new connection.
if (!globalForDb.__arenaNextJsPostgresqlPool) {
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
