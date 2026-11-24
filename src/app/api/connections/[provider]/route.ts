import { ConnectorInstallationRequiredError, getToken, revokeToken, UserAuthorizationRequiredError } from "@vercel/connect";
import { getCurrentUser } from "@/lib/auth";
import { beginConnection, CONNECTORS, connectParams, isProvider } from "@/lib/connectors";
import { hasAppGoogleCredentials } from "@/lib/mail";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

function isAuthorizationError(error: unknown) {
  return (
    error instanceof UserAuthorizationRequiredError ||
    (error instanceof Error && "code" in error && (error as { code?: string }).code === "user_authorization_required")
  );
}

/**
 * Reports whether a provider is usable. For Google, a deployment that carries its
 * own OAuth credentials can send mail even without a per-user connection, so it
 * reports `mode: "app"` instead of asking the user to connect again.
 *
 * `available: false` means this deployment cannot offer the provider at all (the
 * connector is not installed, or the app is not on Vercel Connect) — that is a
 * setup fact, not an error, so the panel says so instead of shouting.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { provider: raw } = await ctx.params;
  if (!isProvider(raw)) return Response.json({ error: "Unknown connection." }, { status: 404 });

  const appGoogle = raw === "google" && hasAppGoogleCredentials();
  try {
    await getToken(CONNECTORS[raw].uid, connectParams(raw, user.id), { forceRefresh: true });
    return Response.json({ connected: true, provider: raw, mode: "user" }, NO_STORE);
  } catch (error) {
    if (appGoogle) return Response.json({ connected: true, provider: raw, mode: "app" }, NO_STORE);
    if (isAuthorizationError(error)) return Response.json({ connected: false, available: true, provider: raw }, NO_STORE);
    if (error instanceof ConnectorInstallationRequiredError) {
      return Response.json({ connected: false, available: false, provider: raw, reason: "connector" }, NO_STORE);
    }
    // No OIDC locally, or a deployment that is not linked to Vercel Connect at all.
    return Response.json({ connected: false, available: false, provider: raw, reason: "unconfigured" }, NO_STORE);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { provider: raw } = await ctx.params;
  if (!isProvider(raw)) return Response.json({ error: "Unknown connection." }, { status: 404 });
  try {
    await revokeToken(CONNECTORS[raw].uid, { subject: { type: "user", id: user.id } });
    return Response.json({ connected: false, provider: raw }, NO_STORE);
  } catch (error) {
    if (isAuthorizationError(error)) return Response.json({ connected: false, provider: raw }, NO_STORE);
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
    return Response.json({ url: authorization.url }, NO_STORE);
  } catch {
    return Response.json({ error: "Could not start secure authorization. Try again." }, { status: 503 });
  }
}
