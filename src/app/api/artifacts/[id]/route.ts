import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";

export type ArtifactDTO = {
  id: string;
  botId: string;
  title: string;
  kind: string;
  content: string;
  archived: boolean;
  createdAt: string;
};

const pick = (a: typeof artifacts.$inferSelect): ArtifactDTO => ({
  id: a.id,
  botId: a.botId,
  title: a.title,
  kind: a.kind,
  content: a.content,
  archived: a.archived,
  createdAt: a.createdAt.toISOString(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [row] = await db.select().from(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id))).limit(1);
    if (!row) return Response.json({ error: "Artifact not found." }, { status: 404 });
    return Response.json(pick(row), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json()) as { archived?: boolean; content?: string };
    const hasArchived = typeof body.archived === "boolean";
    const hasContent = typeof body.content === "string";
    if (!hasArchived && !hasContent) return Response.json({ error: "Nothing to update." }, { status: 400 });

    const [current] = await db.select().from(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id))).limit(1);
    if (!current) return Response.json({ error: "Artifact not found." }, { status: 404 });

    const patch: { archived?: boolean; content?: string } = {};
    if (hasArchived) patch.archived = body.archived as boolean;
    if (hasContent) {
      const content = (body.content as string).slice(0, 100_000);
      // Email drafts are JSON; refuse to store something the composer can't read back.
      if (current.kind.startsWith("email_") || current.kind === "sent_email") {
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          if (!parsed || typeof parsed !== "object" || typeof parsed.body !== "string") throw new Error("bad draft");
        } catch {
          return Response.json({ error: "That draft isn't valid JSON." }, { status: 400 });
        }
      }
      patch.content = content;
    }

    const [updated] = await db.update(artifacts).set(patch).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id))).returning();
    if (!updated) return Response.json({ error: "Artifact not found." }, { status: 404 });
    return Response.json(pick(updated));
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [deleted] = await db.delete(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id))).returning({ id: artifacts.id });
    if (!deleted) return Response.json({ error: "Artifact not found." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
