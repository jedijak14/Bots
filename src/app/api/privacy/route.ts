import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { privacyAuditEvents, privacySessions, users } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { destroyPrivateDesktop } from "@/lib/sandbox";
import { e2bKeyFrom, getSettings } from "@/lib/settings";

export async function GET() {
  try {
    const user = await requireUser();
    const [session] = await db.select({ id: privacySessions.id, botId: privacySessions.botId, createdAt: privacySessions.createdAt }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).orderBy(desc(privacySessions.createdAt)).limit(1);
    return Response.json(session ? { status: "active", session } : { status: "idle" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { action?: string; botId?: string };
    if (body.action !== "take_control" && body.action !== "done") return Response.json({ error: "Unknown privacy action." }, { status: 400 });
    if (body.action === "take_control" && !body.botId) return Response.json({ error: "Open a Bot before taking control." }, { status: 400 });
    if (body.botId && !(await getBot(user.id, body.botId))) return Response.json({ error: "Bot not found." }, { status: 404 });
    if (body.action === "take_control") {
      const session = await db.transaction(async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
        const [current] = await tx.select().from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).orderBy(desc(privacySessions.createdAt)).limit(1);
        if (current) return current;
        const [created] = await tx.insert(privacySessions).values({ userId: user.id, botId: body.botId!, sandboxId: null, status: "active" }).returning({ id: privacySessions.id, userId: privacySessions.userId, botId: privacySessions.botId, createdAt: privacySessions.createdAt });
        await tx.insert(privacyAuditEvents).values({ userId: user.id, botId: created.botId, action: "take_control" });
        return created;
      });
      return Response.json({ status: "active", session: { botId: session.botId } }, { headers: { "Cache-Control": "no-store" } });
    }
    const session = await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
      const [current] = await tx.select().from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).orderBy(desc(privacySessions.createdAt)).limit(1);
      if (!current) return null;
      const [ended] = await tx.update(privacySessions).set({ status: "ended", endedAt: new Date(), sandboxId: null }).where(eq(privacySessions.id, current.id)).returning({ id: privacySessions.id, userId: privacySessions.userId, botId: privacySessions.botId, sandboxId: privacySessions.sandboxId });
      if (ended) await tx.insert(privacyAuditEvents).values({ userId: user.id, botId: ended.botId, action: "done" });
      return ended;
    });
    if (session?.sandboxId) {
      try {
        const key = e2bKeyFrom(await getSettings(user.id));
        if (key) await destroyPrivateDesktop(session.sandboxId, key);
      } catch {}
    }
    return Response.json(session ? { status: "ended", botId: session.botId } : { status: "idle" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}
