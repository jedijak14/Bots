import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import { LOCAL_MODEL_ID, LOCAL_CONSENT_KEY, hasLocalConsent, rememberLocalConsent } from '../src/lib/ai/local-model-info.ts';

test('configured public model exists in the installed WebLLM registry', () => {
  const record = prebuiltAppConfig.model_list.find(x => x.model_id === LOCAL_MODEL_ID);
  assert.ok(record);
  assert.equal(record.model, 'https://huggingface.co/mlc-ai/Qwen3-4B-q4f32_1-MLC');
  assert.equal(record.overrides.context_window_size, 4096);
});
test('consent is versioned, per session and does not reuse old Orbit consent', () => {
  const map = new Map([['orbit-consent', 'yes']]);
  globalThis.sessionStorage = {getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v)};
  try { assert.equal(hasLocalConsent(), false); rememberLocalConsent(); assert.equal(map.get(LOCAL_CONSENT_KEY), 'yes'); assert.equal(hasLocalConsent(), true); }
  finally { delete globalThis.sessionStorage; }
  assert.equal(hasLocalConsent(), false);
});
test('local model streams using non-thinking chat settings and supports cancellation', () => {
  const result = spawnSync('node_modules/.bin/tsx', ['tests/local-generation.fixture.ts'], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});
