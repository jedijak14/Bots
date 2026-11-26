import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { bots, skills } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { normalizeSkillConnectors, normalizeSkillTools } from "@/lib/skill-permissions";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const requestedBotId = new URL(req.url).searchParams.get("botId");
    if (requestedBotId && requestedBotId !== "global") {
      if (!isUuid(requestedBotId)) return Response.json({ error: "Bot not found." }, { status: 404 });
      const [bot] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, requestedBotId), eq(bots.userId, user.id))).limit(1);
      if (!bot) return Response.json({ error: "Bot not found." }, { status: 404 });
      return Response.json(await db.select().from(skills).where(and(eq(skills.userId, user.id), or(isNull(skills.botId), eq(skills.botId, requestedBotId)))).orderBy(desc(skills.createdAt)));
    }
    // The Settings list is the management view, not a runtime lookup: it has to
    // show every skill the person owns. Filtering to `botId is null` here hid
    // every skill assigned to one Bot, which read as "no skills yet" while one
    // was plainly saved.
    return Response.json(await db.select().from(skills).where(eq(skills.userId, user.id)).orderBy(desc(skills.createdAt)));
  } catch (error) { return handleError(error); }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { name?: string; instructions?: string; botId?: string | null; allowedTools?: unknown; allowedConnectors?: unknown };
    const name = String(body.name ?? "").trim().slice(0, 80);
    const instructions = String(body.instructions ?? "").trim().slice(0, 4000);
    const botId = body.botId || null;
    if (!name || !instructions) return Response.json({ error: "A skill name and instructions are required." }, { status: 400 });
    if (botId) {
      if (!isUuid(botId)) return Response.json({ error: "Bot not found." }, { status: 404 });
      const [bot] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), eq(bots.userId, user.id))).limit(1);
      if (!bot) return Response.json({ error: "Bot not found." }, { status: 404 });
    }
    const [skill] = await db.insert(skills).values({ userId: user.id, botId, name, instructions, allowedTools: normalizeSkillTools(body.allowedTools), allowedConnectors: normalizeSkillConnectors(body.allowedConnectors) }).returning();
    return Response.json(skill);
  } catch (error) { return handleError(error); }
}
