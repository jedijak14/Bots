import "server-only";
import { splitRecipients } from "./email";
import type { Sandbox } from "@e2b/desktop";
import path from "node:path";
import type { Tool, ToolResult } from "@/lib/ai/llm";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, privacySessions, type ChoicesRecord, type StepRecord } from "@/db/schema";
import { getConnectionToken } from "@/lib/connectors";
import { TOOL_CONNECTOR } from "@/lib/skill-permissions";
import { ensureDesktop, normalizeUrl, openInBrowser, shot, sleep, type BotRef } from "@/lib/sandbox";
import { runLibraryTool, runPackTool } from "@/lib/pack-tools";
import { LIBRARY_META_TOOLS, libraryToolByName, searchToolLibrary, WEAK_MATCH_SCORE } from "@/lib/tool-library";
import { helperSummary, helpersFor, spawnHelper, waitForHelpers, type Helper } from "@/lib/helpers";

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const ASK: Tool = {
  name: "ask_user",
  description:
    "Ask the user a multiple-choice question with 2-5 short options. After calling this, stop and wait for their reply.",
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
    name: "goals",
    description:
      "Read and change the shared goal list every Bot can see. Actions: list (default), add, update, complete, remove. Use it when the user sets an intention ('I want to launch by June'), when you finish something on it, or when they ask what is left. Give status as open, doing or done.",
    parameters: obj(
      {
        action: { type: "string", enum: ["list", "add", "update", "complete", "remove"], description: "What to do. Defaults to list." },
        id: { type: "string", description: "Goal id, for update/complete/remove." },
        title: { type: "string", description: "Short goal title, for add/update." },
        detail: { type: "string", description: "Optional detail or acceptance criteria." },
        status: { type: "string", enum: ["open", "doing", "done"], description: "New status, for update." },
        due: { type: "string", description: "Optional ISO date the goal is due." },
      },
      [],
    ),
  },
  {
    name: "make_lyric_video",
    description:
      "Build a lyric video from a song and lyrics the user uploaded. Use the artifact ids from their upload message. Prefer lyricsId over retyping the file.",
    parameters: obj(
      {
        title: { type: "string", description: "Song title." },
        artist: { type: "string", description: "Artist, if known." },
        audioId: { type: "string", description: "Artifact id of the uploaded song." },
        artId: { type: "string", description: "Artifact id of the uploaded cover art, if any." },
        lyricsId: { type: "string", description: "Artifact id of the uploaded lyrics file (preferred)." },
        lyrics: { type: "string", description: "Only when there is no lyrics artifact: the lyrics text, verbatim." },
        lyricFormat: { type: "string", enum: ["lrc", "srt", "ttml", "qrc", "plain"], description: "Format of the lyrics text, if known." },
        preset: { type: "string", enum: ["aurora", "ember", "mint", "mono"], description: "Colour look. Defaults to aurora." },
        accent: { type: "string", description: "Optional CSS colour for the sung line." },
      },
      ["title", "audioId"],
    ),
  },
  {
    name: "save_artifact",
    description: "Save substantial work (story, document, website source) to Artifacts. It appears as a chat card immediately.",
    parameters: obj({ title: { type: "string" }, kind: { type: "string", enum: ["story", "document", "html", "website"] }, content: { type: "string" } }, ["title", "kind", "content"]),
  },
  {
    name: "draft_email",
    description: "Draft an email. It appears as an editable card with a Send button and is never sent without the user pressing it.",
    parameters: obj(
      {
        to: { type: "string", description: "Recipient address, or several separated by commas. Display names are fine: Ada <ada@example.com>." },
        subject: { type: "string", description: "One line, no line breaks." },
        body: { type: "string", description: "Plain text body." },
      },
      ["to", "subject", "body"],
    ),
  },
  {
    name: "search_gmail",
    description: "Search the user's Gmail. Returns subjects, senders, dates and short snippets only.",
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
    description: "List the user's 10 most recently saved Spotify tracks.",
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
    description: "Current date and time in an IANA timezone (e.g. America/New_York).",
    parameters: obj({ timezone: { type: "string" } }, ["timezone"]),
  },
];

/**
 * A workspace that exists without a computer.
 *
 * `write_file` and `read_file` need a desktop, so an account with no E2B key
 * could not keep a scratch file between two calls — every multi-step job that
 * needs a note, a draft, or a slice of a long document had to hold it in the
 * conversation. These store the same thing as artifacts, which every account
 * already has, and are found back by path. They are deliberately named
 * differently from the desktop tools so a model cannot confuse a path on a
 * machine with a path in the workspace.
 */
const WORKSPACE_TOOLS: Tool[] = [
  {
    name: "workspace_write",
    description:
      "Save a named file in this Bot's workspace, so it survives between steps and turns. Use it for notes, drafts, or a slice of data you will need again. Works with no computer. Overwrites a file of the same path.",
    parameters: obj(
      {
        path: { type: "string", description: "Name for the file, e.g. notes.md or data/rows.json" },
        content: { type: "string", description: "Exact contents to store." },
      },
      ["path", "content"],
    ),
  },
  {
    name: "workspace_read",
    description:
      "Read back a file saved with workspace_write, by path. Also lists the workspace when called with no path. A file too long for one reply comes back a slice at a time: the reply says which slice, how many there are, and the offsets to ask for the next one.",
    parameters: obj(
      {
        path: { type: "string", description: "Path to read. Leave empty to list what is stored." },
        offset: { type: "number", description: "Character offset to start from, for a long file. Leave empty for the start." },
      },
      [],
    ),
  },
];

/** How much of a long file one workspace_read returns. */
const PART_CHARS = 20_000;

/**
 * Arithmetic the model cannot do in its head.
 *
 * A small model gets long division, percentages and date maths wrong often
 * enough to matter, and without a computer there was nothing to check it
 * against — `run_command` needs a desktop. This evaluates a single expression
 * with no names, no calls and no state, so it cannot reach anything: the input
 * is checked against an allowlist of characters and the parser only ever sees
 * numbers and operators.
 */
