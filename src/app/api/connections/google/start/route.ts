import { lt } from "drizzle-orm";
import { db } from "@/db";
import { oauthStates } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { challenge, googleConfig, hashState, isGoogleService, randomToken, SCOPES } from "@/lib/connections/google";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const cfg = googleConfig();
    if (!cfg) throw new HttpError(503, "Google OAuth is not configured. Ask the app administrator to configure it.");
    if (req.headers.get("origin") !== cfg.origin) throw new HttpError(403, "Invalid request origin.");
    const body = await req.json().catch(() => ({}));
    if (typeof body.service !== "string" || !isGoogleService(body.service)) throw new HttpError(400, "Unknown service.");
    const service: string = body.service;
    if (!isGoogleService(service)) throw new HttpError(400, "Unknown service.");
    const returnPath = typeof body.returnPath === "string" && /^\/bot\/[0-9a-f-]{36}$/i.test(body.returnPath) ? body.returnPath : "/";
    const state = randomToken(); const verifier = randomToken();
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    await db.insert(oauthStates).values({ stateHash: hashState(state), userId: user.id, service, returnPath, verifierEnc: encrypt(verifier), expiresAt: new Date(Date.now() + 10 * 60_000) });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", scope: SCOPES[service].join(" "), access_type: "offline", prompt: "consent", state, code_challenge: challenge(verifier), code_challenge_method: "S256" }).toString();
    return Response.json({ url: url.toString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return handleError(e); }
}
