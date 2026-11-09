import { PROVIDERS, type ProviderId } from "./providers";

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type Hist = { role: "user" | "assistant"; content: string };

export type ToolResult = { output: string; stop?: boolean };

export type AgentOptions = {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  history: Hist[];
  tools: Tool[];
  signal: AbortSignal;
  maxSteps?: number;
  onText: (delta: string) => void;
  runTool: (name: string, args: Record<string, unknown>, id: string) => Promise<ToolResult>;
};

type SseEvent = { event?: string; data: string };

async function* sse(res: Response): AsyncGenerator<SseEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const parse = (raw: string): SseEvent | null => {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    return data.length ? { event, data: data.join("\n") } : null;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let m: RegExpExecArray | null;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      const raw = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const ev = parse(raw);
      if (ev) yield ev;
    }
  }
  if (buf.trim()) {
    const ev = parse(buf);
    if (ev) yield ev;
  }
}

async function failure(res: Response, label: string): Promise<Error> {
  let msg = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message ?? j?.error ?? j?.message ?? text;
      if (typeof msg !== "string") msg = JSON.stringify(msg);
    } catch {
      msg = text;
    }
  } catch {}
  msg = msg.slice(0, 400);
  if (res.status === 401 || res.status === 403) return new Error(`${label} rejected your API key. Check it in Settings. ${msg}`);
  if (res.status === 429) return new Error(`${label} rate limit or quota reached. ${msg}`);
  return new Error(`${label} error (${res.status}). ${msg}`);
}

function safeJson(s: string): Record<string, unknown> {
  if (!s.trim()) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runAgent(o: AgentOptions): Promise<void> {
  if (PROVIDERS[o.provider].kind === "anthropic") return anthropicLoop(o);
  return openaiLoop(o);
}

/* ------------------------------ OpenAI-compatible ------------------------------ */

async function openaiLoop(o: AgentOptions) {
  const label = PROVIDERS[o.provider].label;
  const msgs: Record<string, unknown>[] = [{ role: "system", content: o.system }, ...o.history];
  const max = o.maxSteps ?? 10;

  for (let step = 0; step < max; step++) {
    const res = await fetch(`${o.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({
        model: o.model,
        messages: msgs,
        stream: true,
        ...(o.tools.length
          ? {
              tools: o.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
      signal: o.signal,
    });
    if (!res.ok) throw await failure(res, label);

    let text = "";
    const calls: { id: string; name: string; args: string }[] = [];
    for await (const ev of sse(res)) {
      if (ev.data === "[DONE]") break;
      let j: {
        choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        error?: { message?: string };
      };
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (j.error) throw new Error(`${label}: ${j.error.message ?? "stream error"}`);
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      if (typeof d.content === "string" && d.content) {
        text += d.content;
        o.onText(d.content);
      }
      for (const tc of d.tool_calls ?? []) {
        const idx = tc.index ?? (tc.id || tc.function?.name ? calls.length : Math.max(0, calls.length - 1));
        if (!calls[idx]) calls[idx] = { id: tc.id || `call_${step}_${idx}`, name: "", args: "" };
        if (tc.id) calls[idx].id = tc.id;
        if (tc.function?.name) calls[idx].name += tc.function.name;
        if (tc.function?.arguments) calls[idx].args += tc.function.arguments;
      }
    }

    const real = calls.filter((c) => c && c.name);
    if (!real.length) return;

    msgs.push({
      role: "assistant",
      content: text || null,
      tool_calls: real.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
    });
    let stop = false;
    for (const c of real) {
      const r = await o.runTool(c.name, safeJson(c.args), c.id);
      msgs.push({ role: "tool", tool_call_id: c.id, content: r.output });
      if (r.stop) stop = true;
    }
    if (stop) return;
  }
}

/* ---------------------------------- Anthropic ---------------------------------- */

async function anthropicLoop(o: AgentOptions) {
  const msgs: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const h of o.history) {
    if (!msgs.length && h.role === "assistant") continue; // must start with user
    const last = msgs[msgs.length - 1];
    if (last && last.role === h.role && typeof last.content === "string") last.content += `\n\n${h.content}`;
    else msgs.push({ role: h.role, content: h.content });
  }
  const max = o.maxSteps ?? 10;

  for (let step = 0; step < max; step++) {
    const res = await fetch(`${o.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": o.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: o.model,
        max_tokens: 4096,
        system: o.system,
        messages: msgs,
        stream: true,
        ...(o.tools.length
          ? { tools: o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
          : {}),
      }),
      signal: o.signal,
    });
    if (!res.ok) throw await failure(res, "Anthropic");

    type Block = { type: string; text: string; id: string; name: string; json: string };
    const blocks: Block[] = [];
    for await (const ev of sse(res)) {
      let j: {
        type?: string;
        index?: number;
        content_block?: { type: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        error?: { message?: string };
      };
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (j.type === "error") throw new Error(`Anthropic: ${j.error?.message ?? "stream error"}`);
      if (j.type === "content_block_start" && j.index !== undefined && j.content_block) {
        blocks[j.index] = {
          type: j.content_block.type,
          text: "",
          id: j.content_block.id ?? "",
          name: j.content_block.name ?? "",
          json: "",
        };
      } else if (j.type === "content_block_delta" && j.index !== undefined && blocks[j.index]) {
        const b = blocks[j.index];
        if (j.delta?.type === "text_delta" && j.delta.text) {
          b.text += j.delta.text;
          o.onText(j.delta.text);
        } else if (j.delta?.type === "input_json_delta") {
          b.json += j.delta.partial_json ?? "";
        }
      }
    }

    const content: unknown[] = [];
    const uses: Block[] = [];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === "text" && b.text) content.push({ type: "text", text: b.text });
      if (b.type === "tool_use") {
        content.push({ type: "tool_use", id: b.id, name: b.name, input: safeJson(b.json) });
        uses.push(b);
      }
    }
    if (!uses.length) return;

    msgs.push({ role: "assistant", content });
    const results: unknown[] = [];
    let stop = false;
    for (const u of uses) {
      const r = await o.runTool(u.name, safeJson(u.json), u.id);
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.output });
      if (r.stop) stop = true;
    }
    msgs.push({ role: "user", content: results });
    if (stop) return;
  }
}