const CALC_TOOL: Tool = {
  name: "calculate",
  description:
    "Do exact arithmetic. Use it for any sum you would otherwise estimate: percentages, division, unit conversion, compound growth. Accepts numbers, + - * / % ** and parentheses, plus sqrt, abs, round, floor, ceil, min, max and pi. Works with no computer.",
  parameters: obj({ expression: { type: "string", description: "e.g. (1250 * 0.08) / 3 or sqrt(2) * 100" } }, ["expression"]),
};

/**
 * Check written code and data before it is presented as finished.
 *
 * A small model's JSON is wrong about as often as it is right — a trailing
 * comma, a single quote, a key it forgot to close — and it has no way to find
 * out, because it cannot run anything. The same goes for a regex it never
 * compiles and an HTML page with an unclosed tag. Nothing here executes what it
 * is given: JSON is parsed with JSON.parse, a regex is compiled, and HTML is
 * counted tag by tag.
 */
const CHECK_TOOL: Tool = {
  name: "check_code",
  description:
    "Check something you wrote before you hand it over. Use it on JSON you generated (kind json), a regular expression (kind regex), HTML (kind html), or a JavaScript expression (kind js). Returns either 'It parses' or the exact line and problem. Nothing is executed. Works with no computer.",
  parameters: obj(
    {
      kind: { type: "string", enum: ["json", "regex", "html", "js"], description: "What kind of text this is." },
      text: { type: "string", description: "The exact text to check." },
    },
    ["kind", "text"],
  ),
};

/** The line and column of an offset, so a model can fix the right place. */
function where(text: string, index: number): string {
  const before = text.slice(0, Math.max(0, index));
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  return `line ${line}, column ${column}`;
}

/** Count HTML tags, ignoring void elements and anything inside a comment. */
function htmlProblem(html: string): string | null {
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "!doctype"]);
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const stack: { tag: string; at: number }[] = [];
  const re = /<(\/?)([a-zA-Z!][\w:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const [, closing, rawName, rest, selfClose] = m;
    const tag = rawName.toLowerCase();
    if (tag === "!doctype" || VOID.has(tag) || selfClose || /\/$/.test(rest ?? "")) continue;
    if (!closing) {
      stack.push({ tag, at: m.index });
    } else {
      const open = stack.pop();
      if (!open) return `</${tag}> closes a tag that was never opened (${where(html, m.index)}).`;
      if (open.tag !== tag) return `</${tag}> closes <${open.tag}> that opened at ${where(html, open.at)} (${where(html, m.index)}).`;
    }
  }
  if (stack.length) {
    const last = stack[stack.length - 1];
    return `<${last.tag}> opened at ${where(html, last.at)} is never closed.`;
  }
  return null;
}

function checkCode(kind: string, text: string): string {
  const body = text.trim();
  if (!body) return "There is nothing to check: the text was empty.";
  if (kind === "json") {
    try {
      const value = JSON.parse(body) as unknown;
      const shape = Array.isArray(value) ? `an array of ${value.length}` : value && typeof value === "object" ? `an object with ${Object.keys(value as object).length} key${Object.keys(value as object).length === 1 ? "" : "s"}` : `a ${typeof value}`;
      return `It parses: ${shape}.`;
    } catch (e) {
      const message = e instanceof Error ? e.message : "invalid JSON";
      // V8 reports "at position N"; turning that into a line and column is the
      // difference between a hint and something a model can act on.
      const pos = /position (\d+)/.exec(message);
      const at = pos ? ` (${where(body, Number(pos[1]))})` : "";
      const nearby = pos ? `\nNear: ${body.slice(Math.max(0, Number(pos[1]) - 40), Number(pos[1]) + 40).replace(/\n/g, " ")}` : "";
      return `Invalid JSON${at}: ${message}.${nearby}`;
    }
  }
  if (kind === "regex") {
    const src = body.replace(/^\//, "").replace(/\/[a-z]*$/i, "");
    try {
      new RegExp(src);
      return "It compiles.";
    } catch (e) {
      return `That regular expression does not compile: ${e instanceof Error ? e.message : "unknown problem"}.`;
    }
  }
  if (kind === "html") {
    const problem = htmlProblem(body);
    return problem ?? "Every tag is opened and closed in order.";
  }
  if (kind === "js") {
    // Parsed, never run: the whole program is wrapped in a function that is
    // never called, so a syntax error surfaces and nothing else happens.
    try {
      new Function(body);
      return "It parses as JavaScript.";
    } catch (e) {
      return `That is not valid JavaScript: ${e instanceof Error ? e.message : "unknown problem"}.`;
    }
  }
  return `Unknown kind “${kind}”. Use json, regex, html or js.`;
}

/**
 * Reading the web without a computer.
 *
 * `web_search` and `fetch_page` run `curl` inside the desktop sandbox, so an
 * account with no E2B key had no way to look anything up at all — and the
 * system prompt told it to say so. But searching and reading a page are plain
 * HTTP; nothing about them needs a machine. These two do the same work from the
 * server, and the desktop versions are still preferred when one exists because
 * there the page renders the way a person would see it.
 *
 * These are `look_up` and `read_link`, not `search_web` / `open_page`: the 957
 * tool library already uses `search_web` for a planner stub that writes a brief
 * and does no searching at all.
 */
async function httpRaw(url: string, signal?: AbortSignal): Promise<string> {
  const res = await doFetch(url, signal);
  if (!res.ok) throw new Error(`That page answered ${res.status}.`);
  return (await res.text()).slice(0, 400_000);
}

async function httpText(url: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await doFetch(url, signal);
  } catch (e) {
    // A bare "fetch failed" gives a model nothing to act on and gives the user
    // nothing to fix. Name the failure the way the chat route already names
    // provider failures.
    const code = (e as Error & { cause?: { code?: string } }).cause?.code ?? "";
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) throw new Error(`The address for ${hostOf(url)} could not be resolved.`);
    if (/CERT|TLS|SSL|VERIFY|LEAF|SIGNATURE/i.test(code)) throw new Error(`The certificate for ${hostOf(url)} could not be verified.`);
    if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR/.test(code)) throw new Error(`${hostOf(url)} did not respond.`);
    throw new Error(`Could not reach ${hostOf(url)}.`);
  }
  if (!res.ok) {
    throw new Error(`That page answered ${res.status}. ${res.status === 403 || res.status === 429 ? "It is likely blocking automated reads; tell the user the link and what to open." : ""}`.trim());
  }
  const type = res.headers.get("content-type") ?? "";
  if (/json|xml|text\/plain|csv/.test(type)) return (await res.text()).slice(0, 60_000);
  return stripHtml(await res.text());
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "that address";
  }
}

