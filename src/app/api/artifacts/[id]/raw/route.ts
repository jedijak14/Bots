import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The bytes behind an uploaded song or cover: the artifact stores a data URL,
 * and this route unwraps it into a real response so <audio src> and <img src>
 * work with range requests and the browser's own media stack.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { id } = await ctx.params;
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
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      // Media never changes in place; a new upload is a new artifact.
      "Cache-Control": "private, max-age=86400, immutable",
      "Accept-Ranges": "none",
    },
  });
}
