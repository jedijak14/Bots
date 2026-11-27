import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatHttpError } from '../src/lib/http-errors.ts';
test('unstructured error responses describe their actual HTTP status', () => {
  assert.match(chatHttpError(413), /too large/);
  assert.match(chatHttpError(503), /503/);
  assert.match(chatHttpError(504), /504/);
  assert.match(chatHttpError(500), /500/);
  assert.match(chatHttpError(401), /session/);
});
