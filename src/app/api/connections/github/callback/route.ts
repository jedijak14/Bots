import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { connections, oauthStates } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { encryptCredential } from "@/lib/connections/credential-crypto";
import { hashState } from "@/lib/connections/google";
import { githubScopesAreSafe } from "@/lib/connections/github-scopes";
import { githubConfig } from "@/lib/connections/github";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const cfg = githubConfig();
  if (!cfg) return new Response("GitHub OAuth is not configured.", { status: 503 });
  const done = (result: string, path = "/") => Response.redirect(`${cfg.origin}${path}?connection=${encodeURIComponent(result)}`, 303);
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!user || !/^[A-Za-z0-9_-]{43}$/.test(state)) return done("failed");
  const [record] = await db.delete(oauthStates).where(and(eq(oauthStates.stateHash, hashState(state)), eq(oauthStates.userId, user.id), eq(oauthStates.service, "github"), gt(oauthStates.expiresAt, new Date()))).returning();
  if (!record) return done("failed");
  const path = /^\/bot\/[0-9a-f-]{36}$/i.test(record.returnPath) ? record.returnPath : "/";
  const verifier = decrypt(record.verifierEnc);
  if (!code || !verifier) return done("failed", path);
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri, code_verifier: verifier }), cache: "no-store" });
    if (!res.ok) return done("failed", path);
    const token = await res.json() as { access_token?: unknown; scope?: unknown; token_type?: unknown };
    if (typeof token.access_token !== "string" || !token.access_token || !githubScopesAreSafe(token.scope) || String(token.token_type).toLowerCase() !== "bearer") return done("failed", path);
    const tokenEnc = encryptCredential(token.access_token, user.id, "github");
    await db.insert(connections).values({ userId: user.id, service: "github", refreshTokenEnc: tokenEnc, scopes: token.scope as string })
      .onConflictDoUpdate({ target: [connections.userId, connections.service], set: { refreshTokenEnc: tokenEnc, scopes: token.scope as string, createdAt: new Date() } });
    return done("github", path);
  } catch { return done("failed", path); }
}
