import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { getSettings, publicSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(publicSettings(await getSettings(user.id)));
  } catch (e) {
    return handleError(e);
  }
}

// Preferences + default model
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    await getSettings(user.id);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<typeof userSettings.$inferInsert> = { updatedAt: new Date() };
    if (typeof b.followMouse === "boolean") patch.followMouse = b.followMouse;
    if (typeof b.animations === "boolean") patch.animations = b.animations;
    if (typeof b.voiceReplies === "boolean") patch.voiceReplies = b.voiceReplies;
    if (typeof b.defaultModel === "string") patch.defaultModel = b.defaultModel.slice(0, 200) || null;
    await db.update(userSettings).set(patch).where(eq(userSettings.userId, user.id));
    return Response.json(publicSettings(await getSettings(user.id)));
  } catch (e) {
    return handleError(e);
  }
}
