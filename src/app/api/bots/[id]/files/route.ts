import { handleError, HttpError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { buildPreviewHtml, mimeOf } from "@/lib/preview-html";
import { e2bKeyFrom, getSettings } from "@/lib/settings";
import { connectDesktop } from "@/lib/sandbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HOME = "/home/user";
const MAX_TEXT = 300_000;
const MAX_IMAGE = 6 * 1024 * 1024;
const MAX_HTML = 3 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Text unless the first block contains a NUL byte or is not valid UTF-8. */
function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    // `stream` tolerates a multi-byte character cut off at the end of the block.
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/bots/:id/files
 *   ?path=/dir                 list a folder
 *   ?path=/file&download=1     download a file
 *   ?path=/file&read=1         file contents for the in-app viewer (text or image)
 *   ?path=/page.html&preview=1 a self-contained copy of a web page for the sandboxed preview frame
 *   ?find=html                 web pages in the workspace, newest first
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    const key = e2bKeyFrom(await getSettings(user.id));
    if (!key) return json({ error: "Add your E2B API key in Settings.", code: "no_e2b" }, 400);
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || HOME;
    if (!path.startsWith("/") || path.includes("..") || path.includes("\0")) throw new HttpError(400, "Invalid path.");
    const sb = await connectDesktop({ id: bot.id, sandboxId: bot.sandboxId }, key);
    if (!sb) return json({ active: false, path, entries: [] });
    const name = path.split("/").pop() || "file";

    if (url.searchParams.get("find") === "html") {
      // Newest first, skipping dependency folders and dotfiles. Tab-separated: mtime, size, path.
      const cmd = `find ${HOME} -maxdepth 6 \\( -name node_modules -o -name '.*' -o -name venv -o -name __pycache__ -o -name dist-packages -o -name site-packages \\) -prune -o -type f \\( -iname '*.html' -o -iname '*.htm' \\) -printf '%T@\\t%s\\t%p\\n' 2>/dev/null | sort -rn | head -n 40`;
      const out = await sb.commands.run(cmd, { timeoutMs: 15_000 });
      const entries = out.stdout
        .split("\n")
        .map((line) => line.split("\t"))
        .filter((p) => p.length >= 3 && p[2].startsWith("/"))
        .map((p) => {
          const full = p.slice(2).join("\t");
          return { name: full.split("/").pop() || full, path: full, type: "file" as const, size: Number(p[1]) || 0 };
        });
      return json({ active: true, path: HOME, entries });
    }

    if (url.searchParams.get("download")) {
      const bytes = await sb.files.read(path, { format: "bytes" });
      return new Response(Buffer.from(bytes), {
        headers: {
          // Always a download, never rendered on this origin.
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.searchParams.get("preview")) {
      if (!/\.html?$/i.test(name)) throw new HttpError(400, "Only web pages can be previewed.");
      const info = await sb.files.getInfo(path);
      if (info.size > MAX_HTML) throw new HttpError(400, "This page is too large to preview.");
      const html = await sb.files.read(path, { format: "text" });
      const built = await buildPreviewHtml({
        path,
        html,
        read: async (p) => {
          try {
            return await sb.files.read(p, { format: "bytes" });
          } catch {
            return null;
          }
        },
      });
      return json({ active: true, path, name, html: built });
    }

    if (url.searchParams.get("read")) {
      const info = await sb.files.getInfo(path);
      const base = { active: true, path, name, size: info.size };
      const isImage = IMAGE_EXT.test(name);
      if (info.size > (isImage ? MAX_IMAGE : 20 * 1024 * 1024)) return json({ ...base, kind: "binary" });
      const bytes = await sb.files.read(path, { format: "bytes" });
      if (isImage) return json({ ...base, kind: "image", dataUrl: `data:${mimeOf(name)};base64,${Buffer.from(bytes).toString("base64")}` });
      if (!looksLikeText(bytes)) return json({ ...base, kind: "binary" });
      const text = new TextDecoder().decode(bytes.subarray(0, MAX_TEXT));
      return json({ ...base, kind: "text", text, truncated: bytes.byteLength > MAX_TEXT });
    }

    const list = await sb.files.list(path);
    const entries = list
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: e.path, type: e.type === "dir" ? "dir" : "file", size: e.size }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return json({ active: true, path, entries });
  } catch (e) {
    if (e instanceof HttpError) return handleError(e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "Couldn't read files." }, 502);
  }
}
