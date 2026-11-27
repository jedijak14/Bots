import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { isUuid } from "@/lib/ids";
import { readLimitedJson } from "@/lib/limited-json";
import { MEDIA_CHUNK_BYTES, MEDIA_LIMITS, mediaType, validMediaChunk } from "@/lib/media-upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await readLimitedJson(req, 1_100_000);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return Response.json({ error: 'Invalid upload.' }, { status: 400 });
    const b = parsed.value as Record<string, unknown>;
    const { botId, uploadId, kind, index, totalBytes, data, title, mime } = b;
    if (typeof botId !== 'string' || !(await getBot(user.id, botId))) return Response.json({ error: 'Bot not found.' }, { status: 404 });
    if ((kind !== 'audio' && kind !== 'image') || typeof title !== 'string' || typeof mime !== 'string' || mediaType(kind, title, mime) !== mime || typeof index !== 'number' || typeof totalBytes !== 'number' || typeof data !== 'string' || totalBytes > MEDIA_LIMITS[kind] || !validMediaChunk(data, index, totalBytes)) return Response.json({ error: 'Invalid file or upload chunk.' }, { status: 400 });
    const prefix = `data:${mime};base64,`;
    const complete = (index + 1) * MEDIA_CHUNK_BYTES >= totalBytes;
    if (index === 0) {
      if (uploadId != null) return Response.json({ error: 'Invalid upload.' }, { status: 400 });
      // Unfinished uploads expire on the user's next upload; never delete complete media.
      await db.delete(artifacts).where(and(eq(artifacts.userId, user.id), eq(artifacts.kind, 'media_upload_pending'), lt(artifacts.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))));
      const [row] = await db.insert(artifacts).values({ userId: user.id, botId, title: title.trim().slice(0, 160) || 'Upload', kind: complete ? kind : 'media_upload_pending', content: prefix + data }).returning({ id: artifacts.id });
      return Response.json({ id: row.id, complete }, { status: 201 });
    }
    if (typeof uploadId !== 'string' || !isUuid(uploadId)) return Response.json({ error: 'Invalid upload.' }, { status: 400 });
    // Atomic length check prevents replay, missing chunks, and simultaneous appends.
    const expectedLength = prefix.length + index * (MEDIA_CHUNK_BYTES / 3 * 4);
    const [row] = await db.update(artifacts).set({ content: sql`${artifacts.content} || ${data}`, kind: complete ? kind : 'media_upload_pending' }).where(and(eq(artifacts.id, uploadId), eq(artifacts.userId, user.id), eq(artifacts.botId, botId), eq(artifacts.kind, 'media_upload_pending'), sql`length(${artifacts.content}) = ${expectedLength}`, sql`left(${artifacts.content}, ${prefix.length}) = ${prefix}`)).returning({ id: artifacts.id });
    if (!row) return Response.json({ error: 'Upload expired or chunks arrived out of order. Please try again.' }, { status: 409 });
    return Response.json({ id: row.id, complete });
  } catch (error) { return handleError(error); }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get('id');
    if (!id || !isUuid(id)) return Response.json({ error: 'Invalid upload.' }, { status: 400 });
    await db.delete(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id), eq(artifacts.kind, 'media_upload_pending')));
    return Response.json({ ok: true });
  } catch (error) { return handleError(error); }
}
