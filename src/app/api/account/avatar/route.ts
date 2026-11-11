import { del, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose an image first.");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isHeic = file.type === "image/heic" || file.type === "image/heif" || extension === "heic" || extension === "heif";
    if (!TYPES.has(file.type) && !isHeic && !EXTENSIONS.has(extension)) throw new HttpError(400, "This image is not supported.");
    if (file.size > MAX_BYTES) throw new HttpError(400, "Profile pictures must be 5 MB or smaller.");

    const ext = isHeic ? extension : file.type.split("/")[1].replace("jpeg", "jpg");
    const blob = await put(`avatars/${user.id}.${ext}`, file, { access: "public", addRandomSuffix: true });
    const [current] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, user.id)).limit(1);
    await db.update(users).set({ avatarUrl: blob.url }).where(eq(users.id, user.id));
    if (current?.avatarUrl) await del(current.avatarUrl).catch(() => undefined);
    return Response.json({ avatarUrl: blob.url });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    const [current] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, user.id)).limit(1);
    await db.update(users).set({ avatarUrl: null }).where(eq(users.id, user.id));
    if (current?.avatarUrl) await del(current.avatarUrl).catch(() => undefined);
    return Response.json({ avatarUrl: null });
  } catch (e) {
    return handleError(e);
  }
}
