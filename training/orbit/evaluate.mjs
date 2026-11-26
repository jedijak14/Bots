// Score actual model outputs against the held-out synthetic examples.
// Inputs are JSON arrays; predictions[i] is the raw response for examples[i].
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { parseLocalToolCall } from '../../src/lib/ai/local-tools.ts';
const [examplesPath, predictionsPath] = process.argv.slice(2);
if (!examplesPath || !predictionsPath) throw new Error('Usage: node training/orbit/evaluate.mjs eval.json predictions.json');
const examples = JSON.parse(await readFile(examplesPath, 'utf8'));
const predictions = JSON.parse(await readFile(predictionsPath, 'utf8'));
if (!Array.isArray(examples) || !Array.isArray(predictions) || examples.length !== predictions.length || predictions.some(p => typeof p !== 'string')) throw new Error('Predictions must be a same-length array of raw response strings.');
let toolCases = 0, toolCorrect = 0, nonToolCases = 0, unexpectedTool = 0;
const failures = [];
examples.forEach((example, index) => {
  const expected = parseLocalToolCall(example.response);
  const actual = parseLocalToolCall(predictions[index]);
  if (expected) {
    toolCases++;
    if (actual && isDeepStrictEqual(actual, expected)) toolCorrect++;
    else failures.push({index, expected, actual, raw: predictions[index].slice(0, 500)});
  } else {
    nonToolCases++;
    if (actual) { unexpectedTool++; failures.push({index, expected:'no tool', actual}); }
  }
});
console.log(JSON.stringify({toolCases, toolCorrect, nonToolCases, unexpectedTool, failures, note:'This measures tool-call format and exact arguments on a small synthetic holdout only; it does not evaluate answer quality or safety.'}, null, 2));
