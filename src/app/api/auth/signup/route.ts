import { createSession, handleError, signUpWithAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string; name?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "");
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const result = await signUpWithAccount(email, password, name, ip);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    await createSession(result.userId);
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
