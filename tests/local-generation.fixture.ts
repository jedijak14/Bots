import assert from 'node:assert/strict';
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { generateLocalReply } from '../src/lib/ai/local-generation';

async function main() {
  let config: Record<string, unknown> | undefined;
  let interrupted = 0;
  const engine = {
    chat: { completions: { create: async (request: Record<string, unknown>) => {
      config = request;
      return (async function* () { yield { choices: [{ delta: { content: 'Hello' } }] }; yield { choices: [{ delta: { content: ' world' } }] }; })();
    } } },
    interruptGenerate: async () => { interrupted++; },
  } as unknown as MLCEngineInterface;
  let deltas = '';
  const history = [{role: 'system' as const, content: 'You are helpful.'}, {role: 'user' as const, content: 'Explain tides.'}];
  assert.equal(await generateLocalReply(engine, history, token => { deltas += token; }, new AbortController().signal), 'Hello world');
  assert.equal(deltas, 'Hello world');
  assert.deepEqual(config?.messages, history);
  assert.deepEqual(config?.extra_body, { enable_thinking: false });
  assert.equal(config?.stream, true);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => generateLocalReply(engine, history, () => {}, aborted.signal), {name:'AbortError'});
  assert.equal(interrupted, 0);
  const mid = new AbortController();
  await assert.rejects(() => generateLocalReply(engine, history, () => mid.abort(), mid.signal), {name:'AbortError'});
  assert.equal(interrupted, 1);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
