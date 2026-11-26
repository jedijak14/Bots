import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalQueue } from '../src/lib/ai/local-queue.ts';

test('serializes generation and allows a waiting request to stop without blocking the next', async () => {
  const run = createLocalQueue(), events = [];
  let release;
  const first = run(new AbortController().signal, async () => {
    events.push('first-start');
    await new Promise(r => { release = r; });
    events.push('first-end');
  });
  await new Promise(r => setImmediate(r));
  const cancel = new AbortController();
  const second = run(cancel.signal, async () => { events.push('second'); });
  const third = run(new AbortController().signal, async () => { events.push('third'); });
  cancel.abort();
  await assert.rejects(second, { name: 'AbortError' });
  assert.deepEqual(events, ['first-start']);
  release();
  await Promise.all([first, third]);
  assert.deepEqual(events, ['first-start', 'first-end', 'third']);
});

test('a failed request does not poison the queue', async () => {
  const run = createLocalQueue();
  await assert.rejects(run(new AbortController().signal, async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await run(new AbortController().signal, async () => 'ok'), 'ok');
});
