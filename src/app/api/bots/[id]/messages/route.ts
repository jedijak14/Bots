import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { bots, messages } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";

export const dynamic = "force-dynamic";

// Archive the visible conversation; the model can still use recent history.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    await db.transaction(async (tx) => {
      // Serialize clearing against a reply being saved for this bot.
      const [locked] = await tx.select({ id: bots.id }).from(bots).where(and(eq(bots.id, id), eq(bots.userId, user.id))).for("update");
      if (!locked) throw new HttpError(404, "Bot not found.");
      await tx.update(messages).set({ archivedAt: new Date() }).where(and(eq(messages.botId, id), eq(messages.userId, user.id), isNull(messages.archivedAt)));
    });
    return Response.json({ ok: true, preview: "New conversation" });
  } catch (e) {
    return handleError(e);
  }
}