async function doFetch(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    signal,
    redirect: "follow",
    headers: {
      // DuckDuckGo's HTML endpoint answers this UA and refuses a bare one; most
      // sites serve a readable page rather than a bot wall for the same reason.
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    },
  });
}

/** Turn a page into the words on it. Deliberately crude: tags out, entities in. */
function stripHtml(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

const WEB_TOOLS: Tool[] = [
  {
    name: "look_up",
    description:
      "Search the live web and get back a numbered list of results with their links. Use it for anything current, factual, or that you are not certain of — then read the one that matters with read_link. Works with no computer.",
    parameters: obj(
      { query: { type: "string", description: "What to search for." } },
      ["query"],
    ),
  },
  {
    name: "read_link",
    description:
      "Fetch a web page and return the text on it, with scripts and styling removed. Use it after look_up, or on any link the user gives you. Works with no computer.",
    parameters: obj({ url: { type: "string", description: "The http or https address." } }, ["url"]),
  },
];

/** The links in a DuckDuckGo HTML result page, in the order they appear. */
function resultLinks(html: string): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 8) {
    // DuckDuckGo wraps the destination in /l/?uddg=<encoded>.
    const raw = m[1].replace(/&amp;/g, "&");
    const target = /uddg=([^&]+)/.exec(raw);
    const url = target ? decodeURIComponent(target[1]) : raw;
    const title = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (/^https?:/i.test(url) && title) out.push({ title, url });
  }
  return out;
}

async function searchWeb(query: string, signal?: AbortSignal): Promise<string> {
  const q = encodeURIComponent(query);
  // The links have to come out of the markup, so this one reads the page raw:
  // `httpText` returns the words with every tag removed, and an `<a href>` is
  // precisely what a search result is.
  const html = await httpRaw(`https://html.duckduckgo.com/html/?q=${q}`, signal).catch(() => "");
  const links = resultLinks(html);
  if (links.length) {
    // The snippets are worth less than the pages themselves, and clickable
    // addresses are what a model needs to take the next step.
    return [
      `Results for “${query}”:`,
      ...links.map((l, n) => `${n + 1}. ${l.title}\n   ${l.url}`),
      "Call read_link on the one that looks right to read it.",
    ].join("\n");
  }
  // DuckDuckGo turned us away; Bing is a second opinion, and its text is still
  // a real list of results even without the link extraction.
  const fallback = await httpText(`https://www.bing.com/search?q=${q}`, signal).catch(() => "");
  if (fallback.length > 200) return clip(fallback, 8000);
  throw new Error("The search engines did not answer. Try read_link on a specific address instead, or tell the user you could not look it up.");
}

/**
 * Evaluate an arithmetic expression.
 *
 * Not `eval`: the expression is parsed here, so `process.exit()` is a syntax
 * error rather than a call. Numbers and the functions below are the whole
 * language.
 */
function evaluate(expression: string): number {
  // `Math.sqrt(…)` and `Math.PI` are what models write out of habit; the prefix
  // carries no meaning here and removing it early keeps the parser small.
  const src = expression.replace(/\s+/g, "").replace(/Math\./g, "");
  if (!src) throw new Error("Empty expression.");
  if (src.length > 300) throw new Error("That expression is too long.");
  if (!/^[0-9+\-*/%^().,a-z]+$/i.test(src)) throw new Error("Only numbers, operators, parentheses and the listed functions are allowed.");
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    if (peek() === "(") {
      i++;
      const v = sum();
      if (peek() !== ")") throw new Error("Missing a closing parenthesis.");
      i++;
      return v;
    }
    if (peek() === "-") {
      i++;
      return -number();
    }
    if (peek() === "+") {
      i++;
      return number();
    }
    // `Math.` is stripped up front rather than handled here, but a model also
    // writes `Math.sqrt(…)` mid-expression, so drop the prefix wherever it
    // appears before parsing.
    const call = /^(sqrt|abs|round|floor|ceil|min|max|pi)/i.exec(src.slice(i));
    if (call) {
      const name = call[1].toLowerCase();
      i += call[1].length;
      if (name === "pi") {
        if (peek() === "(") i += 2;
        return Math.PI;
      }
      let args: number[] = [];
      if (peek() === "(") {
        i++;
        args = [sum()];
        while (peek() === ",") {
          i++;
          args.push(sum());
        }
        if (peek() !== ")") throw new Error(`Missing a closing parenthesis after ${name}(.`);
        i++;
      } else {
        throw new Error(`${name} needs parentheses, e.g. ${name}(9).`);
      }
      const fns: Record<string, (...xs: number[]) => number> = {
        sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
        ceil: Math.ceil, min: Math.min, max: Math.max,
      };
      return fns[name](...args);
    }
    const m = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i));
    if (!m) {
      const bad = src.slice(i, i + 14);
      throw new Error(
        /[a-z]/i.exec(bad) && !/^(sqrt|abs|round|floor|ceil|min|max|pi)/i.test(bad)
          ? `"${bad}" is not a number or one of the allowed functions. Only arithmetic is supported — there is no code to run.`
          : `Expected a number at position ${i + 1}.`,
      );
    }
    i += m[0].length;
    return Number(m[0]);
  };
  const power = (): number => {
    const base = number();
    if (peek() === "^") {
      i++;
      return Math.pow(base, power());
    }
    if (src.startsWith("**", i)) {
      i += 2;
      return Math.pow(base, power());
    }
    return base;
  };
  const product = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = src[i++];
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const result = sum();
  if (i !== src.length) throw new Error(`Unexpected "${src.slice(i, i + 12)}" at position ${i + 1}.`);
  if (!Number.isFinite(result)) throw new Error("That does not have a finite answer.");
  return result;
}

