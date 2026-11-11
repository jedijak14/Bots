import "server-only";
import type { Sandbox } from "@e2b/desktop";
import path from "node:path";
import type { Tool, ToolResult } from "@/lib/ai/llm";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, privacySessions, type ChoicesRecord, type StepRecord } from "@/db/schema";
import { getConnectionToken } from "@/lib/connectors";
import { TOOL_CONNECTOR } from "@/lib/skill-permissions";
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
    name: "save_artifact",
    description: "Save a story, document, website source, or other substantial work to the user's Artifacts library so they can open it later.",
    parameters: obj({ title: { type: "string" }, kind: { type: "string", enum: ["story", "document", "html", "website"] }, content: { type: "string" } }, ["title", "kind", "content"]),
  },
  {
    name: "draft_email",
    description: "Prepare an email draft for the user to review. It will not be sent until the user presses Send in Artifacts.",
    parameters: obj({ to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, ["to", "subject", "body"]),
  },
  {
    name: "search_gmail",
    description: "Search the user's Gmail and return message subjects, senders, dates, and short snippets only.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "search_youtube",
    description: "Search YouTube videos using the user's connected Google account. Returns video titles and links only.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "search_notion",
    description: "Search the user's connected Notion workspace. Returns page titles and links only.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "list_saved_spotify_tracks",
    description: "List up to 10 of the user's most recently saved Spotify tracks, including track, artist, album, and link.",
    parameters: obj({}, []),
  },
  {
    name: "list_github_repositories",
    description: "List the user's recently updated GitHub repositories.",
    parameters: obj({}, []),
  },
  {
    name: "list_vercel_projects",
    description: "List the user's Vercel projects.",
    parameters: obj({}, []),
  },
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
const HOME_DIR = "/home/user";
const safePath = (input: string) => {
  const raw = input.trim();
  if (!raw) throw new Error("A file path is required.");
  const resolved = path.posix.resolve(raw.startsWith("/") ? raw : path.posix.join(HOME_DIR, raw));
  if (resolved !== HOME_DIR && !resolved.startsWith(`${HOME_DIR}/`)) throw new Error("File paths must stay inside /home/user.");
  return resolved;
};
const SCREEN_TOOLS = new Set(["run_command", "web_search", "open_url", "click", "type_text", "press_key"]);

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
  userId: string;
  bot: BotRef;
  e2bKey: string | null;
  wantShots: boolean;
  ev: ToolsetEvents;
  signal: AbortSignal;
  allowedTools?: string[];
  allowedConnectors?: string[];
}) {
  const { userId, bot, e2bKey, ev } = opts;
  let stripScriptReady = false;
  let lastShotAt = 0;
  let lastShot: string | null = null;
  const captureShot = async (sb: Sandbox) => {
    if (lastShot && Date.now() - lastShotAt < 300) return lastShot;
    lastShot = await shot(sb);
    lastShotAt = Date.now();
    return lastShot;
  };
  const toolAllowlist = opts.allowedTools === undefined ? null : new Set(opts.allowedTools);
  const connectorAllowlist = opts.allowedConnectors === undefined ? null : new Set(opts.allowedConnectors);
  let desktop: Sandbox | null = null;

  const allTools = e2bKey ? [ASK, ...CORE_TOOLS, ...COMPUTER_TOOLS] : [ASK, ...CORE_TOOLS];
  const tools: Tool[] = allTools.filter((tool) => tool.name === "ask_user" || !toolAllowlist || toolAllowlist.has(tool.name));

  async function getDesktop(): Promise<Sandbox> {
    if (desktop) return desktop;
    if (!e2bKey) throw new Error("No E2B key configured.");
    const { sb } = await ensureDesktop(bot, e2bKey);
    desktop = sb;
    return sb;
  }

  async function fetchText(sb: Sandbox, url: string): Promise<string> {
    if (!stripScriptReady) {
      await sb.files.write("/tmp/strip.py", STRIP_PY);
      stripScriptReady = true;
    }
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
      case "save_artifact":
        return `Saved artifact “${clip(s("title"), 55)}”`;
      case "draft_email":
        return `Prepared email draft for ${clip(s("to"), 55)}`;
      case "search_gmail":
        return "Searched Gmail";
      case "search_youtube":
      case "search_notion":
        return `Searched ${name === "search_youtube" ? "YouTube" : "Notion"}`;
      case "list_github_repositories":
        return "Listed GitHub repositories";
      case "list_vercel_projects":
        return "Listed Vercel projects";
      case "list_saved_spotify_tracks":
        return "Listed saved Spotify tracks";
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
    if (name === "get_current_time") {
      const timezone = String(a.timezone ?? "UTC");
      try { return { output: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "long", timeZone: timezone }).format(new Date()) }; }
      catch { return { output: `Invalid timezone: ${timezone}. Use an IANA timezone such as UTC or America/New_York.` }; }
    }
    if (name === "save_artifact" || name === "draft_email") {
      const title = String(a.title ?? (name === "draft_email" ? `Email to ${String(a.to ?? "recipient")}` : "Untitled artifact")).trim().slice(0, 160);
      const kind = name === "draft_email" ? "email_draft" : String(a.kind ?? "document");
      const content = name === "draft_email" ? JSON.stringify({ to: String(a.to ?? "").trim(), subject: String(a.subject ?? "").trim(), body: String(a.body ?? "") }) : String(a.content ?? "");
      if (!title || !content || content.length > 100_000) return { output: "The artifact needs a title and content under 100 KB." };
      if (name === "draft_email" && (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(a.to ?? "").trim()) || /[\\r\\n]/.test(String(a.subject ?? "")))) return { output: "That email draft has an invalid recipient or subject." };
      const [saved] = await db.insert(artifacts).values({ botId: bot.id, userId, title, kind, content }).returning({ id: artifacts.id });
      return { output: name === "draft_email" ? `Email draft saved to Artifacts (id ${saved.id}). It has not been sent; the user must review and press Send.` : `Saved to Artifacts (id ${saved.id}).` };
    }
    if (["search_gmail", "search_youtube", "search_notion", "list_github_repositories", "list_vercel_projects", "list_saved_spotify_tracks"].includes(name)) {
      const provider = name === "search_gmail" || name === "search_youtube" ? "google" : name === "search_notion" ? "notion" : name === "list_github_repositories" ? "github" : name === "list_vercel_projects" ? "vercel" : "spotify";
      let token: string;
      try { token = await getConnectionToken(provider, userId); }
      catch { return { output: `Connect your ${provider === "google" ? "Google" : provider[0].toUpperCase() + provider.slice(1)} account in Settings > Connections to use this tool.` }; }
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      try {
        if (name === "list_saved_spotify_tracks") {
          const response = await fetch("https://api.spotify.com/v1/me/tracks?limit=10", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("Spotify request failed.");
          const data = await response.json();
          return { output: JSON.stringify((data.items ?? []).map((item: { added_at?: string; track?: { name?: string; artists?: Array<{ name?: string }>; album?: { name?: string }; external_urls?: { spotify?: string } } }) => ({ title: item.track?.name, artists: item.track?.artists?.map((artist) => artist.name), album: item.track?.album?.name, addedAt: item.added_at, url: item.track?.external_urls?.spotify }))) };
        }
        if (name === "search_gmail") {
          const query = String(a.query ?? "").trim().slice(0, 200);
          if (!query) return { output: "Provide a Gmail search query." };
          const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
          url.searchParams.set("q", query);
          url.searchParams.set("maxResults", "5");
          const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("Gmail search failed.");
          const data = await response.json();
          const messages = await Promise.all((data.messages ?? []).map(async (message: { id: string }) => {
            const detail = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
            if (!detail.ok) return null;
            const item = await detail.json();
            const headers = item.payload?.headers ?? [];
            return { subject: headers.find((header: { name: string }) => header.name.toLowerCase() === "subject")?.value, from: headers.find((header: { name: string }) => header.name.toLowerCase() === "from")?.value, date: headers.find((header: { name: string }) => header.name.toLowerCase() === "date")?.value, snippet: item.snippet };
          }));
          return { output: JSON.stringify(messages.filter(Boolean)) };
        }
        if (name === "search_youtube") {
          const query = String(a.query ?? "").trim().slice(0, 200);
          const url = new URL("https://www.googleapis.com/youtube/v3/search");
          url.searchParams.set("part", "snippet"); url.searchParams.set("type", "video"); url.searchParams.set("maxResults", "5"); url.searchParams.set("q", query);
          const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("YouTube search failed.");
          const data = await response.json();
          return { output: JSON.stringify((data.items ?? []).map((item: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }) => ({ title: item.snippet?.title, channel: item.snippet?.channelTitle, url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : undefined }))) };
        }
        if (name === "search_notion") {
          const response = await fetch("https://api.notion.com/v1/search", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" }, body: JSON.stringify({ query: String(a.query ?? "").trim().slice(0, 200), page_size: 10 }), cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("Notion search failed.");
          const data = await response.json();
          return { output: JSON.stringify((data.results ?? []).map((page: { id: string; url?: string; title?: Array<{ plain_text?: string }>; properties?: Record<string, { title?: Array<{ plain_text?: string }> }> }) => ({ id: page.id, url: page.url, title: page.title?.map((part) => part.plain_text).join("") ?? Object.values(page.properties ?? {}).find((p) => p.title)?.title?.map((part) => part.plain_text).join("") })) ) };
        }
        if (name === "list_github_repositories") {
          const response = await fetch("https://api.github.com/user/repos?sort=updated&per_page=10", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("GitHub request failed.");
          const data = await response.json();
          return { output: JSON.stringify(data.map((repo: { full_name: string; html_url: string; description?: string; private: boolean }) => ({ name: repo.full_name, url: repo.html_url, description: repo.description, private: repo.private }))) };
        }
        const response = await fetch("https://api.vercel.com/v9/projects?limit=20", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
        if (!response.ok) throw new Error("Vercel request failed.");
        const data = await response.json();
        return { output: JSON.stringify((data.projects ?? []).map((project: { name: string; id: string; link?: { repo?: string } }) => ({ name: project.name, id: project.id, repository: project.link?.repo }))) };
      } catch { return { output: `Could not access ${provider}. Check the connection and requested permissions in Settings > Connections.` }; }
    }
    const sb = await getDesktop();
    switch (name) {
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
        await sleep(900);
        return { output: "Opened in the browser." };
      }
      case "write_file": {
        const path = safePath(String(a.path ?? ""));
        await sb.files.write(path, String(a.content ?? ""));
        return { output: `Wrote ${path}` };
      }
      case "read_file": {
        const path = safePath(String(a.path ?? ""));
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
      if (toolAllowlist && name !== "ask_user" && !toolAllowlist.has(name)) throw new Error("This tool is not allowed by the Bot's enabled skills.");
      const connector = TOOL_CONNECTOR[name];
      if (connector && connectorAllowlist && !connectorAllowlist.has(connector)) throw new Error("This connected account is not allowed by the Bot's enabled skills.");
      const [privacySession] = await db.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, userId), eq(privacySessions.status, "active"))).limit(1);
      if (privacySession) throw new Error("Privacy Mode is active. Bot tools are paused until you press I'm Done.");
      const r = await exec(name, args);
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      ev.onStepEnd({ id, name, label, ok: true, output: clip(r.output, 1500) });
      if (desktop && opts.wantShots && SCREEN_TOOLS.has(name) && !opts.signal.aborted) {
        const b = await captureShot(desktop);
        if (b && !opts.signal.aborted) ev.onShot(b);
      }
      return r;
    } catch (e) {
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      const msg = e instanceof Error ? e.message : "Tool failed";
      ev.onStepEnd({ id, name, label, ok: false, output: clip(msg, 800) });
      return { output: `Error: ${msg}` };
    }
  }

  return { tools, run };
}
