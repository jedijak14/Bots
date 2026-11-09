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
  key?: string;
  x?: number;
  y?: number;
  direction?: "up" | "down";
};

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
          if (fresh) await sleep(1200);
          break;
        case "navigate":
          await openInBrowser(sb, String(b.url ?? ""));
          await sleep(fresh ? 4000 : 2500);
          break;
        case "restart":
          await restartBrowser(sb);
          await openInBrowser(sb, "about:blank");
          await sleep(2500);
          break;
        case "type":
          await sb.write(String(b.text ?? "").slice(0, 2000));
          if (b.enter) await sb.press("enter");
          await sleep(500);
          break;
        case "key":
          await sb.press(String(b.key ?? "enter"));
          await sleep(400);
          break;
        case "click":
          await sb.leftClick(Math.round(Number(b.x)), Math.round(Number(b.y)));
          await sleep(500);
          break;
        case "scroll":
          await sb.scroll(b.direction === "up" ? "up" : "down", 3);
          await sleep(300);
          break;
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
