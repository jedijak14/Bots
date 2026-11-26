import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateMath, moneySplit, transformText } from '../src/lib/utilities.ts';

test('invalid text operations return an explanation', () => {
  assert.match(transformText('abc', 'invalid'), /no .*operation/i);
  assert.equal(transformText('Hello World', 'slug'), 'hello-world');
});

test('money splits reject invalid and oversized counts and conserve cents', () => {
  for (const n of [0, -1, 1.5, NaN, Infinity, 10001]) assert.ok('error' in moneySplit(10, n));
  assert.ok('error' in moneySplit(Infinity, 3));
  assert.deepEqual(moneySplit(100, 3), [33.34, 33.33, 33.33]);
});

test('date offsets validate numbers and clamp leap days', () => {
  assert.ok('error' in dateMath({ date: '2026-03-01', addMonths: NaN }));
  assert.equal(dateMath({ date: '2024-02-29', addYears: 1 }).to, '2025-02-28');
  assert.equal(dateMath({ date: '2026-01-31', addMonths: 1 }).to, '2026-02-28');
});

test('business day offsets skip weekends in either direction', () => {
  for (const [date, days, expected] of [
    ['2026-11-27', 1, '2026-11-30'], ['2026-11-30', -1, '2026-11-27'],
    ['2026-11-28', 1, '2026-11-30'], ['2026-11-29', -1, '2026-11-27'],
    ['2026-11-27', 5, '2026-12-04'], ['2026-11-30', -5, '2026-11-23'],
  ]) assert.equal(dateMath({ date, addBusinessDays: days }).to, expected);
});

test('line transformations preserve content and handle blank lines', () => {
  assert.equal(transformText('a\nb\nc', 'reverse-lines'), 'c\nb\na');
  assert.equal(transformText('a\n \nb', 'remove-blank-lines'), 'a\nb');
  assert.equal(transformText('a\nb', 'number-lines'), '1. a\n2. b');
  assert.equal(transformText(' a \n b ', 'trim-lines'), 'a\nb');
});
