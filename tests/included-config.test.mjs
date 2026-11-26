import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includedConfig } from '../src/lib/ai/included-config.ts';

test('included AI is opt-in and requires a model and valid server URL', () => {
  assert.equal(includedConfig({}), null);
  assert.equal(includedConfig({ INCLUDED_AI_BASE_URL: 'http://localhost:8001/v1' }), null);
  assert.equal(includedConfig({ INCLUDED_AI_BASE_URL: 'http://user:secret@host/v1', INCLUDED_AI_MODEL: 'gemma' }), null);
  assert.equal(includedConfig({ INCLUDED_AI_BASE_URL: 'ftp://host/v1', INCLUDED_AI_MODEL: 'gemma' }), null);
  assert.equal(includedConfig({ INCLUDED_AI_BASE_URL: 'https://host/v1?key=secret', INCLUDED_AI_MODEL: 'gemma' }), null);
});
test('included AI configuration keeps the secret server side and normalizes URL', () => {
  const cfg = includedConfig({ INCLUDED_AI_BASE_URL: 'http://localhost:8001/v1/', INCLUDED_AI_MODEL: 'gemma', INCLUDED_AI_API_KEY: 'secret' });
  assert.equal(cfg.baseUrl, 'http://localhost:8001/v1');
  assert.equal(cfg.apiKey, 'secret');
  assert.equal(cfg.included, true);
  assert.equal(includedConfig({ INCLUDED_AI_BASE_URL: 'http://localhost:8001/v1', INCLUDED_AI_MODEL: 'gemma' }).apiKey, 'sk-local');
});