const COMPUTER_TOOLS: Tool[] = [
  {
    name: "run_command",
    description:
      "Run a bash command on your Linux desktop computer (Ubuntu). python3, node, curl, git and apt (via sudo) are available. Working directory is /home/user. Returns stdout, stderr and the exit code.",
    parameters: obj({ command: { type: "string" } }, ["command"]),
  },
  {
    name: "build_toolchain",
    description:
      "Install a real compiler toolchain on your computer and prove it works. Use this before building an Android app or a native Windows .exe — the plain desktop image has neither. " +
      'kind: "android" installs the Android SDK command-line tools, platform, build-tools and accepts licences; "windows-exe" installs the MinGW-w64 cross-compiler so C, C++ and Rust produce genuine PE32+ .exe files that run on Windows without Electron or a browser; "all" does both. ' +
      "Returns the versions it found after install, so a failed install is visible rather than assumed.",
    parameters: obj(
      {
        kind: { type: "string", enum: ["android", "windows-exe", "all"] },
      },
      ["kind"],
    ),
  },
  CALC_TOOL,
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
    description: "Write a text file on your computer. Relative paths are inside /home/user. Files appear in the Files tab of the user's Computer panel, and .html files can be viewed in its Preview tab.",
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

/**
 * Run a command on the desktop and return its output regardless of failure.
 *
 * `run_command` reports the exit code to the model and lets it decide; a
 * toolchain install needs the opposite — the versions printed even when apt or
 * a download half-failed, because "which of these actually landed" is the whole
 * question. Errors become text here, never exceptions.
 */
async function sh(sb: Sandbox, command: string, timeoutMs: number): Promise<string> {
  const r = await sb.commands.run(command, { cwd: "/home/user", timeoutMs }).catch((e: { exitCode?: number; stdout?: string; stderr?: string; message?: string }) => ({
    exitCode: e.exitCode ?? 1,
    stdout: e.stdout ?? "",
    stderr: e.stderr ?? e.message ?? "",
  }));
  const text = `exit ${r.exitCode ?? 0}\n${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
  return clip(text, 3000);
}

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
  /**
   * Which connected accounts actually exist for this user. Tools belonging to
   * an account that is not connected are useless — the model can only call
   * them to get an error — and their schemas are re-sent on every step of every
   * tool loop. Omit the list to keep them all (used where connections are not
   * relevant, e.g. tests).
   */
  connected?: Set<string>;
  /**
   * Tools from the capability packs the request matched, with a turn id that
   * scopes any Helper Bots it starts.
   */
  packTools?: Tool[];
  /** The user message, used to pre-select a few library tools. */
  libraryQuery?: string;
  /** The account's image provider, for generate_image. */
  imageConfig?: {
    provider: import("@/lib/ai/providers").ProviderId;
    apiKey: string;
    baseUrl: string;
    imageModel?: string | null;
  };
  turnId: string;
  /** Display name of the Bot, used when a Helper introduces itself. */
  botName?: string;
  onHelper?: (helper: Helper) => void;
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

  // The library is large, so the model always gets the two meta-tools that can
  // reach all of it, and only the handful a request actually matches goes in
  // the schema. That is the difference between "a thousand tools available" and
  // "a thousand tool definitions in every prompt".
  const libraryMatches = opts.libraryQuery ? searchToolLibrary(opts.libraryQuery, 8) : [];
  const matchedLibraryTools = libraryMatches
    .map((match) => match.tool)
    // The 957-tool library contains planner stubs — `search_web` among them —
    // that save a brief and return instructions instead of doing the work. When
    // one shares a name with a real implementation, the stub wins by appearing
    // later in the schema, and the user gets "search_web is ready to run" for a
    // simple web search. A stub is never worth a name that is already taken.
    .filter((tool) => ![...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, CHECK_TOOL, ...WEB_TOOLS, ...(e2bKey ? COMPUTER_TOOLS : []), ...(opts.packTools ?? [])].some((real) => real.name === tool.name));
  // With a desktop, `web_search` and `fetch_page` do this job inside the
  // sandbox. Without one these are the only way to read the web, so the two
  // sets are never both in the schema — a model choosing between `web_search`
  // and `search_web` would waste a step working out the difference.
  const webTools = e2bKey ? [] : WEB_TOOLS;
  const allTools = e2bKey
    ? [ASK, ...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, CHECK_TOOL, ...COMPUTER_TOOLS, ...(opts.packTools ?? []), ...LIBRARY_META_TOOLS, ...matchedLibraryTools]
    : [ASK, ...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, CHECK_TOOL, ...webTools, ...(opts.packTools ?? []), ...LIBRARY_META_TOOLS, ...matchedLibraryTools];
  const tools: Tool[] = allTools.filter((tool) => {
    if (tool.name === "ask_user") return true;
    if (toolAllowlist && !toolAllowlist.has(tool.name)) return false;
    const connector = TOOL_CONNECTOR[tool.name];
    if (connector && opts.connected && !opts.connected.has(connector)) return false;
    return true;
  });

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
      case "calculate":
        return `Calculated ${clip(s("expression"), 50)}`;
      case "check_code":
        return `Checked the ${clip(s("kind"), 10)}`;
      case "look_up":
        return `Searched “${clip(s("query"), 60)}”`;
      case "read_link":
        return `Read ${clip(s("url"), 70)}`;
      case "workspace_write":
        return `Saved ${clip(s("path"), 60)} to the workspace`;
      case "workspace_read":
        return s("path") ? `Read ${clip(s("path"), 60)}` : "Listed the workspace";
      case "build_toolchain":
        return s("kind") === "android" ? "Installed the Android SDK" : s("kind") === "windows-exe" ? "Installed the Windows .exe compiler" : "Installed Android and .exe toolchains";
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
      case "design_brief":
        return `Wrote the design brief for “${clip(s("title"), 50)}”`;
      case "make_asset_sheet":
        return `Planned ${s("count")} ${s("kind") || "assets"}`;
      case "draw_asset":
        return `Drew “${clip(s("title"), 50)}”`;
      case "game_design":
        return `Designed “${clip(s("title"), 50)}”`;
      case "scaffold_game":
        return `Built the game “${clip(s("title"), 50)}”`;
      case "scaffold_site":
        return `Built the page “${clip(s("title"), 50)}”`;
      case "scaffold_motion":
        return `Built the animation “${clip(s("title"), 50)}”`;
      case "playtest_game":
        return "Playtested the game";
      case "motion_storyboard":
        return `Storyboarded “${clip(s("title"), 50)}”`;
      case "site_plan":
        return `Planned the site “${clip(s("title"), 50)}”`;
      case "audit_page":
        return "Audited the page";
      case "spawn_helper":
        return `Started a helper: ${clip(s("name"), 40)}`;
      case "helper_status":
        return "Checked the helpers";
      default:
        return name;
    }
  }

  async function exec(name: string, a: Record<string, unknown>): Promise<ToolResult> {
    if (name === "ask_user") {
      const options = (Array.isArray(a.options) ? a.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
      ev.onChoices({ question: String(a.question ?? "Choose one"), options, ...(a.privacy === true ? { action: "privacy" as const } : {}) });
      return { output: "The question is now displayed to the user. Stop and wait for their answer.", stop: true };
    }
    if (name === "get_current_time") {
      const timezone = String(a.timezone ?? "UTC");
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "long", timeZone: timezone }).format(now);
        // "Next Tuesday" and "in three weeks" are where a small model guesses:
        // it knows today, then does the calendar in its head and gets the
        // weekday wrong. Naming the nearby days costs nothing and removes the
        // guess entirely.
        const nearby = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now.getTime() + (i + 1) * 86_400_000);
          // The weekday has to be read in the requested zone, not the server's.
          const name = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: timezone }).format(d);
          return `- ${name}${i === 0 ? " (tomorrow)" : ""}`;
        });
        const today = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(now);
        return {
          output: `${formatted}\nToday is ${today} there. The next seven days:\n${nearby.join("\n")}`,
        };
      } catch {
        return { output: `Invalid timezone: ${timezone}. Use an IANA timezone such as UTC or America/New_York.` };
      }
    }
    if (name === "goals") {
      const action = String(a.action ?? "list");
      const { listGoals, addGoal, updateGoal, deleteGoal, goalsForPrompt } = await import("@/lib/goals");
      if (action === "list") {
        const list = await listGoals(userId);
        if (!list.length) return { output: "The goal list is empty. Add one when the user sets an intention." };
        return { output: `Goals (${list.length} \u2014 shared by every Bot):\n${goalsForPrompt(list)}` };
      }
      if (action === "add") {
        const title = String(a.title ?? "").trim();
        if (!title) return { output: "A goal needs a title." };
        const goal = await addGoal(userId, { title, detail: a.detail ? String(a.detail) : "", botId: bot.id, dueAt: a.due ? String(a.due) : null });
        return { output: `Added goal ${goal.id}: ${goal.title}` };
      }
      const id = String(a.id ?? "");
      if (!id) return { output: `Give the id of the goal to ${action}.` };
      if (action === "update") {
        const goal = await updateGoal(userId, id, {
          title: a.title !== undefined ? String(a.title) : undefined,
          detail: a.detail !== undefined ? String(a.detail) : undefined,
          status: a.status as "open" | "doing" | "done" | undefined,
          dueAt: a.due !== undefined ? String(a.due) : undefined,
        });
        return { output: goal ? `Updated goal: ${goal.title} (${goal.status})` : "No goal with that id." };
      }
      if (action === "complete") {
        const goal = await updateGoal(userId, id, { status: "done" });
        return { output: goal ? `Completed: ${goal.title}` : "No goal with that id." };
      }
      if (action === "remove") {
        return { output: (await deleteGoal(userId, id)) ? "Goal removed." : "No goal with that id." };
      }
      return { output: `Unknown goal action: ${action}` };
    }
    if (name === "make_lyric_video") {
      const { LYRIC_PRESETS } = await import("@/lib/lyric-video");
      const audioId = String(a.audioId ?? "");
      const title = String(a.title ?? "").trim();
      if (!title) return { output: "A lyric video needs a song title." };
      if (!audioId) return { output: "I need the audio artifact id. Ask the user to upload the song in the chat first." };
      // The id must belong to this user and be a real audio upload.
      const { and, eq } = await import("drizzle-orm");
      const { db } = await import("@/db");
      const { artifacts } = await import("@/db/schema");
      const [audio] = await db.select({ id: artifacts.id, kind: artifacts.kind }).from(artifacts).where(and(eq(artifacts.id, audioId), eq(artifacts.userId, userId))).limit(1);
      if (!audio || audio.kind !== "audio") return { output: "That audio id is not one of the user's uploads. Ask them to attach the song again." };
      // Lyrics come from the uploaded file when there is one, so a long file
      // never has to be retyped into the tool call.
      const lyricsId = String(a.lyricsId ?? "");
      let lyrics = String(a.lyrics ?? "");
      if (lyricsId) {
        const { eq: eqOp } = await import("drizzle-orm");
        const { db: mediaDb } = await import("@/db");
        const { artifacts: mediaArtifacts } = await import("@/db/schema");
        const [file] = await mediaDb
          .select({ content: mediaArtifacts.content, kind: mediaArtifacts.kind })
          .from(mediaArtifacts)
          .where(and(eqOp(mediaArtifacts.id, lyricsId), eqOp(mediaArtifacts.userId, userId)))
          .limit(1);
        if (!file || file.kind !== "lyrics") return { output: "That lyrics id is not one of the user's lyric uploads. Ask them to attach the file again." };
        lyrics = file.content;
      }
      if (!lyrics.trim()) return { output: "I need the lyrics. Ask the user to attach their .lrc, .srt or .ttml file." };
      // The lyrics must actually parse into timed lines, or the card would
      // render an empty stage and look broken.
      const { detectParser } = await import("@braccato/parsers");
      let lineCount = 0;
      try {
        lineCount = detectParser(lyrics).parse(lyrics).length;
      } catch {
        lineCount = 0;
      }
      if (!lineCount) return { output: "Those lyrics did not parse into timed lines. Ask the user for an .lrc, .srt, .ttml or .qrc file, or their plain lyrics one line at a time." };
      const presetRaw = String(a.preset ?? "aurora");
      const preset = presetRaw in LYRIC_PRESETS ? (presetRaw as keyof typeof LYRIC_PRESETS) : "aurora";
      const spec = {
        version: 1 as const,
        title,
        artist: a.artist ? String(a.artist) : undefined,
        audioId,
        artId: a.artId ? String(a.artId) : undefined,
        lyrics,
        lyricFormat: a.lyricFormat ? String(a.lyricFormat) : undefined,
        preset,
        accent: a.accent ? String(a.accent) : undefined,
      };
      const [row] = await db.insert(artifacts).values({
        userId,
        botId: bot.id,
        title: `${title}${spec.artist ? ` — ${spec.artist}` : ""} · lyric video`,
        kind: "lyric_video",
        content: JSON.stringify(spec),
      }).returning({ id: artifacts.id });
      return { output: `Lyric video ready (artifact ${row.id}). It is now a card in the chat with a player. Tell the user to press play.`, artifactId: row.id };
    }
    if (name === "save_artifact" || name === "draft_email") {
      const title = String(a.title ?? (name === "draft_email" ? `Email to ${String(a.to ?? "recipient")}` : "Untitled artifact")).trim().slice(0, 160);
      const kind = name === "draft_email" ? "email_draft" : String(a.kind ?? "document");
      const content = name === "draft_email" ? JSON.stringify({ to: String(a.to ?? "").trim(), subject: String(a.subject ?? "").trim(), body: String(a.body ?? "") }) : String(a.content ?? "");
      if (!title || !content || content.length > 100_000) return { output: "The artifact needs a title and content under 100 KB." };
      // Recipients may be bare addresses or “Name <a@x.com>”, separated by commas.
      if (name === "draft_email") {
        const recipients = splitRecipients(String(a.to ?? ""));
        const subjectLine = String(a.subject ?? "");
        if (!recipients.ok.length || recipients.invalid.length) {
          return { output: "That email draft needs at least one valid recipient (name@example.com). Separate several with commas." };
        }
        if (!subjectLine.trim() || /[\r\n]/.test(subjectLine)) {
          return { output: "That email draft needs a subject on a single line." };
        }
        if (!String(a.body ?? "").trim()) return { output: "That email draft needs a body." };
      }
      const [saved] = await db.insert(artifacts).values({ botId: bot.id, userId, title, kind, content }).returning({ id: artifacts.id });
      return {
        artifactId: saved.id,
        output:
          name === "draft_email"
            ? `Email draft saved (id ${saved.id}). It is shown as a card in the chat for the user to review and send — do not say it has been sent.`
            : `Saved to Artifacts (id ${saved.id}).`,
      };
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
    if (name === "find_tools") {
      const query = String(a.query ?? "").trim();
      if (!query) return { output: "Describe what you want to do." };
      const limit = Math.max(1, Math.min(25, Number(a.limit) || 10));
      const hits = searchToolLibrary(query, limit);
      if (!hits.length) {
        return { output: "Nothing in the library matches that. Build it yourself with the tools you have." };
      }
      // A weak hit is reported as weak. Without this the model ran the
      // top-scoring tool regardless of score, which is how "summarize this
      // document" ended up invoking a tool about elevation rules: the word
      // "document" was shared, the job was not. Telling it plainly that the
      // match is thin lets it decide to build the thing instead.
      const weak = hits[0].score <= WEAK_MATCH_SCORE;
      const list = hits.map((hit) => `${hit.name} — ${hit.summary} (call run_tool with this name)`).join("\n");
      return {
        output: weak
          ? `These are only loose matches — the library may not have a tool for exactly "${query}", so check the summary before running one, and build it yourself if none fits:\n${list}`
          : list,
      };
    }
    if (name === "run_tool") {
      const requested = String(a.name ?? "").trim();
      const tool = libraryToolByName(requested);
      // Only tools in the library may be run through this door — otherwise the
      // meta-tool would be an escape hatch around permissions.
      if (!tool) {
        return { output: `There is no library tool called "${requested}". Use find_tools to get an exact name.` };
      }
      const title = String(a.title ?? tool.summary).trim();
      const detail = String(a.detail ?? "").trim();
      return runLibraryTool(tool, { title, detail }, {
        userId,
        botId: bot.id,
        turnId: opts.turnId,
        signal: opts.signal,
        writeFile: e2bKey
          ? async (path, content) => {
              const sb = await getDesktop();
              await sb.files.write(safePath(path), content);
            }
          : undefined,
      });
    }
    // This runs before the handlers below, so a library stub called `look_up`
    // would swallow the real one. The filter above already keeps such names out
    // of the schema; this guards the ordering as well.
    const isRealTool = [ASK, ...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, CHECK_TOOL, ...WEB_TOOLS].some((t) => t.name === name);
    if (!isRealTool && opts.libraryQuery && matchedLibraryTools.some((tool) => tool.name === name)) {
      const tool = libraryToolByName(name);
      if (tool) {
        return runLibraryTool(tool, { title: String(a.title ?? tool.summary), detail: String(a.detail ?? "") }, {
          userId,
          botId: bot.id,
          turnId: opts.turnId,
          signal: opts.signal,
          writeFile: e2bKey
            ? async (path, content) => {
                const sb = await getDesktop();
                await sb.files.write(safePath(path), content);
              }
            : undefined,
        });
      }
    }

    // Capability-pack tools are executed here so they can borrow the desktop
    // and the helper registry without the chat route having to know about them.
    if (opts.packTools?.some((tool) => tool.name === name)) {
      return runPackTool(name, a, {
        userId,
        botId: bot.id,
        turnId: opts.turnId,
        signal: opts.signal,
        writeFile: e2bKey
          ? async (path, content) => {
              const sb = await getDesktop();
              await sb.files.write(safePath(path), content);
            }
          : undefined,
        readFile: e2bKey
          ? async (path) => {
              const sb = await getDesktop();
              return sb.files.read(safePath(path)).catch(() => null);
            }
          : undefined,
        readFileBase64: e2bKey
          ? async (path) => {
              const sb = await getDesktop();
              const bytes = await sb.files.read(safePath(path), { format: "bytes" }).catch(() => null);
              return bytes ? Buffer.from(bytes).toString("base64") : null;
            }
          : undefined,
        runCommand: e2bKey
          ? async (command, timeoutMs) => {
              const sb = await getDesktop();
              const r = await sb.commands.run(command, { cwd: HOME_DIR, timeoutMs: timeoutMs ?? 120_000 }).catch((e: { exitCode?: number; stdout?: string; stderr?: string; message?: string }) => ({
                exitCode: e.exitCode ?? 1,
                stdout: e.stdout ?? "",
                stderr: e.stderr ?? e.message ?? "",
              }));
              return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
            }
          : undefined,
        spawn: (input) => {
          const helper = spawnHelper({
            turnId: opts.turnId,
            userId,
            botId: bot.id,
            botName: opts.botName ?? "the main Bot",
            name: input.name,
            task: input.task,
            context: input.context,
            artifactKind: input.artifactKind,
            tools,
            runTool: run,
            signal: opts.signal,
          });
          opts.onHelper?.(helper);
          return helper.id;
        },
        imageConfig: opts.imageConfig,
        helperStatus: async (seconds) => {
          await waitForHelpers(opts.turnId, seconds, opts.signal);
          return helpersFor(opts.turnId).map((helper) => helperSummary(helper));
        },
      });
    }

    // The workspace needs no computer, so it is handled before the desktop is
    // ever requested. These two cases used to fall through to `getDesktop()`,
    // which throws "No E2B key configured" on exactly the accounts that need
    // them most.
    if (name === "calculate") {
      const expression = String(a.expression ?? "").trim();
      try {
        const value = evaluate(expression);
        // Both forms: `0.30000000000000004` is technically right and useless in
        // a sentence, so a rounded value is offered alongside the exact one.
        const rounded = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
        return { output: `${expression} = ${rounded}${rounded !== String(value) ? ` (exactly ${value})` : ""}` };
      } catch (e) {
        return { output: `${e instanceof Error ? e.message : "Could not evaluate that."} Write it as plain arithmetic, e.g. (1250 * 0.08) / 3.` };
      }
    }
    if (name === "check_code") {
      return { output: checkCode(String(a.kind ?? "").toLowerCase(), String(a.text ?? "")) };
    }
    if (name === "look_up") {
      const query = String(a.query ?? "").trim();
      if (!query) return { output: "Give look_up something to search for." };
      // Thrown rather than returned so the step is marked failed and the model
      // gets an `Error:` line it will treat as a wall to route around.
      return { output: clip(await searchWeb(query, opts.signal), 12000) };
    }
    if (name === "read_link") {
      const raw = String(a.url ?? "").trim();
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error("That is not a web address. It should look like https://example.com/page");
      const text = await httpText(url, opts.signal);
      return { output: text.trim() ? clip(text, 12000) : "(The page had no readable text — it may be built entirely by scripts.)" };
    }
    if (name === "workspace_write") {
      const path = String(a.path ?? "").trim().slice(0, 200);
      const content = String(a.content ?? "");
      if (!path) return { output: "Give the file a path, e.g. notes.md" };
      if (!content) return { output: "Nothing to write: content was empty." };
      const title = `workspace:${path}`;
      // One row per path, so a path reads back as its latest version rather
      // than as a pile of drafts nobody can choose between.
      const [existing] = await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(and(eq(artifacts.userId, userId), eq(artifacts.botId, bot.id), eq(artifacts.title, title)))
        .limit(1);
      if (existing) {
        await db.update(artifacts).set({ content, kind: "file" }).where(eq(artifacts.id, existing.id));
      } else {
        await db.insert(artifacts).values({ userId, botId: bot.id, title, kind: "file", content });
      }
      return { output: `Saved ${path} (${content.length} characters) to the workspace.` };
    }
    if (name === "workspace_read") {
      const path = String(a.path ?? "").trim();
      const mine = and(eq(artifacts.userId, userId), eq(artifacts.botId, bot.id), eq(artifacts.kind, "file"));
      if (!path) {
        const rows = await db
          .select({ title: artifacts.title, content: artifacts.content })
          .from(artifacts)
          .where(mine)
          .orderBy(desc(artifacts.createdAt))
          .limit(50);
        if (!rows.length) return { output: "The workspace is empty. Save something with workspace_write." };
        return {
          output: `Workspace files:\n${rows.map((r) => `- ${r.title.replace(/^workspace:/, "")} (${r.content.length} chars)`).join("\n")}`,
        };
      }
      const [row] = await db
        .select({ content: artifacts.content })
        .from(artifacts)
        .where(and(mine, eq(artifacts.title, `workspace:${path.slice(0, 200)}`)))
        .limit(1);
      if (!row) return { output: `No file at ${path} in the workspace. Call workspace_read with no path to list what is there.` };
      // A long file used to arrive as its first 20,000 characters and stop. For
      // a model that cannot run anything, that is a document it can never
      // finish: it summarises a third of the file and never learns the rest
      // exists. The slices are numbered so it can ask for the next one.
      const total = Math.max(1, Math.ceil(row.content.length / PART_CHARS));
      if (total === 1) return { output: row.content };
      const start = Math.min(Math.max(0, Math.floor(Number(a.offset ?? 0)) || 0), row.content.length - 1);
      const which = Math.floor(start / PART_CHARS) + 1;
      const slice = row.content.slice(start, start + PART_CHARS);
      const next = start + PART_CHARS;
      return {
        output:
          `Part ${which} of ${total} of ${path} (${row.content.length} characters in total):\n\n${slice}` +
          (next < row.content.length
            ? `\n\n[End of part ${which}. Read the next with workspace_read path "${path}" offset ${next}.]`
            : ""),
      };
    }

    // Anything that reaches here should be a known tool. Falling through to the
    // desktop for an unknown name produced "No E2B key configured", which told
    // the user nothing about the actual mistake.
    const known = new Set([...allTools.map((tool) => tool.name), "run_command", "web_search", "fetch_page", "open_url", "write_file", "read_file", "click", "type_text", "press_key"]);
    if (!known.has(name)) {
      return { output: `The tool "${name}" is not available on this turn. Use the tools you were given, or say what you cannot do.` };
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
      case "build_toolchain": {
        const kind = String(a.kind ?? "all");
        const wantAndroid = kind === "android" || kind === "all";
        const wantWindows = kind === "windows-exe" || kind === "all";
        const out: string[] = [];
        // Both installs share one apt pass: two `apt-get update`s cost a minute
        // each on a cold desktop image.
        if (wantWindows) {
          out.push(
            "== windows-exe ==",
            await sh(
              sb,
              "export DEBIAN_FRONTEND=noninteractive; " +
                "sudo apt-get update -qq >/dev/null 2>&1; " +
                // mingw-w64 gives a real PE cross-compiler; g++ too, so C++ and
                // the Rust `x86_64-pc-windows-gnu` target both have a linker.
                "sudo apt-get install -y -qq mingw-w64 >/dev/null 2>&1 || echo 'apt install failed'; " +
                "which x86_64-w64-mingw32-gcc x86_64-w64-mingw32-g++ 2>/dev/null; " +
                "x86_64-w64-mingw32-gcc --version 2>/dev/null | head -1",
              600_000,
            ),
          );
        }
        if (wantAndroid) {
          // The SDK is not in apt, and `sdkmanager` insists on a licence prompt,
          // so this installs the command-line tools, accepts every licence, then
          // resolves one platform and one build-tools release to prove it works.
          out.push(
            "== android ==",
            await sh(
              sb,
              [
                "export DEBIAN_FRONTEND=noninteractive",
                "sudo apt-get install -y -qq openjdk-17-jdk unzip >/dev/null 2>&1 || echo 'jdk apt failed'",
                "export ANDROID_HOME=/home/user/android-sdk",
                "mkdir -p $ANDROID_HOME/cmdline-tools",
                "if [ ! -d $ANDROID_HOME/cmdline-tools/latest ]; then",
                "  cd /tmp && curl -sSL -o cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip || echo 'download failed'",
                "  unzip -q -o cmdtools.zip -d /tmp/cmdtools && mv /tmp/cmdtools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest 2>/dev/null",
                "fi",
                "export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$PATH",
                "yes | sdkmanager --licenses >/dev/null 2>&1 || true",
                "sdkmanager 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0' >/dev/null 2>&1 || echo 'sdkmanager failed'",
                "echo \"ANDROID_HOME=$ANDROID_HOME\"",
                "ls $ANDROID_HOME/platforms 2>/dev/null | head -3",
                "ls $ANDROID_HOME/build-tools 2>/dev/null | head -3",
              ].join("; "),
              900_000,
            ),
          );
          out.push(
            "Put these in the environment of every Android build:",
            "ANDROID_HOME=/home/user/android-sdk",
            "PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH",
          );
        }
        out.push(
          "",
          "A .exe must be a native Windows binary. Electron is a browser wrapped inside one — " +
            "not the same thing, and it will not run on a machine without Chromium. The two ways " +
            "that produce a real one here:",
          "  C/C++:  x86_64-w64-mingw32-gcc -O2 -o app.exe main.c -static",
          "  Rust:   cargo build --release --target x86_64-pc-windows-gnu",
          "Then prove it — do not assume:",
          "  x86_64-w64-mingw32-objdump -f app.exe | grep -E 'architecture|file format'",
          "Expect `pei-x86-64` and `pei-x86-64`. `file app.exe` also says 'PE32+ executable " +
            "(console) x86-64, for MS Windows' where binutils' `file` is installed.",
          wantAndroid
            ? "Android: set ANDROID_HOME and PATH as printed above, then build with Gradle " +
              "(`./gradlew assembleDebug`) or compile a plain .apk with aapt2 + d8 + zipalign + apksigner " +
              "from build-tools. `sdkmanager --list_installed` shows what actually landed."
            : "",
        );
        return { output: out.join("\n") };
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

  // A small model's most common way to waste a turn is to retry the exact call
  // that just failed — same tool, same arguments — until the step cap ends the
  // job. The second identical attempt is honest (a flaky request can succeed on
  // a retry), so it runs; the fourth is a loop, and the useful thing to return
  // is a sentence that names the problem instead of the same error again.
  let lastKey = "";
  let repeats = 0;

  async function run(name: string, args: Record<string, unknown>, id: string): Promise<ToolResult> {
    const label = labelFor(name, args);
    const startedAt = Date.now();
    ev.onStepStart({ id, name, label });
    if (opts.signal.aborted) throw new Error("aborted");
    const key = `${name}:${JSON.stringify(args)}`;
    repeats = key === lastKey ? repeats + 1 : 0;
    lastKey = key;
    if (repeats >= 3) {
      const looped = `You have now asked for ${name} with these exact arguments ${repeats + 1} times and the result has not changed. Do not call it again. Either change the arguments, use a different tool, or tell the user plainly what is blocking you and what you need from them.`;
      ev.onStepEnd({ id, name, label, ok: false, ms: Date.now() - startedAt, output: clip(looped, 400) });
      return { output: looped };
    }
    try {
      if (toolAllowlist && name !== "ask_user" && !toolAllowlist.has(name)) throw new Error("This tool is not allowed by the Bot's enabled skills.");
      const connector = TOOL_CONNECTOR[name];
      if (connector && connectorAllowlist && !connectorAllowlist.has(connector)) throw new Error("This connected account is not allowed by the Bot's enabled skills.");
      const [privacySession] = await db.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, userId), eq(privacySessions.status, "active"))).limit(1);
      if (privacySession) throw new Error("Privacy Mode is active. Bot tools are paused until you press I'm Done.");
      const r = await exec(name, args);
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      ev.onStepEnd({ id, name, label, ok: true, ms: Date.now() - startedAt, output: clip(r.output, 1500), ...(r.artifactId ? { artifactId: r.artifactId } : {}) });
      if (desktop && opts.wantShots && SCREEN_TOOLS.has(name) && !opts.signal.aborted) {
        const b = await captureShot(desktop);
        if (b && !opts.signal.aborted) ev.onShot(b);
      }
      return r;
    } catch (e) {
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      const msg = e instanceof Error ? e.message : "Tool failed";
      ev.onStepEnd({ id, name, label, ok: false, ms: Date.now() - startedAt, output: clip(msg, 800) });
      // "Error: …" is a line of text a small model can read past, and then write
      // "Done — the file is saved" over the top of it. The rest of the sentence
      // is the part that matters: it says the thing did NOT happen and that
      // claiming otherwise would be a lie, which is what the model needs in
      // order to report the failure instead of inventing a result.
      return {
        output:
          `Error: ${msg}\n\n` +
          `That did not happen. Do not tell the user ${name} succeeded, and do not present a made-up result. ` +
          `Either try a different approach or say plainly that it failed and what you need to fix it.`,
      };
    }
  }

  return { tools, run };
}
