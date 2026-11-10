import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { skills } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await db.select().from(skills).where(eq(skills.userId, user.id)).orderBy(asc(skills.createdAt)));
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    if (!name || name.length > 80 || !instructions || instructions.length > 4000) throw new HttpError(400, "Enter a name (up to 80 characters) and instructions (up to 4,000 characters).");
    const existing = await db.select({ id: skills.id }).from(skills).where(eq(skills.userId, user.id)).limit(20);
    if (existing.length >= 20) throw new HttpError(400, "You can save up to 20 skills.");
    const [skill] = await db.insert(skills).values({ userId: user.id, name, instructions }).returning();
    return Response.json(skill, { status: 201 });
  } catch (e) { return handleError(e); }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Invalid skill.");
    await db.delete(skills).where(and(eq(skills.id, id), eq(skills.userId, user.id)));
    return Response.json({ ok: true });
  } catch (e) { return handleError(e); }
}
