import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { connections, oauthStates } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { encryptCredential } from "@/lib/connections/credential-crypto";
import { googleConfig, hashState, isGoogleService, SCOPES } from "@/lib/connections/google";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const cfg = googleConfig();
  if (!cfg) return new Response("Google OAuth is not configured.", { status: 503 });
  const done = (result: string, path = "/") => Response.redirect(`${cfg.origin}${path}?connection=${encodeURIComponent(result)}`, 303);
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!user || !/^[A-Za-z0-9_-]{43}$/.test(state)) return done("failed");
  // Atomic consumption makes state single-use and ties it to the signed-in user.
  const [record] = await db.delete(oauthStates).where(and(eq(oauthStates.stateHash, hashState(state)), eq(oauthStates.userId, user.id), gt(oauthStates.expiresAt, new Date()))).returning();
  if (!record) return done("failed");
  const returnPath = /^\/bot\/[0-9a-f-]{36}$/i.test(record.returnPath) ? record.returnPath : "/";
  if (!code || !isGoogleService(record.service)) return done("failed", returnPath);
  const verifier = decrypt(record.verifierEnc);
  if (!verifier) return done("failed", returnPath);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, code, code_verifier: verifier, grant_type: "authorization_code" }), cache: "no-store",
    });
    if (!response.ok) return done("failed", returnPath);
    const token = await response.json() as { refresh_token?: unknown; scope?: unknown };
    const granted = typeof token.scope === "string" ? token.scope.split(" ") : [];
    if (!SCOPES[record.service].every((scope) => granted.includes(scope))) return done("failed", returnPath);
    // Do not claim success unless an offline token was issued.
    if (typeof token.refresh_token !== "string" || !token.refresh_token) return done("failed", returnPath);
    const tokenEnc = encryptCredential(token.refresh_token, user.id, record.service);
    await db.insert(connections).values({ userId: user.id, service: record.service, refreshTokenEnc: tokenEnc, scopes: granted.join(" ") })
      .onConflictDoUpdate({ target: [connections.userId, connections.service], set: { refreshTokenEnc: tokenEnc, scopes: granted.join(" "), createdAt: new Date() } });
    return done(record.service, returnPath);
  } catch { return done("failed", returnPath); }
}
