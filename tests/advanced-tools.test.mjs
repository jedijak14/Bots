import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeNumbers, convertTime, loanEstimate, compareLines } from '../src/lib/advanced-tools.ts';

test('descriptive statistics including interpolation and sample deviation', () => {
  const r = describeNumbers([1, 2, 3, 4]);
  assert.equal(r.median, 2.5); assert.equal(r.q1, 1.75); assert.equal(r.q3, 3.25);
  assert.ok(Math.abs(r.sampleStandardDeviation - Math.sqrt(5/3)) < 1e-12);
  assert.equal(describeNumbers([2]).sampleStandardDeviation, null);
  assert.ok(describeNumbers([1, '2']).error);
});

test('time zone conversion handles daylight saving and rejects ambiguous and invalid dates', () => {
  const r = convertTime('2026-07-01T12:00:00Z', ['America/Los_Angeles', 'Europe/London']);
  assert.match(r.times[0].local, /05:00:00/); assert.match(r.times[1].local, /13:00:00/);
  assert.ok(convertTime('2026-11-01T01:30', ['America/Los_Angeles']).error);
  assert.ok(convertTime('2026-02-30T12:00:00Z', ['UTC']).error);
  assert.ok(convertTime('2026-01-01T12:00:00Z', ['not/a-zone']).error);
});

test('loan estimates include assumptions and validate inputs', () => {
  assert.equal(loanEstimate(1200, 0, 12).monthlyPayment, 100);
  assert.equal(loanEstimate(100000, 6, 360).monthlyPayment, 599.55);
  assert.ok(loanEstimate(100, 5, 0).error);
});

test('line comparison identifies changes and handles empty texts', () => {
  const r = compareLines('a\nb', 'a\nc');
  assert.equal(r.added, 1); assert.equal(r.removed, 1);
  assert.deepEqual(compareLines('', 'new').changes, [{type: 'added', line: 'new'}]);
  assert.ok(compareLines('x\n'.repeat(501), '').error);
});
