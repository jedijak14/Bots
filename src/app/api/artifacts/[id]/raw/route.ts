import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { mediaRange } from "@/lib/media-upload";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

/**
 * The bytes behind an uploaded song or cover: the artifact stores a data URL,
 * and this route unwraps it into a real response so <audio src> and <img src>
 * work with range requests and the browser's own media stack.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await ctx.params;
    // A malformed id is a 404, not a crash. Postgres rejects a non-UUID string
    // for a uuid column with 22P02, which came back as a 500 from every route
    // that took an id — including the artifact fetches the studio players make
    // for every clip on a timeline.
    if (!isUuid(id)) return Response.json({ error: "Artifact not found." }, { status: 404 });
  const [row] = await db
    .select({ content: artifacts.content, kind: artifacts.kind, title: artifacts.title })
    .from(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id)))
    .limit(1);
  if (!row) return new Response("Not found.", { status: 404 });

  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(row.content);
  if (!match) return new Response("Not a media artifact.", { status: 415 });
  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  const range = mediaRange(req.headers.get("range"), bytes.byteLength);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Length": String(range.end - range.start + 1),
    "Cache-Control": "private, max-age=86400, immutable",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  if (range.partial) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${bytes.byteLength}`;
  return new Response(new Uint8Array(bytes.subarray(range.start, range.end + 1)), { status: range.partial ? 206 : 200, headers });
}
