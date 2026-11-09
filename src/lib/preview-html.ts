/**
 * Turns an HTML file from a bot's workspace into one self-contained document
 * that can be shown in a sandboxed `<iframe srcdoc>`.
 *
 * A page the bot built normally points at sibling files ("style.css",
 * "app.js", "logo.png"). Inside a srcdoc frame those relative URLs have nothing
 * to resolve against, so every local stylesheet, script, image and font is
 * read from the workspace and inlined as a `data:` URL. Remote URLs are left
 * alone. A tiny script is added so links between local pages ask the host to
 * open that page instead of navigating the frame into nowhere.
 *
 * The result is untrusted content: only ever render it in a frame that is
 * sandboxed WITHOUT `allow-same-origin`.
 *
 * This module is pure (it only talks to the `read` callback) so it can be
 * tested without a computer.
 */

export type ReadFile = (path: string) => Promise<Uint8Array | null>;

const MAX_ASSETS = 60;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

const MIME: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

const extOf = (p: string) => (p.split("/").pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
export const mimeOf = (p: string) => MIME[extOf(p)] ?? "application/octet-stream";
export const dirOf = (p: string) => p.replace(/\/[^/]*$/, "") || "/";

/** True for URLs that point into the workspace (no scheme, not protocol-relative, not a fragment). */
function isLocal(url: string): boolean {
  const u = url.trim();
  if (!u || u.startsWith("#") || u.startsWith("//")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(u);
}

/** Resolves a URL from a page against that page's folder. Returns null if it can't be a workspace path. */
export function resolveLocal(baseDir: string, url: string): string | null {
  let rel = url.trim().split("#")[0].split("?")[0];
  if (!rel) return null;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep the raw value */
  }
  if (rel.includes("\0")) return null;
  // "/style.css" means the root of the site, which for a workspace folder is the page's own folder.
  const joined = `${baseDir}/${rel.replace(/^\/+/, "")}`;
  const out: string[] = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

type Budget = { assets: number; bytes: number; cache: Map<string, Promise<string | null>> };

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi;

async function replaceAsync(input: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string | null>): Promise<string> {
  const matches: RegExpExecArray[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (let m = g.exec(input); m; m = g.exec(input)) {
    matches.push(m);
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  if (!matches.length) return input;
  const out = await Promise.all(matches.map(fn));
  let res = "";
  let at = 0;
  matches.forEach((m, i) => {
    res += input.slice(at, m.index) + (out[i] ?? m[0]);
    at = m.index + m[0].length;
  });
  return res + input.slice(at);
}

async function inlineCssUrls(css: string, baseDir: string, read: ReadFile, budget: Budget, depth: number): Promise<string> {
  return replaceAsync(css, CSS_URL, async (m) => {
    const url = m[1] ?? m[2] ?? m[3] ?? "";
    if (!isLocal(url)) return null;
    const data = await dataUrl(resolveLocal(baseDir, url), read, budget, depth);
    return data ? `url("${data}")` : null;
  });
}

/** Reads a workspace file and returns it as a data: URL, or null if it is missing or over budget. */
function dataUrl(path: string | null, read: ReadFile, budget: Budget, depth = 0): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  const cached = budget.cache.get(path);
  if (cached) return cached;
  if (budget.assets >= MAX_ASSETS) return Promise.resolve(null);
  budget.assets++;
  const job = (async () => {
    let bytes: Uint8Array | null;
    try {
      bytes = await read(path);
    } catch {
      return null;
    }
    if (!bytes || bytes.byteLength > MAX_ASSET_BYTES || budget.bytes + bytes.byteLength > MAX_TOTAL_BYTES) return null;
    budget.bytes += bytes.byteLength;
    const mime = mimeOf(path);
    if (mime === "text/css" && depth < 3) {
      // Stylesheets carry their own relative URLs (fonts, background images).
      const css = await inlineCssUrls(new TextDecoder().decode(bytes), dirOf(path), read, budget, depth + 1);
      return `data:text/css;charset=utf-8;base64,${Buffer.from(css, "utf8").toString("base64")}`;
    }
    const text = /^(text\/|application\/json|image\/svg)/.test(mime) ? ";charset=utf-8" : "";
    return `data:${mime}${text};base64,${toBase64(bytes)}`;
  })();
  budget.cache.set(path, job);
  return job;
}

const TAG = /<(link|script|img|source|video|audio|input)\b[^>]*>/gi;
const URL_ATTR = /(\s)(src|href|poster)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;

/** Script added to every preview: keeps links working inside a frame that has no URL of its own. */
function bridgeScript(dir: string): string {
  const json = JSON.stringify(dir).replace(/</g, "\\u003c");
  return `<script data-bot-preview>(function(){var dir=${json};function resolve(h){var parts=(dir+"/"+h.replace(/^\\/+/,"")).split("/"),out=[];for(var i=0;i<parts.length;i++){var p=parts[i];if(!p||p===".")continue;if(p==="..")out.pop();else out.push(p);}return "/"+out.join("/");}document.addEventListener("click",function(e){if(e.defaultPrevented||e.button!==0)return;var t=e.target;var a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(!h||h.charAt(0)==="#")return;if(/^[a-z][a-z0-9+.-]*:/i.test(h)||h.indexOf("//")===0){a.target="_blank";a.rel="noopener noreferrer";return;}e.preventDefault();var clean=h.split("#")[0].split("?")[0];try{clean=decodeURIComponent(clean);}catch(_){}if(!clean)return;parent.postMessage({source:"bot-preview",type:"navigate",path:resolve(clean)},"*");},true);})();</script>`;
}

function inject(html: string, snippet: string): string {
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + snippet + html.slice(m.index + m[0].length);
  }
  return snippet + html;
}

export async function buildPreviewHtml(opts: { path: string; html: string; read: ReadFile }): Promise<string> {
  const dir = dirOf(opts.path);
  const budget: Budget = { assets: 0, bytes: 0, cache: new Map() };

  // 1. url(...) inside <style> blocks
  let html = await replaceAsync(opts.html, STYLE_BLOCK, async (m) => `${m[1]}${await inlineCssUrls(m[2], dir, opts.read, budget, 1)}${m[3]}`);

  // 2. src / href / poster on tags that load a file
  html = await replaceAsync(html, TAG, async (m) => {
    const tag = m[0];
    const name = m[1].toLowerCase();
    if (name === "link" && !/\brel\s*=\s*["']?[^"'>]*\b(stylesheet|icon|preload|modulepreload)\b/i.test(tag)) return null;
    if (name === "input" && !/\btype\s*=\s*["']?image\b/i.test(tag)) return null;
    return replaceAsync(tag, URL_ATTR, async (a) => {
      const attr = a[2].toLowerCase();
      if ((name === "link" && attr !== "href") || (name !== "link" && attr === "href")) return null;
      const url = a[4] ?? a[5] ?? a[6] ?? "";
      if (!isLocal(url)) return null;
      const data = await dataUrl(resolveLocal(dir, url), opts.read, budget);
      // Keep the author's quote style: the tag may itself sit inside a quoted script string.
      const q = a[5] !== undefined ? "'" : '"';
      return data ? `${a[1]}${a[2]}${a[3]}${q}${data}${q}` : null;
    });
  });

  return inject(html, bridgeScript(dir));
}
