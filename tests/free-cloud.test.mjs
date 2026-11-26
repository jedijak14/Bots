import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anonymousFreeCloudConfig, isFreeCloudProvider, FREE_CLOUD_BASE_URL, FREE_CLOUD_MODEL, KILO_GEMMA_MODEL, OVH_FREE_BASE_URL, OVH_FREE_MODEL } from '../src/lib/ai/free-cloud.ts';

test('anonymous cloud routes use fixed provider, model, host and no key', () => {
  const kilo = anonymousFreeCloudConfig('kilo-free');
  assert.deepEqual(kilo, {provider:'kilo-free', baseUrl:FREE_CLOUD_BASE_URL, defaultModel:FREE_CLOUD_MODEL, apiKey:''});
  const gemma = anonymousFreeCloudConfig('kilo-gemma-free');
  assert.deepEqual(gemma, {provider:'kilo-gemma-free', baseUrl:FREE_CLOUD_BASE_URL, defaultModel:KILO_GEMMA_MODEL, apiKey:''});
  assert.equal(KILO_GEMMA_MODEL, 'google/gemma-4-26b-a4b-it:free');
  const ovh = anonymousFreeCloudConfig('ovh-free');
  assert.deepEqual(ovh, {provider:'ovh-free', baseUrl:OVH_FREE_BASE_URL, defaultModel:OVH_FREE_MODEL, apiKey:''});
  assert.equal(OVH_FREE_MODEL, 'gpt-oss-20b');
  assert.equal(isFreeCloudProvider('kilo-free'), true);
  assert.equal(isFreeCloudProvider('ovh-free'), true);
  assert.equal(isFreeCloudProvider('kilo-gemma-free'), true);
  assert.equal(isFreeCloudProvider('paid-model'), false);
  assert.equal(isFreeCloudProvider('__proto__'), false);
});
