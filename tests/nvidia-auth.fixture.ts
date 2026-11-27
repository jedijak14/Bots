import assert from 'node:assert/strict';
import { normalizeApiKey, credentialProblem, canReuseKey, authFailure } from '../src/lib/ai/credentials';
import { listModels, KeyRejectedError } from '../src/lib/ai/providers';
import { runAgent } from '../src/lib/ai/llm';

async function main() {
  assert.equal(normalizeApiKey(' Authorization: Bearer "nvapi-example" '), 'nvapi-example');
  assert.equal(normalizeApiKey('nvapi-abc.def.ghi'), 'nvapi-abc.def.ghi');
  assert.match(credentialProblem('nvapi-test\ncommand', 'nvidia')!, /whitespace/);
  assert.match(credentialProblem('sk-or-fake', 'nvidia')!, /different provider/);
  assert.equal(credentialProblem('nvapi-opaque', 'nvidia'), null);
  assert.equal(canReuseKey('openai', null, 'nvidia', ''), false);
  assert.equal(canReuseKey('nvidia', null, 'nvidia', ''), true);
  assert.equal(canReuseKey('nvidia', null, 'nvidia', 'https://other.example/v1'), false);
  assert.equal(canReuseKey('nvidia', null, 'custom', 'http://localhost:4005/v1'), false);
  assert.match(authFailure('nvidia', 401), /nvapi-/);
  assert.match(authFailure('nvidia', 403), /permissions/);
  let count=0;
  const key='nvapi-example-sensitive';
  const original=globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    count++;
    assert.equal((init?.headers as Record<string,string>).Authorization, `Bearer ${key}`);
    assert.match(String(url), /^https:\/\/integrate\.api\.nvidia\.com\/v1\/(models|chat\/completions)$/);
    return new Response(JSON.stringify({status:401,title:'Unauthorized',detail:`Invalid JWT serialization: Missing dot delimiter(s) ${key}`}), {status:401});
  }) as typeof fetch;
  try {
    await assert.rejects(listModels('nvidia',key), (error: unknown) => error instanceof KeyRejectedError && /NVIDIA NIM/.test(error.message) && !error.message.includes(key));
    await assert.rejects(runAgent({provider:'nvidia', apiKey:key, baseUrl:'https://integrate.api.nvidia.com/v1', model:'example', system:'', history:[{role:'user',content:'hi'}], tools:[], signal:new AbortController().signal, onText:()=>{}, runTool:async()=>({output:''})}), (error: unknown) => error instanceof Error && /NVIDIA NIM/.test(error.message) && !error.message.includes(key) && !error.message.includes('JWT serialization'));
    assert.equal(count,2);
  } finally {globalThis.fetch=original;}
}
void main().catch(e=>{console.error(e);process.exitCode=1});
