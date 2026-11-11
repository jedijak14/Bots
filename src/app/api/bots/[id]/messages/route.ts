import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationArchives, messages } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { getBot, insertGreeting } from "@/lib/bots";

export const dynamic = "force-dynamic";

// Clear the conversation (and restart with the greeting)
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    const archivedCount = await db.transaction(async (tx) => {
      const current = await tx.select({ role: messages.role, content: messages.content, createdAt: messages.createdAt }).from(messages).where(and(eq(messages.botId, id), eq(messages.userId, user.id))).orderBy(asc(messages.createdAt));
      if (current.length) {
        await tx.insert(conversationArchives).values({ botId: id, userId: user.id, title: `${bot.name} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, messages: current.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })) });
        await tx.delete(messages).where(and(eq(messages.botId, id), eq(messages.userId, user.id)));
      }
      return current.length;
    });
    await insertGreeting(user.id, id, bot.name);
    return Response.json({ ok: true, archived: archivedCount > 0 });
  } catch (e) {
    return handleError(e);
  }
}
