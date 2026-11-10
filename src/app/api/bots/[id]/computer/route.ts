import { handleError, HttpError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { e2bKeyFrom, getSettings } from "@/lib/settings";
import { connectDesktop, ensureDesktop, openInBrowser, restartBrowser, shot, sleep } from "@/lib/sandbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  action?: string;
  url?: string;
  text?: string;
  enter?: boolean;
  /** One key ("enter") or a chord (["ctrl", "a"]). */
  key?: string | string[];
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  direction?: "up" | "down";
  amount?: number;
};

/**
 * The desktop SDK passes key names to a shell command unquoted, so only plain
 * key names are ever let through: letters, digits and underscores.
 */
const KEY_NAME = /^[A-Za-z0-9_]{1,20}$/;

function keysFrom(input: Body["key"]): string | string[] {
  const parts = (Array.isArray(input) ? input : [input ?? "enter"]).map((k) => String(k));
  if (!parts.length || parts.length > 5 || !parts.every((k) => KEY_NAME.test(k))) throw new HttpError(400, "Unknown key.");
  return parts.length === 1 ? parts[0] : parts;
}

/** A screen coordinate, kept inside any sensible desktop. */
function coord(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new HttpError(400, "Invalid position.");
  return Math.max(0, Math.min(8192, n));
}

/**
 * POST /api/bots/:id/computer
 * Every action answers with `{ active, image }`: whether the computer is on and
 * a fresh screenshot. `screenshot` never starts a computer; everything else does.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    const key = e2bKeyFrom(await getSettings(user.id));
    if (!key) return Response.json({ error: "Add your E2B API key in Settings to use the computer.", code: "no_e2b" }, { status: 400 });
    const b = (await req.json().catch(() => ({}))) as Body;
    const ref = { id: bot.id, sandboxId: bot.sandboxId };

    try {
      if (b.action === "screenshot" || !b.action) {
        const sb = await connectDesktop(ref, key);
        if (!sb) return Response.json({ active: false, image: null });
        return Response.json({ active: true, image: await shot(sb) });
      }
      const { sb, fresh } = await ensureDesktop(ref, key);
      switch (b.action) {
        case "start":
          if (fresh) await sleep(100);
          break;
        case "navigate":
          await openInBrowser(sb, String(b.url ?? ""));
          await sleep(fresh ? 1200 : 500);
          break;
        case "restart":
          await restartBrowser(sb);
          await openInBrowser(sb, "about:blank");
          await sleep(100);
          break;
        case "type":
          await sb.write(String(b.text ?? "").slice(0, 2000));
          if (b.enter) await sb.press("enter");
          await sleep(100);
          break;
        case "key":
          await sb.press(keysFrom(b.key));
          await sleep(100);
          break;
        case "click":
          await sb.leftClick(coord(b.x), coord(b.y));
          await sleep(100);
          break;
        case "doubleClick":
          await sb.doubleClick(coord(b.x), coord(b.y));
          await sleep(100);
          break;
        case "rightClick":
          await sb.rightClick(coord(b.x), coord(b.y));
          await sleep(100);
          break;
        case "drag":
          await sb.drag([coord(b.x), coord(b.y)], [coord(b.toX), coord(b.toY)]);
          await sleep(100);
          break;
        case "scroll": {
          // Scrolling happens under the pointer, so move it to where the person is pointing first.
          if (b.x !== undefined && b.y !== undefined) await sb.moveMouse(coord(b.x), coord(b.y));
          const amount = Math.max(1, Math.min(15, Math.round(Number(b.amount) || 3)));
          await sb.scroll(b.direction === "up" ? "up" : "down", amount);
          await sleep(100);
          break;
        }
        default:
          throw new HttpError(400, "Unknown action.");
      }
      return Response.json({ active: true, image: await shot(sb) });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const msg = e instanceof Error ? e.message : "The computer isn't responding.";
      return Response.json({ error: msg.slice(0, 300) }, { status: 502 });
    }
  } catch (e) {
    return handleError(e);
  }
}
