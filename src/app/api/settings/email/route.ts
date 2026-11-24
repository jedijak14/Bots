import { eq } from "drizzle-orm";
import { db, ensureEmailColumns } from "@/db";
import { userSettings } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { hasMailTransport, hasSmtpCredentials, mailStatus } from "@/lib/mail";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/**
 * How this account sends mail.
 *
 * `mode` is what will actually be used: a Gmail app password saved here, a Google
 * connection, the deployment's Google client, or the deployment's SMTP account.
 * `canSaveOwn` says whether the person has something they can set up themselves.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureEmailColumns();
    const settings = await getSettings(user.id);
    const transport = await mailStatus(user.id);
    const own = !!settings.smtpUser;
    return Response.json(
      {
        mode: own ? "smtp" : (transport?.mode ?? null),
        address: own ? (settings.smtpFrom || settings.smtpUser || null) : (transport?.address ?? null),
        own,
        host: settings.smtpHost ?? "",
        replyTo: settings.smtpFrom ?? "",
        available: hasMailTransport() || own,
        deploymentSmtp: hasSmtpCredentials(),
      },
      NO_STORE,
    );
  } catch (error) {
    return handleError(error);
  }
}

/** Saves a Gmail address + app password for this account only. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureEmailColumns();
    await getSettings(user.id);
    const body = (await req.json().catch(() => ({}))) as { address?: string; password?: string; from?: string };
    const address = String(body.address ?? "").trim().toLowerCase();
    const password = String(body.password ?? "").replace(/\s+/g, "");
    const from = String(body.from ?? "").trim();

    if (!EMAIL.test(address)) return Response.json({ error: "That doesn't look like an email address." }, { status: 400 });
    if (password.length < 8) {
      return Response.json({ error: "Paste the 16-character app password Google gave you (spaces are fine)." }, { status: 400 });
    }
    if (from && !EMAIL.test(from)) return Response.json({ error: "The reply-to address is not valid." }, { status: 400 });

    const domain = address.split("@")[1];
    const host = domain === "gmail.com" || domain === "googlemail.com" ? "smtp.gmail.com" : `smtp.${domain}`;

    await db
      .update(userSettings)
      .set({
        smtpUser: address,
        smtpHost: host,
        smtpPassEnc: encrypt(password),
        smtpFrom: from || null,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, user.id));

    return Response.json(await mailStatus(user.id), NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}

/** Forgets the saved address. Google stays connected if it was connected. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await ensureEmailColumns();
    await db
      .update(userSettings)
      .set({ smtpUser: null, smtpHost: null, smtpPassEnc: null, smtpFrom: null, updatedAt: new Date() })
      .where(eq(userSettings.userId, user.id));
    return Response.json({ mode: null, available: hasMailTransport() }, NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}
