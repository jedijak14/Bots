import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json()) as { archived?: boolean };
    if (typeof body.archived !== "boolean") return Response.json({ error: "Expected an archive state." }, { status: 400 });
    const [updated] = await db.update(artifacts).set({ archived: body.archived }).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id))).returning({ id: artifacts.id, archived: artifacts.archived });
    if (!updated) return Response.json({ error: "Artifact not found." }, { status: 404 });
    return Response.json(updated);
  } catch (error) { return handleError(error); }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [deleted] = await db.delete(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id))).returning({ id: artifacts.id });
    if (!deleted) return Response.json({ error: "Artifact not found." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) { return handleError(error); }
}
