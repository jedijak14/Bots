import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bots, conversationArchives } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const botId = new URL(req.url).searchParams.get("botId");
    if (botId) {
      const [bot] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), eq(bots.userId, user.id))).limit(1);
      if (!bot) return Response.json({ error: "Bot not found." }, { status: 404 });
      return Response.json(await db.select().from(conversationArchives).where(and(eq(conversationArchives.userId, user.id), eq(conversationArchives.botId, botId))).orderBy(desc(conversationArchives.createdAt)));
    }
    return Response.json(await db.select().from(conversationArchives).where(eq(conversationArchives.userId, user.id)).orderBy(desc(conversationArchives.createdAt)));
  } catch (error) { return handleError(error); }
}
