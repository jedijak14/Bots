import { UserAuthorizationRequiredError } from "@vercel/connect";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { getConnectionToken } from "@/lib/connectors";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const [draft] = await db.select().from(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id), eq(artifacts.kind, "email_draft"))).limit(1);
    if (!draft) return Response.json({ error: "Email draft not found or already being sent." }, { status: 404 });
    const content = JSON.parse(draft.content) as { to?: string; subject?: string; body?: string };
    const to = String(content.to ?? "").trim();
    const subject = String(content.subject ?? "").trim();
    const body = String(content.body ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || /[\r\n]/.test(subject) || !body) return Response.json({ error: "The email draft is incomplete or invalid." }, { status: 400 });
    const [claim] = await db.update(artifacts).set({ kind: "email_sending" }).where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id), eq(artifacts.kind, "email_draft"))).returning({ id: artifacts.id });
    if (!claim) return Response.json({ error: "This email has already been sent or is being processed." }, { status: 409 });
    const token = await getConnectionToken("google", user.id);
    const raw = [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");
    const encoded = Buffer.from(raw, "utf8").toString("base64url");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await db.update(artifacts).set({ kind: "email_draft" }).where(and(eq(artifacts.id, draft.id), eq(artifacts.userId, user.id), eq(artifacts.kind, "email_sending")));
      return Response.json({ error: response.status === 401 || response.status === 403 ? "Reconnect Google or review the Gmail permissions in Settings > Connections." : "Gmail could not confirm this message. It will remain marked as sending to prevent an accidental duplicate." }, { status: response.status === 401 || response.status === 403 ? 401 : 502 });
    }
    await db.update(artifacts).set({ kind: "sent_email" }).where(and(eq(artifacts.id, draft.id), eq(artifacts.userId, user.id), eq(artifacts.kind, "email_sending")));
    return Response.json({ sent: true });
  } catch (error) {
    if (error instanceof UserAuthorizationRequiredError) {
      const { id } = await ctx.params;
      await db.update(artifacts).set({ kind: "email_draft" }).where(and(eq(artifacts.id, id), eq(artifacts.userId, (await requireUser()).id), eq(artifacts.kind, "email_sending"))).catch(() => undefined);
      return Response.json({ error: "Connect your Google account in Settings > Connections first." }, { status: 401 });
    }
    return handleError(error);
  }
}
