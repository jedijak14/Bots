import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseLocalToolCall } from '../src/lib/ai/local-tools.ts';

test('training data and evaluator produce separated, valid synthetic cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-training-'));
  try {
    const run = spawnSync(process.execPath, ['training/orbit/make-dataset.mjs', dir], {encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    const train = JSON.parse(readFileSync(join(dir, 'train.json'), 'utf8'));
    const holdout = JSON.parse(readFileSync(join(dir, 'eval.json'), 'utf8'));
    assert.equal(train.length, 125);
    assert.equal(holdout.length, 7);
    const trainPrompts = new Set(train.map(x => x.prompt));
    assert.ok(holdout.every(x => !trainPrompts.has(x.prompt)));
    for (const row of [...train, ...holdout]) {
      assert.equal(typeof row.prompt, 'string');
      assert.equal(typeof row.response, 'string');
      if (row.response.startsWith('{')) assert.ok(parseLocalToolCall(row.response));
    }
    const predictions = holdout.map(x => x.response);
    predictions[0] = '{"tool":"write_file","args":{}}';
    writeFileSync(join(dir, 'predictions.json'), JSON.stringify(predictions));
    const evaluation = spawnSync(process.execPath, ['training/orbit/evaluate.mjs', join(dir, 'eval.json'), join(dir, 'predictions.json')], {encoding: 'utf8'});
    assert.equal(evaluation.status, 0, evaluation.stderr);
    const report = JSON.parse(evaluation.stdout);
    assert.equal(report.toolCases, 5);
    assert.equal(report.toolCorrect, 4);
    assert.equal(report.failures.length, 1);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
