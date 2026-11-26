import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalEngineManager } from '../src/lib/ai/local-engine.ts';

test('shares an initial load, stops waiting promptly and cleans progress listeners', async () => {
  let resolve, progress, loads = 0;
  const manager = createLocalEngineManager(callback => { loads++; progress = callback; return new Promise(r => {resolve=r}); });
  const a = new AbortController(), b = new AbortController();
  const first = [], second = [];
  const p1 = manager.get(a.signal, x => first.push(x));
  const p2 = manager.get(b.signal, x => second.push(x));
  await Promise.resolve();
  progress('loading');
  assert.deepEqual(first, ['loading']); assert.deepEqual(second, ['loading']);
  a.abort();
  await assert.rejects(p1, {name:'AbortError'});
  progress('almost');
  assert.deepEqual(first, ['loading']); assert.deepEqual(second, ['loading','almost']);
  resolve('engine'); assert.equal(await p2, 'engine'); assert.equal(loads, 1);
  assert.equal(await manager.get(new AbortController().signal, () => {}), 'engine');
});

test('a failed load can be retried', async () => {
  let calls=0;
  const manager=createLocalEngineManager(async () => { if (++calls === 1) throw new Error('offline'); return 'ready'; });
  await assert.rejects(manager.get(new AbortController().signal, () => {}), /offline/);
  assert.equal(await manager.get(new AbortController().signal, () => {}), 'ready');
});
