import "server-only";

import { ConnectorInstallationRequiredError, getToken, NoValidTokenError, UserAuthorizationRequiredError } from "@vercel/connect";

/** Why a send failed. The route maps these onto HTTP statuses and the UI onto advice. */
export type MailErrorCode = "not_connected" | "connector_missing" | "token_failed" | "auth" | "rate_limit" | "network" | "gmail";

export class MailError extends Error {
  constructor(
    public readonly code: MailErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MailError";
  }
}

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Access tokens for the app's own Google OAuth client. This is the fallback for
 * deployments that are not on Vercel Connect (or where the Google connector has
 * not been installed yet): put a refresh token with `gmail.send` in the
 * environment and email works without any per-user consent screen.
 */
function appGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

/** True when email can be sent without a per-user Google connection. */
export function hasAppGoogleCredentials(): boolean {
  return appGoogleConfig() !== null;
}

async function appGoogleAccessToken(): Promise<string> {
  const config = appGoogleConfig();
  if (!config) throw new MailError("not_connected", "Connect your Google account to send email.", 401);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new MailError(
      "auth",
      `Google rejected the app credentials.${data.error_description ? ` ${data.error_description}` : ""}`,
      502,
    );
  }
  return data.access_token;
}

/**
 * Resolves a Gmail access token: Vercel Connect for the signed-in user first,
 * then the deployment's own Google credentials. Errors are typed so the caller
 * can tell "you need to connect Google" from "Google is down".
 */
export async function getGmailAccessToken(connectUid: string, subject: { type: "user"; id: string }, scopes: string[]): Promise<string> {
  try {
    return await getToken(connectUid, { subject, scopes });
  } catch (error) {
    if (error instanceof ConnectorInstallationRequiredError) {
      // No connector on this project: the deployment's own credentials can still save the day.
      if (appGoogleConfig()) return appGoogleAccessToken();
      throw new MailError(
        "connector_missing",
        "Google isn't linked to this deployment. Add the Google connector in Vercel Connect, or set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.",
        503,
      );
    }
    if (error instanceof NoValidTokenError || error instanceof UserAuthorizationRequiredError) {
      if (appGoogleConfig()) return appGoogleAccessToken();
      throw new MailError("not_connected", "Connect your Google account in Settings → Connections to send email.", 401);
    }
    if (appGoogleConfig()) return appGoogleAccessToken();
    const detail = error instanceof Error ? error.message : "";
    // Connect without OIDC (local dev, or a deployment that isn't linked) is the
    // one failure people actually hit, so say what to do about it.
    if (/oidc-token|vc link|project root/i.test(detail)) {
      throw new MailError(
        "token_failed",
        "Google sign-in only works in a linked Vercel deployment. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN to send from here.",
        502,
      );
    }
    throw new MailError("token_failed", `Couldn't get a Google token.${detail ? ` ${detail.slice(0, 140)}` : ""}`, 502);
  }
}

/** Wraps a plain-text body in the minimal MIME message Gmail accepts. */
export function mimeMessage(to: string, subject: string, body: string, from?: string): string {
  const text = body.replace(/\r?\n/g, "\r\n");
  const headers = [
    `To: ${to}`,
    `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
    ...(from ? [`From: ${from}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  return [...headers, "", text].join("\r\n");
}

/** Gmail answers with a JSON error blob; pull out the human sentence. */
async function gmailError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    return data.error?.message?.replace(/^Request had an error/i, "").trim() || `Gmail returned ${response.status}.`;
  } catch {
    return `Gmail returned ${response.status}.`;
  }
}

export type SendEmailInput = {
  to: string[];
  subject: string;
  body: string;
  from?: string;
  /** Vercel Connect identifier, e.g. "google/bots-google-access". */
  connectUid: string;
  userId: string;
  scopes: string[];
};

/**
 * Sends one plain-text email through the Gmail API.
 * Throws `MailError` for every failure; never rejects with anything else.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ messageId: string }> {
  const token = await getGmailAccessToken(input.connectUid, { type: "user", id: input.userId }, input.scopes);
  const raw = Buffer.from(mimeMessage(input.to.join(", "), input.subject, input.body, input.from), "utf8").toString("base64url");

  let response: Response;
  try {
    response = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new MailError("network", "Couldn't reach Gmail. Your draft is safe — press Send to try again.", 502);
  }

  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new MailError("auth", "Google rejected the send. Reconnect Google and make sure Gmail sending is allowed.", 502);
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new MailError("rate_limit", "Gmail is rate limiting this account. Wait a minute, then send again.", 429);
  }
  if (!response.ok) {
    const detail = await gmailError(response);
    throw new MailError("gmail", detail, 502);
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { messageId: data.id ?? "" };
}
