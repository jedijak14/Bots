import { destroySession, handleError } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await destroySession();
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
