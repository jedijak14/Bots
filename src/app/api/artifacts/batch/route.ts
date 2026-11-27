import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { readLimitedJson } from "@/lib/limited-json";

/** Fetch just the cards referenced in a transcript, not every uploaded song. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const result = await readLimitedJson(req, 8000);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    const ids = (result.value as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== "string" || !isUuid(id))) return Response.json({ error: "Invalid artifact ids." }, { status: 400 });
    if (!ids.length) return Response.json({ artifacts: [] });
    const rows = await db.select({ id: artifacts.id, title: artifacts.title, kind: artifacts.kind, content: sql<string>`case when ${artifacts.kind} in ('audio', 'image', 'media_upload_pending') then '' else ${artifacts.content} end`, archived: artifacts.archived, createdAt: artifacts.createdAt })
      .from(artifacts).where(and(eq(artifacts.userId, user.id), inArray(artifacts.id, ids)));
    return Response.json({ artifacts: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return handleError(error); }
}
