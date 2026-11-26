import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalToolCall, validLocalToolCall } from '../src/lib/ai/local-tools.ts';

test('recognizes only complete, valid allowlisted tool requests', () => {
  assert.deepEqual(parseLocalToolCall('{"tool":"calculate","args":{"expression":"2+2"}}'), {tool:'calculate',args:{expression:'2+2'}});
  assert.equal(parseLocalToolCall('Here is a tool: {"tool":"calculate","args":{"expression":"2+2"}}'), null);
  assert.equal(parseLocalToolCall('{"tool":"write_file","args":{"path":"x"}}'), null);
  assert.equal(parseLocalToolCall('{"tool":"calculate","args":{"expression":"2+2","other":true}}'), null);
  assert.equal(parseLocalToolCall('{"tool":"calculate","args":'), null);
});
test('validates bounded arguments', () => {
  assert.equal(validLocalToolCall({tool:'describe_numbers',args:{values:[1,2,3]}}), true);
  assert.equal(validLocalToolCall({tool:'describe_numbers',args:{values:Array(1001).fill(1)}}), false);
  assert.equal(validLocalToolCall({tool:'calculate',args:{expression:'x'.repeat(301)}}), false);
  assert.equal(validLocalToolCall({tool:'convert_units',args:{amount:Infinity,from:'km',to:'mi'}}), false);
});

test('accepts one fenced tool call but not calls hidden in prose', () => {
  assert.equal(parseLocalToolCall('```json\n{"tool":"calculate","args":{"expression":"2+2"}}\n```')?.tool, 'calculate');
  assert.equal(parseLocalToolCall('Run this: ```json\n{"tool":"calculate","args":{"expression":"2+2"}}\n```'), null);
  assert.equal(parseLocalToolCall('```json\n{"tool":"write_file","args":{}}\n```'), null);
});

test('new local tools have bounded, typed arguments', () => {
  for (const call of [
    {tool:'date_math',args:{date:'2026-01-01',addDays:5}},
    {tool:'analyze_text',args:{text:'A short sentence.'}},
    {tool:'transform_text',args:{text:'Hello World',op:'slug'}},
    {tool:'estimate_loan',args:{principal:10000,annualRate:5,months:36}},
    {tool:'convert_time_zones',args:{instant:'2026-01-01T12:00:00Z',zones:['UTC']}},
    {tool:'compare_texts',args:{before:'a',after:'b'}},
  ]) assert.equal(validLocalToolCall(call),true,call.tool);
  for (const call of [
    {tool:'date_math',args:{date:'2026-01-01',addDays:1.5}},
    {tool:'analyze_text',args:{text:'x'.repeat(3001)}},
    {tool:'transform_text',args:{text:'a',op:'execute'}},
    {tool:'estimate_loan',args:{principal:1,annualRate:5,months:0}},
    {tool:'convert_time_zones',args:{instant:'now',zones:Array(21).fill('UTC')}},
    {tool:'compare_texts',args:{before:'a',after:'b',other:1}},
  ]) assert.equal(validLocalToolCall(call),false,call.tool);
});
