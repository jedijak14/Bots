import "server-only";

import nodemailer from "nodemailer";
import { ConnectorInstallationRequiredError, getToken, NoValidTokenError, UserAuthorizationRequiredError } from "@vercel/connect";
import { eq } from "drizzle-orm";
import { db, ensureEmailColumns } from "@/db";
import { userSettings } from "@/db/schema";
import { decrypt } from "@/lib/crypto";

/**
 * Why a send failed. The route maps these onto HTTP statuses and the UI onto advice.
 *
 * `not_connected`  — nothing to send with yet; the person can fix this in Settings.
 * `connector_missing` — Connect is not installed and there is no alternative here.
 * `token_failed`/`auth` — we had credentials, Google would not accept them.
 * `rate_limit`/`network`/`gmail` — transient, the draft is safe.
 */
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

export type MailMode = "user" | "app" | "smtp";

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

/**
 * Any SMTP server — Resend, Postmark, Fastmail, a company mail relay. This is
 * what makes sending work on a deployment with no Google setup at all.
 */
function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !Number.isFinite(port)) return null;
  const from = process.env.SMTP_FROM ?? user;
  return { host, port, secure: port === 465, user, pass, from };
}

/** True when email can be sent without a per-user Google connection. */
export function hasAppGoogleCredentials(): boolean {
  return appGoogleConfig() !== null;
}

export function hasSmtpCredentials(): boolean {
  return smtpConfig() !== null;
}

/**
 * A Gmail address and app password the person saved themselves. Tried before the
 * deployment-wide options so their own account is used when they set one up.
 */
async function userSmtpConfig(userId: string): Promise<SmtpConfig | null> {
  await ensureEmailColumns();
  const [row] = await db
    .select({ host: userSettings.smtpHost, user: userSettings.smtpUser, pass: userSettings.smtpPassEnc, from: userSettings.smtpFrom })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!row?.user || !row?.pass) return null;
  const pass = decrypt(row.pass);
  if (!pass) return null;
  // A relay set in the environment wins over the address's own domain, which is how
  // a self-hosted mail server or a local test sink gets used without a code change.
  const host = process.env.SMTP_HOST || row.host || (row.user.endsWith("@gmail.com") || row.user.endsWith("@googlemail.com") ? "smtp.gmail.com" : "");
  if (!host) return null;
  // Gmail wants 465/SSL. Anything else follows SMTP_PORT (587 by default), and a
  // host on this machine is plain text on whatever port it listens on.
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(host);
  const port = local ? Number(process.env.SMTP_PORT ?? 2525) : Number(process.env.SMTP_PORT ?? 587);
  return { host, port, secure: !local && port === 465, user: row.user, pass, from: row.from || row.user };
}

export type MailContext = {
  /** Vercel Connect identifier, e.g. "google/bots-google-access". */
  connectUid: string;
  userId: string;
  scopes: string[];
  /** Per-user Google connection first, then credentials for the whole deployment. */
  allowConnect?: boolean;
};

async function appGoogleAccessToken(): Promise<string> {
  const config = appGoogleConfig();
  if (!config) throw new MailError("not_connected", "Connect your Google account to send email.", 409);
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
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
  } catch {
    throw new MailError("network", "Couldn't reach Google to refresh the mail token. Try again in a moment.", 502);
  }
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
export async function getGmailAccessToken(context: MailContext): Promise<string> {
  const { connectUid, userId, scopes } = context;
  const subject = { type: "user" as const, id: userId };
  if (context.allowConnect !== false) {
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
        // The person has not connected Google here — fall through to the app's own
        // credentials instead of stopping.
      } else {
        const detail = error instanceof Error ? error.message : "";
        // Connect without OIDC (local dev, or a deployment that isn't linked) is the
        // one failure people actually hit, so say what to do about it — after the
        // fallbacks have had their turn.
        if (!appGoogleConfig() && /oidc-token|vc link|project root/i.test(detail)) {
          throw new MailError(
            "token_failed",
            "Google sign-in only works in a linked Vercel deployment. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN to send from here.",
            502,
          );
        }
      }
    }
  }
  if (appGoogleConfig()) return appGoogleAccessToken();
  throw new MailError("not_connected", "Connect your Google account in Settings → Connections to send email.", 409);
}

