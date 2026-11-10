import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { decryptCredential } from "@/lib/connections/credential-crypto";

export type GoogleService = "gmail" | "youtube";
export const SCOPES: Record<GoogleService, string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
  youtube: ["https://www.googleapis.com/auth/youtube.readonly"],
};
export const isGoogleService = (s: string): s is GoogleService => s === "gmail" || s === "youtube";
export const hashState = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export const challenge = (v: string) => createHash("sha256").update(v).digest("base64url");

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const origin = process.env.APP_ORIGIN;
  const secret = process.env.APP_SECRET;
  if (!clientId || !clientSecret || !origin || !secret || secret.length < 32) return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost" && url.protocol === "http:"))) return null;
    return { clientId, clientSecret, origin, redirectUri: `${origin}/api/connections/google/callback` };
  } catch { return null; }
}

// This broker is server-only: it never returns tokens to the model, browser, or desktop.
export async function accessToken(userId: string, service: GoogleService): Promise<string> {
  const cfg = googleConfig();
  if (!cfg) throw new Error("Google connections are not configured by the app administrator.");
  const [connection] = await db.select().from(connections).where(and(eq(connections.userId, userId), eq(connections.service, service))).limit(1);
  const refresh = connection ? decryptCredential(connection.refreshTokenEnc, userId, service) : null;
  if (!refresh) throw new Error(`Connect ${service === "gmail" ? "Gmail" : "YouTube"} in Settings first.`);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refresh, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The Google connection could not be refreshed. Reconnect it in Settings.");
  const data = await response.json() as { access_token?: unknown };
  if (typeof data.access_token !== "string") throw new Error("Google did not return an access token.");
  return data.access_token;
}

export async function googleGet(userId: string, service: GoogleService, url: string, existingToken?: string): Promise<unknown> {
  // Only fixed Google API URLs from this module's callers, never model-supplied URLs.
  if (!url.startsWith("https://www.googleapis.com/")) throw new Error("Invalid Google API endpoint.");
  const token = existingToken ?? await accessToken(userId, service);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Google ${service} request failed (${r.status}).`);
  return r.json();
}

export async function gmailSearch(userId: string, query: string): Promise<string> {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent(query.slice(0, 300))}`;
  const token = await accessToken(userId, "gmail");
  const list = await googleGet(userId, "gmail", url, token) as { messages?: { id: string }[] };
  const results = await Promise.all((list.messages ?? []).slice(0, 5).map(async (item) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)) return null;
    const msg = await googleGet(userId, "gmail", `https://www.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
    return { id: item.id, headers: msg.payload?.headers ?? [], snippet: msg.snippet ?? "" };
  }));
  return JSON.stringify(results);
}

export async function youtubePlaylists(userId: string): Promise<string> {
  const result = await googleGet(userId, "youtube", "https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=20") as { items?: { id?: string; snippet?: { title?: string; description?: string } }[] };
  return JSON.stringify((result.items ?? []).map((p) => ({ id: p.id, title: p.snippet?.title, description: p.snippet?.description?.slice(0, 300) })));
}


type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: GmailPart[] };
function plainParts(part: GmailPart | undefined): string[] {
  if (!part || part.filename) return [];
  const own = part.mimeType === "text/plain" && typeof part.body?.data === "string"
    ? [Buffer.from(part.body.data, "base64url").toString("utf8").slice(0, 12000)] : [];
  return [...own, ...(part.parts ?? []).flatMap(plainParts)];
}
export async function gmailRead(userId: string, id: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid Gmail message ID.");
  const msg = await googleGet(userId, "gmail", `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`) as { snippet?: string; payload?: GmailPart & { headers?: { name: string; value: string }[] } };
  const headers = (msg.payload?.headers ?? []).filter((h) => /^(from|to|subject|date)$/i.test(h.name));
  const body = plainParts(msg.payload).join("\n").slice(0, 12000);
  return JSON.stringify({ headers, body: body || msg.snippet || "No plain-text body available." });
}
