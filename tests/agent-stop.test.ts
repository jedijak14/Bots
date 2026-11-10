import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runAgent } from "../src/lib/ai/llm";

for (const provider of ["openai", "anthropic"] as const) {
  test(`${provider} stops before subsequent tools when a tool requests a handoff`, async () => {
    const original = globalThis.fetch;
    const events = provider === "openai" ? [
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: "a", function: { name: "request_connection", arguments: "{}" } },
        { index: 1, id: "b", function: { name: "run_command", arguments: "{}" } },
      ] } }] },
    ] : [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "a", name: "request_connection" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "b", name: "run_command" } },
    ];
    globalThis.fetch = (async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""))) as typeof fetch;
    const calls: string[] = [];
    try {
      await runAgent({ provider, apiKey: "test", baseUrl: "https://example.invalid", model: "test", system: "test", history: [{ role: "user", content: "test" }], tools: [], signal: new AbortController().signal, onText: () => {}, runTool: async (name) => { calls.push(name); return { output: "waiting", stop: true }; } });
      assert.deepEqual(calls, ["request_connection"]);
    } finally { globalThis.fetch = original; }
  });
}
