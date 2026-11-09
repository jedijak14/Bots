import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
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
    await db.delete(messages).where(and(eq(messages.botId, id), eq(messages.userId, user.id)));
    await insertGreeting(user.id, id, bot.name);
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
