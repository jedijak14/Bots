import assert from 'node:assert/strict';
import { finishLocalTurn } from '../src/lib/ai/local-turn';

async function main() {
  let invoked = 0;
  const result = await finishLocalTurn('```json\n{"tool":"calculate","args":{"expression":"2+2"}}\n```', async call => {
    invoked++;
    assert.equal(call.tool, 'calculate');
    assert.equal(call.args.expression, '2+2');
    return {ok:true, output:'2+2 = 4'};
  });
  assert.equal(result, '**calculate result:**\n\n2+2 = 4');
  assert.equal(invoked, 1);
  const denied = await finishLocalTurn('{"tool":"calculate","args":{"expression":"2+2"}}', async () => ({ok:false, error:'Denied by skills'}));
  assert.match(denied, /could not run.*Denied by skills/);
  const invalid = await finishLocalTurn('{"tool":"write_file","args":{}}', async () => { throw new Error('must not run'); });
  assert.match(invalid, /could not make a valid supported tool request/);
  const prose = await finishLocalTurn('Hello there', async () => { throw new Error('must not run'); });
  assert.equal(prose, 'Hello there');
}
void main().catch(err => {console.error(err); process.exitCode = 1});
