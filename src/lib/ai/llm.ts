import { PROVIDERS, type ProviderId } from "./providers";

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type Hist = { role: "user" | "assistant"; content: string };

export type ToolResult = { output: string; stop?: boolean; artifactId?: string };

export type AgentOptions = {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * When set, the request goes through an OptiLLM proxy instead of straight to
   * the provider, and the model name carries the technique. The proxy holds its
   * own copy of the key in its environment, so this request still sends the
   * account's key — a proxy that ignored it would be met with a 401 rather than
   * a silently different bill.
   */
  optimise?: { url: string; model: string; approach: string };
  /** Called when the proxy fails, so the turn can say so once and move on. */
  onOptimiseFailed?: (reason: string) => void;
  /** Set by the loop itself after one failed optimisation attempt. */
  optimiseRetried?: boolean;
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

/**
 * Re-ask the turn's question through the optimising proxy and return the answer.
 *
 * The proxy is asked for the plain technique (no tools, because no technique
 * carries them) and its reply is collected whole, then handed to `onText` in one
 * piece. Returning `null` means "could not", never "answered with nothing": an
 * empty reply is treated as a failure so the first-draft answer survives.
 */
async function reasonInstead(o: AgentOptions, msgs: Record<string, unknown>[], firstDraft: string): Promise<string | null> {
  const opt = o.optimise;
  if (!opt) return null;
  try {
    const res = await fetch(`${opt.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({ model: opt.model, messages: msgs, stream: true }),
      signal: o.signal,
    });
    if (!res.ok) {
      const err = await failure(res, PROVIDERS[o.provider].label);
      o.onOptimiseFailed?.(err.message);
      return null;
    }
    let out = "";
    for await (const ev of sse(res)) {
      if (ev.data === "[DONE]") break;
      let j: { choices?: { delta?: { content?: string | string[] } }[]; error?: { message?: string } };
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (j.error) {
        o.onOptimiseFailed?.(j.error.message ?? "the proxy reported an error");
        return null;
      }
      const parts = j.choices?.[0]?.delta?.content;
      const piece = Array.isArray(parts) ? parts.filter((x) => typeof x === "string").join("") : parts;
      if (typeof piece === "string") out += piece;
    }
    // A technique that returns less than the plain answer has not improved
    // anything; keep the original rather than shipping a truncated regression.
    if (out.trim().length < Math.min(20, firstDraft.trim().length / 2)) {
      o.onOptimiseFailed?.("the reasoned answer was shorter than the first draft, so the first draft was kept");
      return null;
    }
    return out;
  } catch (e) {
    o.onOptimiseFailed?.(e instanceof Error ? e.message.slice(0, 200) : "the proxy call failed");
    return null;
  }
}

/* ------------------------------ OpenAI-compatible ------------------------------ */

async function openaiLoop(o: AgentOptions) {
  const label = PROVIDERS[o.provider].label;
  const msgs: Record<string, unknown>[] = [{ role: "system", content: o.system }, ...o.history];
  const max = o.maxSteps ?? 10;
  // The schema does not change between steps, so build it once instead of
  // re-serialising it on every pass through the loop.
  const tools = o.tools.length
    ? o.tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    : undefined;

  for (let step = 0; step < max; step++) {
    // Only the opening step of a turn can be a pure answer. After a tool has
    // run, the model is reporting on work rather than reasoning about a
    // question, and re-asking would be a second bill for the same words.
    const hold = !!o.optimise && step === 0;
    // The provider call itself.
    //
    // Optimisation is deliberately NOT applied here. No OptiLLM technique
    // forwards the tool schema: `reread.py` and `cot_reflection.py` build an
    // upstream request of `{model, messages, n, max_tokens}` from
    // `request_config` and never pass `tools`, which was confirmed by reading
    // the installed package and by sending a tool-bearing request through the
    // proxy (the tool call disappeared). Since a Bot's every turn carries a
    // toolset — seventeen tools in a plain greeting — routing the agent loop
    // itself through a technique would silently disable the Bot's hands.
    //
    // So the loop always runs direct with tools, and the reasoned answer is
    // applied afterwards by `optimisePureAnswer` if and only if the model chose
    // to answer in prose rather than act.
    const res = await fetch(`${o.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({
        model: o.model,
        prompt_cache_key: `bot-${o.model}`,
        messages: msgs,
        stream: true,
        ...(tools ? { tools } : {}),
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
      // Only the first choice is ours. OptiLLM's parallel and best-of-N
      // approaches emit additional choices (index 1, 2, …) carrying competing
      // drafts; appending them would splice several answers into one garbled
      // turn. Its serial approaches reuse index 0, so this loses nothing.
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      // `content` is normally a string, but OptiLLM emits it as an array of
      // parts when a technique hands up a composed answer. Both mean text.
      const parts = Array.isArray(d.content) ? d.content : [d.content];
      const piece = parts.filter((x): x is string => typeof x === "string").join("");
      if (piece) {
        text += piece;
        // Held back on the first step of an optimised turn: the answer may be
        // replaced by a reasoned one, and a user watching a reply they already
        // read get swapped out is worse than a moment's wait. Flushed below as
        // soon as the step turns out to need tools.
        if (!hold) o.onText(piece);
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
    if (!real.length) {
      // The model answered in prose. On an optimised turn that answer was held
      // back, so this is the moment to spend the extra inference and replace it
      // with a reasoned one — or to keep it, if the proxy is not usable.
      if (hold && o.optimise) {
        const reasoned = await reasonInstead(o, msgs, text);
        if (reasoned !== null) {
          o.onText(reasoned);
          return;
        }
        // The proxy declined. Whatever it told us is worth one line in the
        // turn, then the original answer is delivered unchanged.
        o.onOptimiseFailed?.("the proxy did not answer, so this reply is the model's first draft");
      }
      if (text) o.onText(text);
      return;
    }
    // A turn that needs tools cannot be re-asked, so release the held text now.
    if (hold && text) o.onText(text);

    // Text from the pass that requested tools and text from the pass that
    // follows it are separate paragraphs; without this they would be glued
    // together in the transcript ("Building it nowYour lyric video is ready").
    if (text && !text.endsWith("\n")) {
      text += "\n\n";
      o.onText("\n\n");
    }
    msgs.push({
      role: "assistant",
      content: text.trim() || null,
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
  const anthropicTools = o.tools.length
    ? o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    : undefined;
  // Anthropic only caches what sits before an explicit breakpoint. The system
  // prompt and tool schema are identical on every step of a tool loop, so
  // marking them here means each later step reads them from cache instead of
  // re-processing them.
  const cachedSystem = [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }];
  const cachedTools = anthropicTools
    ? anthropicTools.map((t, i) =>
        i === anthropicTools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
      )
    : undefined;

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
        system: cachedSystem,
        messages: msgs,
        stream: true,
        ...(cachedTools ? { tools: cachedTools } : {}),
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
    if (!uses.length) {
      // Anthropic replies in prose. Reasoning was asked for and this loop
      // ignores `optimise`, so without this the level silently did nothing on
      // every Claude reply. The proxy cannot speak the Anthropic wire format,
      // so the honest move is to say so once rather than pretend.
      if (o.optimise) o.onOptimiseFailed?.("reasoning needs an OpenAI-compatible provider; Claude replies run unoptimised");
      return;
    }

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
