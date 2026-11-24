/**
 * Schema provisioning at runtime.
 *
 * Drizzle migrations are the source of truth, but nothing applied them at
 * runtime — the deploy is just `next build`. A database that had not had the
 * newest SQL run against it therefore turned every page that touched a newer
 * table into "relation does not exist", which is the error people saw when a
 * site was freshly opened after a schema change.
 *
 * This runs once per process, before the first query that needs it, and is
 * written to be safe on an already-migrated database: every statement is
 * `IF NOT EXISTS`. When the database itself is unreachable it remembers that
 * and stops trying, so an outage produces a normal error page rather than a
 * connection attempt on every request.
 */
import type { Pool } from "pg";

/** Column definitions used by the additive column pass below. */
type ColumnAlter = { table: string; column: string; definition: string };

const CREATE_TABLES = `
create table if not exists users (
  id uuid primary key default gen_random_uuid() not null,
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  avatar_url text,
  created_at timestamp with time zone default now() not null
);

create table if not exists sessions (
  id text primary key not null,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);
create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists user_settings (
  user_id uuid primary key not null references users(id) on delete cascade,
  ai_key_enc text,
  ai_key_hint text,
  ai_provider text,
  ai_provider_mode text default 'auto' not null,
  ai_base_url text,
  default_model text,
  e2b_key_enc text,
  e2b_key_hint text,
  follow_mouse boolean default true not null,
  animations boolean default true not null,
  voice_replies boolean default false not null,
  theme text default 'dark' not null,
  smtp_user text,
  smtp_pass_enc text,
  smtp_host text,
  smtp_port integer,
  smtp_from text,
  updated_at timestamp with time zone default now() not null
);

create table if not exists bots (
  id uuid primary key default gen_random_uuid() not null,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  shape text default 'circle' not null,
  color text default 'blue' not null,
  instructions text default '' not null,
  model text,
  sandbox_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create index if not exists bots_user_idx on bots (user_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid() not null,
  bot_id uuid not null references bots(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  content text default '' not null,
  steps jsonb,
  choices jsonb,
  created_at timestamp with time zone default now() not null
);
create index if not exists messages_bot_idx on messages (bot_id, created_at);
create index if not exists messages_user_idx on messages (user_id);

create table if not exists goals (
  id uuid primary key default gen_random_uuid() not null,
  user_id uuid not null references users(id) on delete cascade,
  bot_id uuid references bots(id) on delete set null,
  title text not null,
  detail text default '' not null,
  status text default 'open' not null,
  due_at timestamp with time zone,
  done_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create index if not exists goals_user_idx on goals (user_id, created_at);

create table if not exists conversation_archives (
  id uuid primary key default gen_random_uuid() not null,
  bot_id uuid not null references bots(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text default 'Archived conversation' not null,
  messages jsonb not null,
  created_at timestamp with time zone default now() not null
);
create index if not exists conversation_archives_user_idx on conversation_archives (user_id, created_at);
create index if not exists conversation_archives_bot_idx on conversation_archives (bot_id, created_at);

create table if not exists artifacts (
  id uuid primary key default gen_random_uuid() not null,
  bot_id uuid not null references bots(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  kind text default 'document' not null,
  content text default '' not null,
  archived boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists skills (
  id uuid primary key default gen_random_uuid() not null,
  user_id uuid not null references users(id) on delete cascade,
  bot_id uuid references bots(id) on delete cascade,
  name text not null,
  instructions text default '' not null,
  allowed_tools jsonb default '[]'::jsonb not null,
  allowed_connectors jsonb default '[]'::jsonb not null,
  version integer default 1 not null,
  enabled boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create index if not exists skills_user_idx on skills (user_id, created_at);
create index if not exists skills_bot_idx on skills (bot_id, created_at);

create table if not exists privacy_sessions (
  id uuid primary key default gen_random_uuid() not null,
  user_id uuid not null references users(id) on delete cascade,
  bot_id uuid references bots(id) on delete cascade,
  sandbox_id text,
  status text default 'idle' not null,
  created_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone
);
create index if not exists privacy_sessions_user_idx on privacy_sessions (user_id, created_at);

create table if not exists privacy_audit_events (
  id uuid primary key default gen_random_uuid() not null,
  user_id uuid not null references users(id) on delete cascade,
  bot_id uuid references bots(id) on delete set null,
  action text not null,
  created_at timestamp with time zone default now() not null
);
create index if not exists privacy_audit_events_user_idx on privacy_audit_events (user_id, created_at);
`;

