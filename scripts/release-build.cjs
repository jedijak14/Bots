// One-time deployment helper: only the explicitly marked preview commit may
// migrate. Production builds and all normal previews execute only next build.
const { spawnSync } = require('node:child_process');
async function main() {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_MESSAGE?.startsWith('Run controlled release migration')) {
    const { Pool } = require('pg');
    const { drizzle } = require('drizzle-orm/node-postgres');
    const { migrate } = require('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const pre = await pool.query("SELECT to_regclass('public.bots') AS bots, to_regclass('drizzle.__drizzle_migrations') AS journal");
      if (!pre.rows[0].bots || !pre.rows[0].journal) throw new Error('Existing bot tables or migration journal not found; stopped without changes.');
      const last = await pool.query('SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1');
      const timestamp = Number(last.rows[0]?.created_at || 0);
      if (timestamp < 1794249798489 || timestamp > 1794325180778) throw new Error('Unexpected migration history; stopped without changes.');
      await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
      const check = await pool.query("SELECT to_regclass('public.skills') AS skills, to_regclass('public.connections') AS connections, to_regclass('public.email_drafts') AS drafts, to_regclass('public.oauth_states') AS states, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='archived_at') AS archived, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='oauth_states' AND column_name='return_path') AS return_path");
      if (Object.values(check.rows[0]).some(v => !v)) throw new Error('Schema verification failed.');
      console.log('BOTS_MIGRATIONS_VERIFIED');
    } finally { await pool.end(); }
  }
  const result = spawnSync('next', ['build'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
main().catch(e => { const safe = ['Existing bot tables or migration journal not found; stopped without changes.', 'Unexpected migration history; stopped without changes.', 'Schema verification failed.']; console.error('Migration failed:', safe.includes(e.message) ? e.message : 'database migration error'); process.exit(1); });
