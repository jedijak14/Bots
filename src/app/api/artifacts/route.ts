import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "true";
    const filters = includeArchived ? eq(artifacts.userId, user.id) : and(eq(artifacts.userId, user.id), eq(artifacts.archived, false));
    return Response.json(await db.select({ id: artifacts.id, botId: artifacts.botId, title: artifacts.title, kind: artifacts.kind, content: artifacts.content, archived: artifacts.archived, createdAt: artifacts.createdAt }).from(artifacts).where(filters).orderBy(desc(artifacts.createdAt)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleError(error); }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { botId?: string; title?: string; kind?: string; content?: string };
    if (!body.botId || !(await getBot(user.id, body.botId))) return Response.json({ error: "Bot not found." }, { status: 404 });
    const title = String(body.title ?? "").trim().slice(0, 160);
    const kind = String(body.kind ?? "document").slice(0, 40);
    const content = String(body.content ?? "");
    if (!title || !content || content.length > 100_000) return Response.json({ error: "Artifact title and content are required (up to 100 KB)." }, { status: 400 });
    const [artifact] = await db.insert(artifacts).values({ botId: body.botId, userId: user.id, title, kind, content }).returning({ id: artifacts.id, title: artifacts.title, kind: artifacts.kind, createdAt: artifacts.createdAt });
    return Response.json(artifact, { status: 201 });
  } catch (error) { return handleError(error); }
}
