import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bots, skills } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { normalizeSkillConnectors, normalizeSkillTools } from "@/lib/skill-permissions";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json()) as { enabled?: boolean; name?: string; instructions?: string; botId?: string | null; allowedTools?: unknown; allowedConnectors?: unknown };
    const update: Partial<typeof skills.$inferInsert> = { updatedAt: new Date() };
    let changed = false;
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return Response.json({ error: "Invalid enabled state." }, { status: 400 });
      update.enabled = body.enabled;
      changed = true;
    }
    if (body.name !== undefined || body.instructions !== undefined) {
      if (typeof body.name !== "string" || typeof body.instructions !== "string") return Response.json({ error: "Provide a skill name and instructions." }, { status: 400 });
      update.name = body.name.trim().slice(0, 80);
      update.instructions = body.instructions.trim().slice(0, 8000);
      if (!update.name || !update.instructions) return Response.json({ error: "Provide a skill name and instructions." }, { status: 400 });
      changed = true;
    }
    if (body.botId !== undefined) {
      const botId = body.botId || null;
      if (botId) {
        const [bot] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), eq(bots.userId, user.id))).limit(1);
        if (!bot) return Response.json({ error: "Bot not found." }, { status: 404 });
      }
      update.botId = botId;
      changed = true;
    }
    if (body.allowedTools !== undefined) { update.allowedTools = normalizeSkillTools(body.allowedTools); changed = true; }
    if (body.allowedConnectors !== undefined) { update.allowedConnectors = normalizeSkillConnectors(body.allowedConnectors); changed = true; }
    if (!changed) return Response.json({ error: "No skill changes provided." }, { status: 400 });
    const [skill] = await db.update(skills).set({ ...update, version: sql`${skills.version} + 1` }).where(and(eq(skills.id, id), eq(skills.userId, user.id))).returning({ id: skills.id, enabled: skills.enabled, version: skills.version });
    if (!skill) return Response.json({ error: "Skill not found." }, { status: 404 });
    return Response.json(skill);
  } catch (error) { return handleError(error); }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [deleted] = await db.delete(skills).where(and(eq(skills.id, id), eq(skills.userId, user.id))).returning({ id: skills.id });
    if (!deleted) return Response.json({ error: "Skill not found." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) { return handleError(error); }
}
