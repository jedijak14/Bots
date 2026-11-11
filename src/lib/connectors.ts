import "server-only";

import { getToken, startAuthorization } from "@vercel/connect";
import type { ConnectTokenParams } from "@vercel/connect";
import { headers } from "next/headers";

export const CONNECTORS = {
  google: {
    uid: "google/bots-google-access",
    scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/youtube.readonly"],
  },
  github: { uid: "github/bots-github-access", scopes: ["read:user", "repo"] },
  notion: { uid: "notion/bots-notion-access", scopes: ["read_content", "search"] },
  vercel: { uid: "vercel/bots-vercel-access", scopes: ["read:project"] },
  spotify: { uid: "spotify/bots-spotify-access", scopes: ["user-library-read"] },
} as const;

export type Provider = keyof typeof CONNECTORS;

export function isProvider(value: string): value is Provider {
  return Object.hasOwn(CONNECTORS, value);
}

export function connectParams(provider: Provider, userId: string): ConnectTokenParams {
  return {
    subject: { type: "user", id: userId },
    scopes: [...CONNECTORS[provider].scopes],
  };
}

export async function getConnectionToken(provider: Provider, userId: string): Promise<string> {
  return getToken(CONNECTORS[provider].uid, connectParams(provider, userId));
}

async function getOrigin() {
  if (process.env.NODE_ENV !== "production" && process.env.V0_RUNTIME_URL) return process.env.V0_RUNTIME_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  if (host) return `${protocol}://${host}`;
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  throw new Error("Unable to determine the app origin.");
}

export async function beginConnection(provider: Provider, userId: string) {
  const origin = await getOrigin();
  return startAuthorization(CONNECTORS[provider].uid, connectParams(provider, userId), {
    callbackUrl: `${origin}/?connection=${provider}`,
  });
}
