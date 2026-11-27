import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { parseSpec } from "@/lib/lyric-video-spec";
import { readLimitedJson } from "@/lib/limited-json";

/** Link a completed MP4 to its source preview. Both artifacts must belong to the user and bot. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = await readLimitedJson(req, 1000);
    if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
    const videoId = (body.value as { videoId?: unknown } | null)?.videoId;
    if (!isUuid(id) || typeof videoId !== "string" || !isUuid(videoId)) return Response.json({ error: "Invalid artifact." }, { status: 400 });
    const [preview] = await db.select().from(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id), eq(artifacts.kind, "lyric_video"))).limit(1);
    if (!preview) return Response.json({ error: "Preview not found." }, { status: 404 });
    const [video] = await db.select({ id: artifacts.id }).from(artifacts).where(and(eq(artifacts.id, videoId), eq(artifacts.userId, user.id), eq(artifacts.botId, preview.botId), eq(artifacts.kind, "video"))).limit(1);
    if (!video) return Response.json({ error: "MP4 artifact not found." }, { status: 404 });
    const spec = parseSpec(preview.content);
    if (!spec) return Response.json({ error: "Invalid lyric video preview." }, { status: 400 });
    await db.update(artifacts).set({ content: JSON.stringify({ ...spec, videoId }) }).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id)));
    return Response.json({ videoId });
  } catch (error) { return handleError(error); }
}
