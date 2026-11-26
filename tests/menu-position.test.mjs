import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuPosition } from '../src/lib/menu-position.ts';

test('positions menu below or above and clamps to viewport', () => {
  const viewport={width:400,height:600};
  assert.deepEqual(menuPosition({left:30,right:70,top:20,bottom:50},3,viewport,{width:208,align:'start'}),{left:30,top:56,origin:'left top'});
  const above=menuPosition({left:350,right:390,top:560,bottom:590},3,viewport,{width:208});
  assert.equal(above.left,182); assert.equal(above.top,436); assert.equal(above.origin,'right bottom');
});
test('tall and wide menus stay reachable in short and narrow viewports', () => {
  const pos=menuPosition({left:20,right:40,top:60,bottom:80},20,{width:180,height:150},{width:300,align:'start'});
  assert.equal(pos.left,8); assert.equal(pos.top,8);
});
