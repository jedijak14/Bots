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
  key?: string | string[];
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  amount?: number;
  direction?: "up" | "down";
};

const KEY_NAME = /^[A-Za-z0-9_]{1,20}$/;

function keysFrom(input: Body["key"]): string | string[] {
  const parts = (Array.isArray(input) ? input : [input ?? "enter"]).map((key) => String(key));
  if (!parts.length || parts.length > 5 || !parts.every((key) => KEY_NAME.test(key))) throw new HttpError(400, "Unknown key.");
  return parts.length === 1 ? parts[0] : parts;
}

function coord(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) throw new HttpError(400, "Invalid position.");
  return Math.max(0, Math.min(8192, n));
}

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
    const supportedActions = new Set(["start", "screenshot", "navigate", "restart", "type", "key", "click", "doubleClick", "rightClick", "drag", "scroll"]);
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
        await sb.press(keysFrom(body.key));
        await sleep(250);
        break;
      case "click":
        await sb.leftClick(coord(body.x), coord(body.y));
        await sleep(250);
        break;
      case "doubleClick":
        await sb.doubleClick(coord(body.x), coord(body.y));
        await sleep(250);
        break;
      case "rightClick":
        await sb.rightClick(coord(body.x), coord(body.y));
        await sleep(250);
        break;
      case "drag":
        await sb.drag([coord(body.x), coord(body.y)], [coord(body.toX), coord(body.toY)]);
        await sleep(250);
        break;
      case "scroll": {
        if (body.x !== undefined && body.y !== undefined) await sb.moveMouse(coord(body.x), coord(body.y));
        const amount = Math.max(1, Math.min(15, Math.round(Number(body.amount) || 3)));
        await sb.scroll(body.direction === "up" ? "up" : "down", amount);
        await sleep(200);
        break;
      }
      default:
        throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ active: true, image: await shot(sb) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError) return handleError(error);
    return Response.json({ error: "The private computer is unavailable. Restart it and try again." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
