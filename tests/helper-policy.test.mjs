import {test} from 'node:test';
import assert from 'node:assert/strict';
import {helperTools, helperMayRun, userRequestedHelpers, waitForHelperJobs} from '../src/lib/helper-policy.ts';

test('helpers get only permitted parent tools, with no shell, accounts or recursive delegation', () => {
  const names=['calculate','save_artifact','audio_studio','video_read','run_command','send_email','search_gmail','spawn_helper','helper_status'];
  const tools=helperTools(names.map(name=>({name,description:'',parameters:{}})));
  assert.deepEqual(tools.map(x=>x.name), ['calculate','save_artifact','audio_studio','video_read']);
  const granted = new Set(tools.map(t=>t.name));
  assert.equal(helperMayRun(granted,'run_command'),false);
  assert.equal(helperMayRun(granted,'calculate'),true);
  assert.equal(helperMayRun(new Set(), 'calculate'),false);
});
test('helpers require an explicit request, rather than triggering on ordinary builds', () => {
  assert.equal(userRequestedHelpers('Build a website and a game'),false);
  assert.equal(userRequestedHelpers('What are Helper Bots?'),false);
  for (const s of ['use Helper Bots','delegate this','ask a sub-agent','run parallel agents']) assert.equal(userRequestedHelpers(s),true,s);
});
test('wait releases on completion or cancellation, including already-aborted signals', async () => {
  const ac=new AbortController();
  let resolve; const pending=new Promise(r=>resolve=r);
  const wait=waitForHelperJobs([pending],25,ac.signal); resolve(); await wait;
  const stopped=new AbortController(); const wait2=waitForHelperJobs([new Promise(()=>{})],25,stopped.signal); stopped.abort(); await wait2;
  await waitForHelperJobs([new Promise(()=>{})],25,stopped.signal);
  await waitForHelperJobs([new Promise(()=>{})],NaN,new AbortController().signal);
});
