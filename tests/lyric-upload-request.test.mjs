import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('lyric upload drafts are identified without swallowing other requests', () => {
  const r = spawnSync('node_modules/.bin/tsx', ['tests/lyric-upload-request.fixture.ts'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
