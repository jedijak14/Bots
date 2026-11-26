import {test} from 'node:test';
import assert from 'node:assert/strict';
import {usesComputer} from '../src/lib/computer-tools.ts';
test('only desktop tools open the computer panel', () => {
  for (const name of ['run_command','open_url','click','write_file','fetch_page']) assert.equal(usesComputer(name),true,name);
  for (const name of ['calculate','date_math','audio_add','video_studio','helper_status','save_artifact','look_up']) assert.equal(usesComputer(name),false,name);
});
