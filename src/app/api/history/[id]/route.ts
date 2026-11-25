import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationArchives } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/ids";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    // A malformed id is a 404, not a 500: Postgres raises 22P02 on a non-uuid
    // string and every route that took an id answered with a server error.
    if (!isUuid(id)) return Response.json({ error: "Archive not found." }, { status: 404 });
    const [deleted] = await db.delete(conversationArchives).where(and(eq(conversationArchives.id, id), eq(conversationArchives.userId, user.id))).returning({ id: conversationArchives.id });
    if (!deleted) return Response.json({ error: "Archive not found." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) { return handleError(error); }
}
