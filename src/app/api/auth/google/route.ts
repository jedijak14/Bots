import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { users, userSettings } from "@/db/schema";
import { createSession } from "@/lib/auth";

const STATE_COOKIE = "google_oauth_state";

function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/auth/google/callback`;
}

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(new URL("/login?error=google_not_configured", (await headers()).get("origin") || "http://localhost:3000"));
  }
  const state = randomBytes(24).toString("hex");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  const response = Response.redirect(url);
  (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  return response;
}

export async function handleCallback(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const savedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  const origin = url.origin;
  if (!code || !state || !savedState || state !== savedState) return Response.redirect(`${origin}/login?error=google_state`);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return Response.redirect(`${origin}/login?error=google_not_configured`);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return Response.redirect(`${origin}/login?error=google_failed`);
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) return Response.redirect(`${origin}/login?error=google_failed`);
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!profileResponse.ok) return Response.redirect(`${origin}/login?error=google_failed`);
  const profile = (await profileResponse.json()) as { sub?: string; email?: string; name?: string; email_verified?: boolean };
  if (!profile.sub || !profile.email || profile.email_verified === false) return Response.redirect(`${origin}/login?error=google_email`);

  const existing = await db.select().from(users).where(eq(users.email, profile.email.toLowerCase())).limit(1);
  let userId = existing[0]?.id;
  if (existing[0]) {
    await db.update(users).set({ googleSubject: profile.sub, displayName: existing[0].displayName || profile.name || profile.email.split("@")[0] }).where(eq(users.id, existing[0].id));
  } else {
    const created = await db.insert(users).values({ email: profile.email.toLowerCase(), googleSubject: profile.sub, displayName: profile.name?.trim().slice(0, 40) || profile.email.split("@")[0] }).returning({ id: users.id });
    userId = created[0]?.id;
    if (userId) await db.insert(userSettings).values({ userId }).onConflictDoNothing();
  }
  if (!userId) return Response.redirect(`${origin}/login?error=google_failed`);
  await createSession(userId);
  return Response.redirect(`${origin}/`);
}
