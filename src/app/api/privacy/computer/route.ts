import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { privacySessions } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { connectPrivateDesktop, ensurePrivateDesktop, openInBrowser, restartBrowser, shot, sleep } from "@/lib/sandbox";
import { e2bKeyFrom, getSettings } from "@/lib/settings";

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

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const [session] = await db.select({ id: privacySessions.id, userId: privacySessions.userId, sandboxId: privacySessions.sandboxId }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).orderBy(desc(privacySessions.createdAt)).limit(1);
    if (!session) throw new HttpError(409, "Start Privacy Mode before opening its computer.");
    const key = e2bKeyFrom(await getSettings(user.id));
    if (!key) return Response.json({ error: "Add your E2B API key in Settings to use the private computer.", code: "no_e2b" }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as Body;
    const sessionRef = { ...session };
    const action = body.action ?? "screenshot";
    const supportedActions = new Set(["start", "screenshot", "navigate", "restart", "type", "key", "click", "scroll"]);
    if (!supportedActions.has(action)) throw new HttpError(400, "Unknown action.");

    if (action === "screenshot") {
      const sb = await connectPrivateDesktop(sessionRef, key);
      if (!sb) return Response.json({ active: false, image: null }, { headers: { "Cache-Control": "no-store" } });
      return Response.json({ active: true, image: await shot(sb) }, { headers: { "Cache-Control": "no-store" } });
    }

    const { sb, fresh } = await ensurePrivateDesktop(sessionRef, key);
    switch (action) {
      case "start":
        if (fresh) await sleep(1200);
        break;
      case "navigate":
        await openInBrowser(sb, String(body.url ?? ""));
        await sleep(fresh ? 3000 : 1200);
        break;
      case "restart":
        await restartBrowser(sb);
        await openInBrowser(sb, "about:blank");
        await sleep(800);
        break;
      case "type":
        await sb.write(String(body.text ?? "").slice(0, 2000));
        if (body.enter) await sb.press("enter");
        await sleep(300);
        break;
      case "key":
        await sb.press(String(body.key ?? "enter").slice(0, 32));
        await sleep(250);
        break;
      case "click": {
        const x = Number(body.x);
        const y = Number(body.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1024 || y < 0 || y > 768) throw new HttpError(400, "Invalid screen coordinates.");
        await sb.leftClick(Math.round(x), Math.round(y));
        await sleep(250);
        break;
      }
      case "scroll":
        await sb.scroll(body.direction === "up" ? "up" : "down", 3);
        await sleep(200);
        break;
      default:
        throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ active: true, image: await shot(sb) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError) return handleError(error);
    return Response.json({ error: "The private computer is unavailable. Restart it and try again." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
