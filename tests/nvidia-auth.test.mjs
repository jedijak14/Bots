import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('NVIDIA auth uses the right bearer key and surfaces safe, actionable errors', () => {
  const r = spawnSync('node_modules/.bin/tsx', ['tests/nvidia-auth.fixture.ts'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
