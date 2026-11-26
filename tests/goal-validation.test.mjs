import {test} from 'node:test';
import assert from 'node:assert/strict';
import {goalInputError} from '../src/lib/goal-validation.ts';
import {isUuid} from '../src/lib/ids.ts';
test('untrusted goal fields are checked before database calls', () => {
  for (const bad of [null, [], {title:' '}, {title:'x',detail:1}, {title:'x',due:'not a date'}, {title:'x',status:'other'}, {title:'x',botId:42}]) assert.ok(goalInputError(bad,true));
  assert.equal(goalInputError({title:'Goal', due:'2026-01-01', status:'doing'},true),null);
  assert.equal(goalInputError({due:null, status:'done'},false),null);
  assert.ok(goalInputError({title:''},false));
});
test('UUID validation rejects 36-character malformed IDs', () => {
  assert.equal(isUuid('------------------------------------'),false);
  assert.equal(isUuid('00000000-0000-4000-8000-000000000000'),true);
});
