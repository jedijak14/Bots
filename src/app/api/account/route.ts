import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { handleError, hashPassword, HttpError, requireUser, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Update display name / change password / delete account
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as {
      displayName?: string;
      currentPassword?: string;
      newPassword?: string;
    };
    if (body.displayName !== undefined) {
      const name = body.displayName.trim().slice(0, 40);
      if (!name) throw new HttpError(400, "Name can't be empty.");
      await db.update(users).set({ displayName: name }).where(eq(users.id, user.id));
    }
    if (body.newPassword !== undefined) {
      if (body.newPassword.length < 8) throw new HttpError(400, "New password must be at least 8 characters.");
      const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (!row || !(await verifyPassword(body.currentPassword ?? "", row.passwordHash))) {
        throw new HttpError(400, "Current password is incorrect. This account uses Google sign-in.");
      }
      await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user.id));
      const token = (await cookies()).get("bot_session")?.value;
      if (token) {
        const keep = createHash("sha256").update(token).digest("hex");
        await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, keep)));
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row || !(await verifyPassword(body.password ?? "", row.passwordHash))) {
      throw new HttpError(400, "Password is incorrect or unavailable for Google accounts.");
    }
    await db.delete(users).where(eq(users.id, user.id));
    (await cookies()).delete("bot_session");
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
