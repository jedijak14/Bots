import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_CHUNK_BYTES, MEDIA_LIMITS, mediaType, validMediaChunk } from '../src/lib/media-upload.ts';
test('media formats tolerate missing browser mime but enforce kind', () => {
  assert.equal(mediaType('audio', 'SONG.MP3', ''), 'audio/mpeg');
  assert.equal(mediaType('audio', 'song.m4a', 'application/octet-stream'), 'audio/mp4');
  assert.equal(mediaType('audio', 'song.wav', 'audio/x-wav'), 'audio/wav');
  assert.equal(mediaType('image', 'cover.jpg', ''), 'image/jpeg');
  assert.equal(mediaType('audio', 'cover.png', 'image/png'), null);
});
test('chunk validation handles boundaries, padding and out of order indexes', () => {
  const bytes = Buffer.alloc(MEDIA_CHUNK_BYTES + 2, 0x7f);
  const first = bytes.subarray(0, MEDIA_CHUNK_BYTES).toString('base64');
  const last = bytes.subarray(MEDIA_CHUNK_BYTES).toString('base64');
  assert.equal(validMediaChunk(first, 0, bytes.length), true);
  assert.equal(validMediaChunk(last, 1, bytes.length), true);
  assert.equal(first + last, bytes.toString('base64'));
  assert.equal(validMediaChunk(last, 2, bytes.length), false);
  assert.equal(validMediaChunk(last.slice(0, -1) + '!', 1, bytes.length), false);
  assert.equal(validMediaChunk(first, -1, bytes.length), false);
  assert.equal(MEDIA_LIMITS.audio, 24 * 1024 * 1024);
});

test('byte ranges fit the serverless response limit', async () => {
  const { mediaRange } = await import('../src/lib/media-upload.ts');
  const size = 8 * 1024 * 1024;
  assert.deepEqual(mediaRange('bytes=0-', size), { start: 0, end: 3 * 1024 * 1024 - 1, partial: true });
  assert.deepEqual(mediaRange('bytes=-4', size), { start: size - 4, end: size - 1, partial: true });
  assert.equal(mediaRange('bytes=99999999-', size), null);
  assert.equal(mediaRange('bytes=1-2,4-5', size), null);
  assert.equal(mediaRange(null, 100).partial, false);
});
test('plain lyrics get approximate times without changing already timed lyrics', async () => {
  const { timePlainLyrics } = await import('../src/lib/lyric-timing.ts');
  const lines = [{startTimeMs: 0, durationMs: 0}, {startTimeMs: 0, durationMs: 0}];
  assert.deepEqual(timePlainLyrics(lines, 10000), [{startTimeMs: 0, durationMs: 5000}, {startTimeMs: 5000, durationMs: 5000}]);
  const timed = [{startTimeMs: 1000, durationMs: 1000}];
  assert.equal(timePlainLyrics(timed, 10000), timed);
});
