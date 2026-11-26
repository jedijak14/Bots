import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('local turn dispatches only supported calls and reports the real result', () => {
  const r=spawnSync('node_modules/.bin/tsx', ['tests/local-turn.fixture.ts'], {encoding:'utf8'});
  assert.equal(r.status, 0, r.stderr);
});
