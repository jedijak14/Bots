import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bots, messages } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return Response.json({ results: [] });
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const byName = await db
      .select({ id: bots.id, name: bots.name, shape: bots.shape, color: bots.color })
      .from(bots)
      .where(and(eq(bots.userId, user.id), ilike(bots.name, like)))
      .limit(5);
    const byMsg = await db
      .select({
        id: bots.id,
        name: bots.name,
        shape: bots.shape,
        color: bots.color,
        snippet: sql<string>`substr(${messages.content}, greatest(position(lower(${q}) in lower(${messages.content})) - 30, 1), 140)`,
      })
      .from(messages)
      .innerJoin(bots, eq(bots.id, messages.botId))
      .where(and(eq(messages.userId, user.id), or(ilike(messages.content, like))))
      .orderBy(desc(messages.createdAt))
      .limit(15);
    return Response.json({
      results: [
        ...byName.map((b) => ({ ...b, snippet: "Bot" })),
        ...byMsg.map((m) => ({ ...m, snippet: m.snippet.replace(/\s+/g, " ").trim() })),
      ],
    });
  } catch (e) {
    return handleError(e);
  }
}