/** Everything the UI and the send route need to know, without sending anything. */
export async function mailStatus(userId: string): Promise<{ mode: MailMode; address: string | null } | null> {
  const user = await userSmtpConfig(userId).catch(() => null);
  if (user) return { mode: "smtp", address: user.from };
  if (appGoogleConfig()) return { mode: "app", address: process.env.SMTP_FROM ?? null };
  const smtp = smtpConfig();
  if (smtp) return { mode: "smtp", address: smtp.from };
  return null;
}

/** Re-exported for callers that only need to know whether a send is possible at all. */
export function hasMailTransport(): boolean {
  return hasAppGoogleCredentials() || hasSmtpCredentials();
}

/**
 * Wraps a plain-text body in the minimal MIME message Gmail accepts.
 * Headers are stripped of line breaks so a subject can't smuggle a Bcc.
 */
export function mimeMessage(to: string, subject: string, body: string, from?: string): string {
  const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const text = body.replace(/\r?\n/g, "\r\n");
  const headers = [
    `To: ${clean(to)}`,
    `Subject: ${clean(subject)}`,
    ...(from ? [`From: ${clean(from)}`] : []),
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

async function sendViaGmail(context: MailContext, to: string[], subject: string, body: string): Promise<{ messageId: string }> {
  const token = await getGmailAccessToken(context);
  const raw = Buffer.from(mimeMessage(to.join(", "), subject, body), "utf8").toString("base64url");

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

type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string; from: string };

async function sendViaSmtp(config: SmtpConfig, to: string[], subject: string, body: string): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await transporter.sendMail({ from: config.from, to: to.join(", "), subject, text: body });
    return { messageId: info.messageId ?? "" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|socket hang up|timeout/i.test(detail)) {
      throw new MailError("network", "Couldn't reach the mail server. Your draft is safe — press Send to try again.", 502);
    }
    if (/auth|535|534|credentials/i.test(detail)) {
      throw new MailError("auth", `The mail server rejected the sign-in.${detail ? ` ${detail.slice(0, 140)}` : ""}`, 502);
    }
    if (/rate|limit|429|421/i.test(detail)) {
      throw new MailError("rate_limit", "The mail server is rate limiting sends. Wait a minute, then try again.", 429);
    }
    throw new MailError("gmail", detail ? `The mail server refused the message. ${detail.slice(0, 140)}` : "The mail server refused the message.", 502);
  } finally {
    transporter.close();
  }
}

export type SendEmailInput = {
  to: string[];
  subject: string;
  body: string;
  /** Vercel Connect identifier, e.g. "google/bots-google-access". */
  connectUid: string;
  userId: string;
  scopes: string[];
};

/**
 * Sends one plain-text email, trying transports in the order that respects the
 * person's own setup first: their Gmail app password, a per-user Connect token,
 * then the deployment's Google client, then the deployment's SMTP account.
 * Throws `MailError` for every failure; never rejects with anything else.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ messageId: string }> {
  const { to, subject, body, userId } = input;

  const userSmtp = await userSmtpConfig(userId).catch(() => null);
  if (userSmtp) return sendViaSmtp(userSmtp, to, subject, body);

  const context: MailContext = { connectUid: input.connectUid, userId, scopes: input.scopes };
  let connectUnavailable = false;
  try {
    return await sendViaGmail(context, to, subject, body);
  } catch (error) {
    // Only fall through when Connect tells us there is nothing to use here. A real
    // Gmail error (message refused, quota) must surface as-is.
    const fallback = error instanceof MailError && (error.code === "not_connected" || error.code === "connector_missing" || error.code === "token_failed");
    if (!fallback) throw error;
    connectUnavailable = true;
  }

  const smtp = smtpConfig();
  if (smtp) return sendViaSmtp(smtp, to, subject, body);

  if (connectUnavailable) {
    throw new MailError(
      "not_connected",
      "Email isn't set up on this deployment yet. Save a Gmail address in Settings → Connections, or set SMTP_HOST, SMTP_USER and SMTP_PASS for the whole deployment.",
      409,
    );
  }
  throw new MailError("not_connected", "Connect your Google account in Settings → Connections to send email.", 409);
}
