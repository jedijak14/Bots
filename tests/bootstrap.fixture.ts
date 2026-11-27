import assert from 'node:assert/strict';
import { bootstrapSchema } from '../src/db/bootstrap';
import type { Pool } from 'pg';
async function main() {
  for (const ready of [true, false]) {
    const statements: string[] = [];
    let released = false;
    const client = { query: async (text: string) => { statements.push(text); return { rows: text.includes('jsonb_to_recordset') ? [{ready}] : [] }; }, release: () => {released = true} };
    await bootstrapSchema({ connect: async () => client } as unknown as Pool);
    assert.equal(released, true);
    if (ready) assert.equal(statements.length, 1, 'healthy schema should avoid all DDL');
    else { assert.ok(statements.some(s => s.includes('create table if not exists users'))); assert.ok(statements.some(s => s.includes('add column if not exists reasoning'))); assert.ok(statements.includes('commit')); }
  }
}
void main().catch(e => {console.error(e);process.exitCode=1});
