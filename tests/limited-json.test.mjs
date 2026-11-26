import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLimitedJson} from '../src/lib/limited-json.ts';
const req = (body) => new Request('http://example.test/', {method:'POST', body});
test('parses valid unicode JSON and rejects malformed or missing bodies', async () => {
  assert.deepEqual(await readLimitedJson(req('{"a":"🌎"}'),100), {ok:true,value:{a:'🌎'}});
  assert.equal((await readLimitedJson(req('{'),100)).status,400);
  assert.equal((await readLimitedJson(new Request('http://example.test/'),100)).status,400);
});
test('enforces byte limits on streamed input even with a false length header', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12)); }, cancel() { cancelled = true; } });
  const request = new Request('http://example.test/', {method:'POST', body, duplex:'half', headers:{'content-length':'1'}});
  const result = await readLimitedJson(request, 10);
  assert.equal(result.status,413);
  assert.equal(cancelled,true);
});
