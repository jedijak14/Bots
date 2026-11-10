import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { githubConfig } from "@/lib/connections/github";
import { googleConfig, isGoogleService } from "@/lib/connections/google";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db.select({ service: connections.service, createdAt: connections.createdAt }).from(connections).where(eq(connections.userId, user.id));
    return Response.json({ googleConfigured: !!googleConfig(), githubConfigured: !!githubConfig(), connections: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return handleError(e); }
}
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const service = new URL(req.url).searchParams.get("service") ?? "";
    if (!isGoogleService(service) && service !== "github") throw new HttpError(400, "Unknown service.");
    const origin = process.env.APP_ORIGIN;
    if (!origin || req.headers.get("origin") !== origin) throw new HttpError(403, "Invalid request origin.");
    await db.delete(connections).where(and(eq(connections.userId, user.id), eq(connections.service, service)));
    return Response.json({ ok: true });
  } catch (e) { return handleError(e); }
}
