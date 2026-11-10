import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailDrafts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const botId = new URL(req.url).searchParams.get("botId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(botId)) return Response.json({ drafts: [] });
    const drafts = await db.select().from(emailDrafts).where(and(eq(emailDrafts.userId, user.id), eq(emailDrafts.botId, botId), eq(emailDrafts.status, "pending"))).orderBy(desc(emailDrafts.createdAt)).limit(20);
    return Response.json({ drafts }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return handleError(e); }
}
