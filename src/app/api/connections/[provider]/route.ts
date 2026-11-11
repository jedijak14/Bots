import { getToken, revokeToken, UserAuthorizationRequiredError } from "@vercel/connect";
import { getCurrentUser } from "@/lib/auth";
import { beginConnection, CONNECTORS, connectParams, isProvider } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { provider: raw } = await ctx.params;
  if (!isProvider(raw)) return Response.json({ error: "Unknown connection." }, { status: 404 });
  try {
    await getToken(CONNECTORS[raw].uid, connectParams(raw, user.id), { forceRefresh: true });
    return Response.json({ connected: true, provider: raw }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UserAuthorizationRequiredError || (error instanceof Error && "code" in error && (error as { code?: string }).code === "user_authorization_required")) {
      return Response.json({ connected: false, provider: raw }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Connection status is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { provider: raw } = await ctx.params;
  if (!isProvider(raw)) return Response.json({ error: "Unknown connection." }, { status: 404 });
  try {
    await revokeToken(CONNECTORS[raw].uid, { subject: { type: "user", id: user.id } });
    return Response.json({ connected: false, provider: raw }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UserAuthorizationRequiredError || (error instanceof Error && "code" in error && (error as { code?: string }).code === "user_authorization_required")) return Response.json({ connected: false, provider: raw }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "Could not revoke this connection. Try again." }, { status: 503 });
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { provider: raw } = await ctx.params;
  if (!isProvider(raw)) return Response.json({ error: "Unknown connection." }, { status: 404 });
  try {
    const authorization = await beginConnection(raw, user.id);
    return Response.json({ url: authorization.url }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not start secure authorization. Try again." }, { status: 503 });
  }
}
