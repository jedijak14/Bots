import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewTime, projectDuration, transitionProgress } from '../src/lib/video-studio-spec.ts';
import { audioDuration } from '../src/lib/audio-studio-spec.ts';

test('video preview remains inside a short opening clip even with a long later clip', () => {
  const opening = {id:'a', kind:'text', source:'Intro', start:0, duration:0.2};
  const project = { tracks:[{id:'v', clips:[opening, {id:'b',kind:'text',source:'Later',start:5,duration:5}]}] };
  assert.equal(projectDuration(project), 10);
  assert.ok(previewTime(project) >= 0 && previewTime(project) < opening.duration);
});
test('empty and muted timelines and transition bounds are safe', () => {
  assert.equal(previewTime({tracks:[]}), 0);
  assert.equal(projectDuration({tracks:[{muted:true, clips:[{start:2,duration:4}]}]}), 0);
  assert.equal(audioDuration({tracks:[{muted:true, clips:[{start:2,duration:4}]}]}), 0);
  const clip = {start:2, transition:{duration:1}};
  assert.equal(transitionProgress(clip, 1), 0);
  assert.equal(transitionProgress(clip, 4), 1);
});
