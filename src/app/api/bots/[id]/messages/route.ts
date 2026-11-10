import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { getBot, greetingPreview, insertGreeting } from "@/lib/bots";

export const dynamic = "force-dynamic";

// Archive the visible conversation; the model can still use recent history.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    await db.update(messages).set({ archivedAt: new Date() }).where(and(eq(messages.botId, id), eq(messages.userId, user.id), isNull(messages.archivedAt)));
    await insertGreeting(user.id, id, bot.name);
    return Response.json({ ok: true, preview: greetingPreview(bot.name) });
  } catch (e) {
    return handleError(e);
  }
}
