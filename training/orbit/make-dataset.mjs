// Synthetic examples only; no user conversations or external training data.
// Run with Node 22+: node training/orbit/make-dataset.mjs /path/to/output
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOCAL_TOOL_PROMPT, validLocalToolCall } from '../../src/lib/ai/local-tools.ts';

const outputDir = process.argv[2];
if (!outputDir) throw new Error('Give an output directory; generated data is not a trained model.');
const prompt = (question) => `${LOCAL_TOOL_PROMPT}\nBot instructions: \nRecent conversation:\n\nUser: ${question}\nAssistant:`;
const call = (tool, args) => {
  const result = {tool, args};
  if (!validLocalToolCall(result)) throw new Error(`Invalid generated tool call: ${JSON.stringify(result)}`);
  return JSON.stringify(result);
};
const train = [], evals = [];
const add = (target, question, answer) => target.push({prompt: prompt(question), response: answer});
for (let i = 1; i <= 36; i++) {
  const a = i * 3 + 2, b = i + 4;
  add(train, `Calculate ${a} + ${b}.`, call('calculate', {expression: `${a} + ${b}`}));
  add(train, `Convert ${i} km to mi.`, call('convert_units', {amount: i, from: 'km', to: 'mi'}));
  add(train, `Find the statistics for ${i}, ${i + 2}, ${i + 4}.`, call('describe_numbers', {values: [i, i + 2, i + 4]}));
}
for (const [question, foreground, background] of [
  ['Check contrast of black on white.', '#000000', '#ffffff'],
  ['Measure contrast of white on black.', '#ffffff', '#000000'],
  ['Check contrast of #777777 text on #ffffff.', '#777777', '#ffffff'],
  ['Measure contrast of #123456 on #ffffff.', '#123456', '#ffffff'],
  ['Check contrast of #ff0000 against #000000.', '#ff0000', '#000000'],
]) add(train, question, call('check_contrast', {foreground, background}));
for (const [question, timezone] of [
  ['What time is it in London?', 'Europe/London'], ['What time is it in Tokyo?', 'Asia/Tokyo'],
  ['Give me the time in UTC.', 'UTC'], ['What is the current time in Los Angeles?', 'America/Los_Angeles'],
  ['What time is it in New York?', 'America/New_York'],
]) add(train, question, call('get_current_time', {timezone}));
for (const [question, answer] of [
  ['Hello!', 'Hello! How can I help?'],
  ['Write a short greeting.', 'Hello! It is nice to meet you.'],
  ['Can you browse the web?', 'I cannot browse the web in Orbit Local.'],
  ['Send an email to my manager.', 'I cannot send emails in Orbit Local.'],
  ['Open a file on my computer.', 'I cannot access files on your computer in Orbit Local.'],
  ['Use my connected accounts.', 'I cannot access connected accounts in Orbit Local.'],
  ['What can you do?', 'I can answer questions and request a small set of read-only tools.'],
]) add(train, question, answer);
for (const [question, answer] of [
  ['What is 113 plus 29?', call('calculate', {expression:'113 + 29'})],
  ['How many miles are in 71 kilometers?', call('convert_units', {amount:71,from:'km',to:'mi'})],
  ['Summarize the numbers 42, 48, and 54 statistically.', call('describe_numbers', {values:[42,48,54]})],
  ['Is #abcdef text on #112233 sufficiently contrasted?', call('check_contrast', {foreground:'#abcdef',background:'#112233'})],
  ['Tell me the current local time in Paris.', call('get_current_time', {timezone:'Europe/Paris'})],
  ['Browse a website for me.', 'I cannot browse the web in Orbit Local.'],
  ['Hi there.', 'Hello! How can I help?'],
]) add(evals, question, answer);
if (new Set([...train, ...evals].map(x => x.prompt)).size !== train.length + evals.length) throw new Error('Duplicate prompts across train/evaluation.');
await mkdir(outputDir, {recursive:true});
for (const [file, data] of [['train.json', train], ['eval.json', evals]]) await writeFile(resolve(outputDir, file), JSON.stringify(data, null, 2) + '\n');
console.log(`Wrote ${train.length} synthetic training examples and ${evals.length} held-out examples. This dataset is a prototype, not an evaluation of model quality.`);
