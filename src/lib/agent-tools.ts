import "server-only";
import type { Sandbox } from "@e2b/desktop";
import type { Tool, ToolResult } from "@/lib/ai/llm";
import type { ChoicesRecord, StepRecord } from "@/db/schema";
import { ensureDesktop, normalizeUrl, openInBrowser, shot, sleep, type BotRef } from "@/lib/sandbox";

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const ASK: Tool = {
  name: "ask_user",
  description:
    "Show the user a multiple-choice question with 2-5 short options (a 'Something else' option is added automatically). Use when you need the user to pick a direction. After calling this, stop and wait for their reply.",
  parameters: obj(
    {
      question: { type: "string", description: "The question to show." },
      options: { type: "array", items: { type: "string" }, description: "2-5 short answer options." },
    },
    ["question", "options"],
  ),
};

const CORE_TOOLS: Tool[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time in a requested IANA timezone, such as America/New_York or Europe/London.",
    parameters: obj({ timezone: { type: "string" } }, ["timezone"]),
  },
];

const COMPUTER_TOOLS: Tool[] = [
  {
    name: "run_command",
    description:
      "Run a bash command on your Linux desktop computer (Ubuntu). python3, node, curl, git and apt (via sudo) are available. Working directory is /home/user. Returns stdout, stderr and the exit code.",
    parameters: obj({ command: { type: "string" } }, ["command"]),
  },
  {
    name: "web_search",
    description: "Search the web and get back the text of the results page. Also shows the results in the browser on your computer.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "fetch_page",
    description: "Download a web page from your computer and return its readable text (HTML stripped).",
    parameters: obj({ url: { type: "string" } }, ["url"]),
  },
  {
    name: "open_url",
    description: "Open a URL in the browser on your computer so the user can watch it in the Computer panel.",
    parameters: obj({ url: { type: "string" } }, ["url"]),
  },
  {
    name: "write_file",
    description: "Write a text file on your computer. Relative paths are inside /home/user. Files appear in the user's Files panel.",
    parameters: obj({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  },
  {
    name: "read_file",
    description: "Read a text file from your computer.",
    parameters: obj({ path: { type: "string" } }, ["path"]),
  },
  {
    name: "click",
    description: "Left-click at screen coordinates (screen is 1024x768).",
    parameters: obj({ x: { type: "number" }, y: { type: "number" } }, ["x", "y"]),
  },
  {
    name: "type_text",
    description: "Type text with the keyboard into the focused window.",
    parameters: obj({ text: { type: "string" } }, ["text"]),
  },
  {
    name: "press_key",
    description: "Press a key or combination, e.g. 'Return', 'ctrl+l', 'Tab'.",
    parameters: obj({ key: { type: "string" } }, ["key"]),
  },
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s);
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const abs = (p: string) => (p.startsWith("/") ? p : `/home/user/${p.replace(/^\.\//, "")}`);

const STRIP_PY = `import sys,re,html
t=sys.stdin.read()
t=re.sub(r'(?is)<(script|style|noscript|svg|head)[^>]*>.*?</\\1>',' ',t)
t=re.sub(r'(?s)<[^>]+>','\\n',t)
t=html.unescape(t)
t=re.sub(r'[ \\t\\r\\f\\v]+',' ',t)
t=re.sub(r'\\n\\s*\\n+','\\n',t)
print(t.strip()[:14000])
`;

export type ToolsetEvents = {
  onStepStart: (s: { id: string; name: string; label: string }) => void;
  onStepEnd: (s: StepRecord) => void;
  onShot: (b64: string) => void;
  onChoices: (c: ChoicesRecord) => void;
};

export function buildToolset(opts: {
  bot: BotRef;
  e2bKey: string | null;
  wantShots: boolean;
  ev: ToolsetEvents;
  signal: AbortSignal;
}) {
  const { bot, e2bKey, ev } = opts;
  let desktop: Sandbox | null = null;

  const tools: Tool[] = e2bKey ? [ASK, ...CORE_TOOLS, ...COMPUTER_TOOLS] : [ASK, ...CORE_TOOLS];

  async function getDesktop(): Promise<Sandbox> {
    if (desktop) return desktop;
    if (!e2bKey) throw new Error("No E2B key configured.");
    const { sb } = await ensureDesktop(bot, e2bKey);
    desktop = sb;
    return sb;
  }

  async function fetchText(sb: Sandbox, url: string): Promise<string> {
    await sb.files.write("/tmp/strip.py", STRIP_PY);
    const cmd = `curl -sL --max-time 25 -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' ${shq(url)} | python3 /tmp/strip.py`;
    const r = await sb.commands.run(cmd, { timeoutMs: 40_000 }).catch((e: { result?: { stdout?: string; stderr?: string }; message?: string }) => ({
      stdout: e.result?.stdout ?? "",
      stderr: e.result?.stderr ?? e.message ?? "",
    }));
    return r.stdout.trim() || `(no readable content) ${r.stderr}`.trim();
  }

  function labelFor(name: string, a: Record<string, unknown>): string {
    const s = (k: string) => String(a[k] ?? "");
    switch (name) {
      case "run_command":
        return `Ran ${clip(s("command").replace(/\s+/g, " "), 70)}`;
      case "web_search":
        return `Searched “${clip(s("query"), 60)}”`;
      case "fetch_page":
        return `Read ${clip(s("url"), 70)}`;
      case "open_url":
        return `Opened ${clip(s("url"), 70)}`;
      case "write_file":
        return `Wrote ${clip(s("path"), 70)}`;
      case "read_file":
        return `Read file ${clip(s("path"), 70)}`;
      case "click":
        return `Clicked (${s("x")}, ${s("y")})`;
      case "type_text":
        return `Typed “${clip(s("text"), 40)}”`;
      case "press_key":
        return `Pressed ${s("key")}`;
      case "ask_user":
        return "Asked you a question";
      default:
        return name;
    }
  }

  async function exec(name: string, a: Record<string, unknown>): Promise<ToolResult> {
    if (name === "ask_user") {
      const options = (Array.isArray(a.options) ? a.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
      ev.onChoices({ question: String(a.question ?? "Choose one"), options });
      return { output: "The question is now displayed to the user. Stop and wait for their answer.", stop: true };
    }
    const sb = await getDesktop();
    switch (name) {
      case "get_current_time": {
        const timezone = String(a.timezone ?? "UTC");
        try {
          return { output: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "long", timeZone: timezone }).format(new Date()) };
        } catch {
          return { output: `Invalid timezone: ${timezone}. Use an IANA timezone such as UTC or America/New_York.` };
        }
      }
      case "run_command": {
        const cmd = String(a.command ?? "");
        const r = await sb.commands
          .run(cmd, { cwd: "/home/user", timeoutMs: 120_000 })
          .catch((e: { exitCode?: number; stdout?: string; stderr?: string; message?: string }) => ({
            exitCode: e.exitCode ?? 1,
            stdout: e.stdout ?? "",
            stderr: e.stderr ?? e.message ?? "",
          }));
        return { output: clip(`exit code: ${r.exitCode}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`, 12000) };
      }
      case "web_search": {
        const q = String(a.query ?? "");
        openInBrowser(sb, `https://duckduckgo.com/?q=${encodeURIComponent(q)}`).catch(() => {});
        let text = await fetchText(sb, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
        if (text.length < 200) text = await fetchText(sb, `https://www.bing.com/search?q=${encodeURIComponent(q)}`);
        return { output: clip(text, 12000) };
      }
      case "fetch_page": {
        const url = normalizeUrl(String(a.url ?? ""));
        if (!/^https?:/i.test(url)) throw new Error("Only http(s) URLs can be fetched.");
        return { output: clip(await fetchText(sb, url), 12000) };
      }
      case "open_url": {
        await openInBrowser(sb, String(a.url ?? ""));
        await sleep(2500);
        return { output: "Opened in the browser." };
      }
      case "write_file": {
        const path = abs(String(a.path ?? ""));
        await sb.files.write(path, String(a.content ?? ""));
        return { output: `Wrote ${path}` };
      }
      case "read_file": {
        const path = abs(String(a.path ?? ""));
        return { output: clip(await sb.files.read(path), 12000) };
      }
      case "click": {
        await sb.leftClick(Number(a.x), Number(a.y));
        return { output: "Clicked." };
      }
      case "type_text": {
        await sb.write(String(a.text ?? ""));
        return { output: "Typed." };
      }
      case "press_key": {
        const key = String(a.key ?? "");
        await sb.press(key.includes("+") ? key.split("+").map((k) => k.trim()) : key);
        return { output: "Pressed." };
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  }

  async function run(name: string, args: Record<string, unknown>, id: string): Promise<ToolResult> {
    const label = labelFor(name, args);
    ev.onStepStart({ id, name, label });
    if (opts.signal.aborted) throw new Error("aborted");
    try {
      const r = await exec(name, args);
      ev.onStepEnd({ id, name, label, ok: true, output: clip(r.output, 1500) });
      if (desktop && opts.wantShots && name !== "ask_user") {
        const b = await shot(desktop);
        if (b) ev.onShot(b);
      }
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Tool failed";
      ev.onStepEnd({ id, name, label, ok: false, output: clip(msg, 800) });
      return { output: `Error: ${msg}` };
    }
  }

  return { tools, run };
}
