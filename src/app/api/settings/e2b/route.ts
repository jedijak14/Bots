import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { encrypt, keyHint } from "@/lib/crypto";
import { getSettings, publicSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = (await req.json().catch(() => ({}))) as { apiKey?: string };
    const key = String(b.apiKey ?? "").trim();
    if (!key) throw new HttpError(400, "Paste your E2B API key first.");
    let res: Response;
    try {
      res = await fetch("https://api.e2b.dev/sandboxes", {
        headers: { "X-API-KEY": key },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
    } catch {
      throw new HttpError(400, "Couldn't reach E2B to verify the key. Try again.");
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(400, "E2B rejected this key.");
    if (!res.ok) throw new HttpError(400, `E2B returned ${res.status} while verifying the key.`);
    await getSettings(user.id);
    await db
      .update(userSettings)
      .set({ e2bKeyEnc: encrypt(key), e2bKeyHint: keyHint(key), updatedAt: new Date() })
      .where(eq(userSettings.userId, user.id));
    return Response.json({ settings: publicSettings(await getSettings(user.id)) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await db
      .update(userSettings)
      .set({ e2bKeyEnc: null, e2bKeyHint: null, updatedAt: new Date() })
      .where(eq(userSettings.userId, user.id));
    return Response.json({ settings: publicSettings(await getSettings(user.id)) });
  } catch (e) {
    return handleError(e);
  }
}
