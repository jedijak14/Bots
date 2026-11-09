import { createSession, handleError, signInWithPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const result = await signInWithPassword(email, password, ip);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    await createSession(result.userId);
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