/**
 * Columns and constraints added after a table first shipped. `CREATE TABLE IF
 * NOT EXISTS` does nothing to a table that already exists, so these carry the
 * later additions for a database that was created by an older release.
 */
const ALTER_COLUMNS: ColumnAlter[] = [
  { table: "users", column: "avatar_url", definition: "text" },
  { table: "user_settings", column: "ai_provider_mode", definition: "text default 'auto' not null" },
  { table: "user_settings", column: "ai_base_url", definition: "text" },
  { table: "user_settings", column: "default_model", definition: "text" },
  { table: "user_settings", column: "e2b_key_enc", definition: "text" },
  { table: "user_settings", column: "e2b_key_hint", definition: "text" },
  { table: "user_settings", column: "follow_mouse", definition: "boolean default true not null" },
  { table: "user_settings", column: "animations", definition: "boolean default true not null" },
  { table: "user_settings", column: "voice_replies", definition: "boolean default false not null" },
  { table: "user_settings", column: "theme", definition: "text default 'dark' not null" },
  { table: "user_settings", column: "smtp_user", definition: "text" },
  { table: "user_settings", column: "smtp_pass_enc", definition: "text" },
  { table: "user_settings", column: "smtp_host", definition: "text" },
  { table: "user_settings", column: "smtp_port", definition: "integer" },
  { table: "user_settings", column: "smtp_from", definition: "text" },
  { table: "bots", column: "model", definition: "text" },
  { table: "bots", column: "sandbox_id", definition: "text" },
  { table: "messages", column: "steps", definition: "jsonb" },
  { table: "messages", column: "choices", definition: "jsonb" },
  { table: "skills", column: "allowed_tools", definition: "jsonb default '[]'::jsonb not null" },
  { table: "skills", column: "allowed_connectors", definition: "jsonb default '[]'::jsonb not null" },
  { table: "skills", column: "version", definition: "integer default 1 not null" },
  { table: "skills", column: "enabled", definition: "boolean default true not null" },
  { table: "privacy_sessions", column: "sandbox_id", definition: "text" },
  { table: "privacy_sessions", column: "ended_at", definition: "timestamp with time zone" },
];

let bootstrap: Promise<void> | null = null;

async function run(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // `gen_random_uuid()` is built in from Postgres 13; older servers need
    // pgcrypto. It is optional: a managed database may not offer the extension,
    // and failing to create it must not stop the tables from being created.
    await client.query("savepoint ext").catch(() => undefined);
    await client
      .query("create extension if not exists pgcrypto")
      .catch((error) => console.warn("[db] pgcrypto unavailable:", error instanceof Error ? error.message : error));
    await client.query("begin");
    await client.query(CREATE_TABLES);
    for (const { table, column, definition } of ALTER_COLUMNS) {
      await client.query(`alter table ${table} add column if not exists ${column} ${definition}`);
    }
    // Foreign keys the additive tables reference, added only when missing so a
    // database from an older release picks them up.
    await client.query(`
      do $$
      begin
        if not exists (select 1 from pg_constraint where conname = 'artifacts_bot_id_bots_id_fk') then
          begin
            alter table artifacts add constraint artifacts_bot_id_bots_id_fk
              foreign key (bot_id) references bots(id) on delete cascade;
          exception when others then null;
          end;
        end if;
        if not exists (select 1 from pg_constraint where conname = 'artifacts_user_id_users_id_fk') then
          begin
            alter table artifacts add constraint artifacts_user_id_users_id_fk
              foreign key (user_id) references users(id) on delete cascade;
          exception when others then null;
          end;
        end if;
      end
      $$;
    `);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Makes sure every table the app queries exists. Resolves immediately on later
 * calls in the same process. If the database is unreachable the promise still
 * resolves — the query that follows fails on its own, and retrying DDL on every
 * request during an outage would only add load.
 */
export function ensureSchema(pool: Pool): Promise<void> {
  bootstrap ??= run(pool).catch((error) => {
    console.error("[db] schema bootstrap skipped:", error instanceof Error ? error.message : error);
  });
  return bootstrap;
}
