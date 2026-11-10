// One-time release helper; only the marked preview commit can change the schema.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
async function migrateRelease() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(817291232)');
    const pre = await client.query("SELECT to_regclass('public.bots') AS bots, to_regclass('drizzle.__drizzle_migrations') AS journal");
    if (!pre.rows[0].bots || !pre.rows[0].journal) throw new Error('Missing existing bot tables or migration journal.');
    const last = await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1');
    let timestamp = Number(last.rows[0]?.created_at || 0);
    if (timestamp === 1794241573640) {
      const first = fs.readFileSync('./drizzle/0000_init.sql', 'utf8');
      const avatar = await client.query("SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='avatar_url'");
      if (last.rows[0].hash !== hash(first) || avatar.rows.length !== 1 || avatar.rows[0].data_type !== 'text' || avatar.rows[0].is_nullable !== 'YES') throw new Error('Baseline schema does not match expected migration.');
      // The 0001 change was already applied outside the migration journal.
      const previous = fs.readFileSync('./drizzle/0001_spooky_gargoyle.sql', 'utf8');
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [hash(previous), 1794249798489]);
      timestamp = 1794249798489;
      console.log('Recorded existing avatar migration.');
    }
    if (timestamp < 1794249798489 || timestamp > 1794325180778) throw new Error('Unexpected migration history.');
    const journal = JSON.parse(fs.readFileSync('./drizzle/meta/_journal.json', 'utf8'));
    for (const entry of journal.entries.filter(entry => entry.idx >= 2 && entry.when > timestamp)) {
      const content = fs.readFileSync(`./drizzle/${entry.tag}.sql`, 'utf8');
      for (const statement of content.split('--> statement-breakpoint')) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [hash(content), entry.when]);
    }
    const check = await client.query("SELECT to_regclass('public.skills') AS skills, to_regclass('public.connections') AS connections, to_regclass('public.email_drafts') AS drafts, to_regclass('public.oauth_states') AS states, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='archived_at') AS archived, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='oauth_states' AND column_name='return_path') AS return_path");
    if (Object.values(check.rows[0]).some(v => !v)) throw new Error('Schema verification failed.');
    await client.query('COMMIT');
    console.log('BOTS_MIGRATIONS_VERIFIED');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); await pool.end(); }
}
async function main() {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_MESSAGE?.startsWith('Run controlled release migration')) await migrateRelease();
  const result = spawnSync('next', ['build'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
main().catch(e => { const safe = ['Missing existing bot tables or migration journal.', 'Baseline schema does not match expected migration.', 'Unexpected migration history.', 'Schema verification failed.']; console.error('Migration failed:', safe.includes(e.message) ? e.message : 'database migration error'); process.exit(1); });
