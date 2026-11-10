import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { decryptCredential } from "@/lib/connections/credential-crypto";

export function githubConfig() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const origin = process.env.APP_ORIGIN;
  const secret = process.env.APP_SECRET;
  if (!clientId || !clientSecret || !origin || !secret || secret.length < 32) return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost" && url.protocol === "http:"))) return null;
    return { clientId, clientSecret, origin, redirectUri: `${origin}/api/connections/github/callback` };
  } catch { return null; }
}

/** Fixed, read-only endpoint: tokens are never given to the model or desktop. */
export async function githubRepos(userId: string): Promise<string> {
  const [connection] = await db.select().from(connections).where(and(eq(connections.userId, userId), eq(connections.service, "github"))).limit(1);
  const token = connection && decryptCredential(connection.refreshTokenEnc, userId, "github");
  if (!token) throw new Error("Connect GitHub in Settings first.");
  const res = await fetch("https://api.github.com/user/repos?per_page=30&sort=updated", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Bots-App" }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub request failed (${res.status}). Reconnect GitHub if authorization has expired.`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("Unexpected GitHub response.");
  return JSON.stringify(data.slice(0, 30).map((r) => ({ name: String(r.full_name ?? "").slice(0, 200), description: String(r.description ?? "").slice(0, 300), url: r.html_url, private: !!r.private, updatedAt: r.updated_at })));
}
