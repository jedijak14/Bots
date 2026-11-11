import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationArchives } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [deleted] = await db.delete(conversationArchives).where(and(eq(conversationArchives.id, id), eq(conversationArchives.userId, user.id))).returning({ id: conversationArchives.id });
    if (!deleted) return Response.json({ error: "Archive not found." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) { return handleError(error); }
}
