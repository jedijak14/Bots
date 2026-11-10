import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { googleConfig, isGoogleService } from "@/lib/connections/google";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db.select({ service: connections.service, createdAt: connections.createdAt }).from(connections).where(eq(connections.userId, user.id));
    return Response.json({ googleConfigured: !!googleConfig(), connections: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return handleError(e); }
}
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const cfg = googleConfig();
    if (!cfg || req.headers.get("origin") !== cfg.origin) throw new HttpError(403, "Invalid request origin.");
    const service = new URL(req.url).searchParams.get("service") ?? "";
    if (!isGoogleService(service)) throw new HttpError(400, "Unknown service.");
    await db.delete(connections).where(and(eq(connections.userId, user.id), eq(connections.service, service)));
    return Response.json({ ok: true });
  } catch (e) { return handleError(e); }
}
