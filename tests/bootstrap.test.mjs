import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('schema bootstrap avoids DDL on an up-to-date database', () => {
  const r = spawnSync('node_modules/.bin/tsx', ['tests/bootstrap.fixture.ts'], {encoding:'utf8'});
  assert.equal(r.status, 0, r.stderr);
});
