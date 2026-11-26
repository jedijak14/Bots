import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('checkpoint helper requests official handle and validates expected layout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-fetch-'));
  try {
    const model = join(dir, 'model'); mkdirSync(join(model, '2b'), { recursive: true });
    writeFileSync(join(model, 'tokenizer.model'), 'test placeholder');
    writeFileSync(join(model, '2b', 'checkpoint'), 'test placeholder');
    writeFileSync(join(dir, 'kagglehub.py'), `import os\ndef model_download(handle):\n    assert handle == 'google/gemma-2/flax/gemma2-2b-it'\n    return os.environ['MOCK_MODEL']\n`);
    const env = {...process.env, PYTHONPATH: dir, MOCK_MODEL: model};
    const ok = spawnSync('python3', ['training/orbit/fetch_checkpoint.py'], {env, encoding:'utf8'});
    assert.equal(ok.status, 0, ok.stderr);
    const result = JSON.parse(ok.stdout);
    assert.equal(result.checkpoint, join(model, '2b'));
    assert.equal(result.tokenizer, join(model, 'tokenizer.model'));
    rmSync(join(model, '2b'), { recursive:true });
    const bad = spawnSync('python3', ['training/orbit/fetch_checkpoint.py'], {env, encoding:'utf8'});
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /validation failed/);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
