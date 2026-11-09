import { and, eq } from "drizzle-orm";
import { Sandbox } from "@e2b/desktop";
import { db } from "@/db";
import { bots } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { getBot, toBotDTO } from "@/lib/bots";
import { isColor, isShape } from "@/lib/shapes";
import { e2bKeyFrom, getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<typeof bots.$inferInsert> = { updatedAt: new Date() };
    if (typeof b.name === "string") {
      const n = b.name.trim().slice(0, 40);
      if (!n) throw new HttpError(400, "Name can't be empty.");
      patch.name = n;
    }
    if (typeof b.shape === "string") {
      if (!isShape(b.shape)) throw new HttpError(400, "Invalid shape.");
      patch.shape = b.shape;
    }
    if (typeof b.color === "string") {
      if (!isColor(b.color)) throw new HttpError(400, "Invalid color.");
      patch.color = b.color;
    }
    if (typeof b.instructions === "string") patch.instructions = b.instructions.slice(0, 4000);
    if (b.model === null || typeof b.model === "string") patch.model = (b.model as string | null)?.slice(0, 200) || null;
    const [updated] = await db
      .update(bots)
      .set(patch)
      .where(and(eq(bots.id, id), eq(bots.userId, user.id)))
      .returning();
    return Response.json({ bot: toBotDTO(updated, "") });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    if (bot.sandboxId) {
      const key = e2bKeyFrom(await getSettings(user.id));
      if (key) await Sandbox.kill(bot.sandboxId, { apiKey: key }).catch(() => {});
    }
    await db.delete(bots).where(and(eq(bots.id, id), eq(bots.userId, user.id)));
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
