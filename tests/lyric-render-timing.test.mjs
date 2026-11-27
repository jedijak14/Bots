import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lyricAtTime } from '../src/lib/lyric-render-timing.ts';

test('rendered captions follow boundaries and leave explicit gaps blank', () => {
  const lines = [{ startTimeMs: 1000, durationMs: 1000, words: 'First' }, { startTimeMs: 3000, durationMs: 2000, words: 'Second' }];
  assert.equal(lyricAtTime(lines, 0), null);
  assert.equal(lyricAtTime(lines, 1000), lines[0]);
  assert.equal(lyricAtTime(lines, 1999), lines[0]);
  assert.equal(lyricAtTime(lines, 2000), null);
  assert.equal(lyricAtTime(lines, 3000), lines[1]);
  assert.equal(lyricAtTime(lines, 5000), null);
  assert.equal(lyricAtTime([], 1000), null);
});
