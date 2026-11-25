import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { CONNECTORS } from "@/lib/connectors";
import { splitRecipients } from "@/lib/email";
import { MailError, sendEmail } from "@/lib/mail";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

type EmailContent = { to?: string; subject?: string; body?: string };

/**
 * Sends an email draft.
 *
 * The draft is claimed (`email_draft` → `email_sending`) before anything leaves
 * the server so two tabs can't send the same message, and released again if the
 * send fails, so pressing Send once more is always safe.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let claimedId: string | null = null;
  let userId = "";
  const release = async () => {
    if (!claimedId) return;
    await db
      .update(artifacts)
      .set({ kind: "email_draft" })
      .where(and(eq(artifacts.id, claimedId), eq(artifacts.userId, userId), eq(artifacts.kind, "email_sending")))
      .catch(() => undefined);
  };

  try {
    const user = await requireUser();
    userId = user.id;
    const { id } = await ctx.params;
    // A malformed id is a 404, not a crash. Postgres rejects a non-UUID string
    // for a uuid column with 22P02, which came back as a 500 from every route
    // that took an id — including the artifact fetches the studio players make
    // for every clip on a timeline.
    if (!isUuid(id)) return Response.json({ error: "Artifact not found." }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { retry?: boolean };

    const [draft] = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id)))
      .limit(1);
    if (!draft) return Response.json({ error: "That draft could not be found." }, { status: 404 });
    if (draft.kind === "sent_email") return Response.json({ error: "This email was already sent." }, { status: 409 });
    if (!draft.kind.startsWith("email_")) return Response.json({ error: "This artifact is not an email draft." }, { status: 409 });
    if (draft.kind === "email_sending" && body.retry !== true) {
      return Response.json(
        { error: "This email is already being sent. If that got stuck, press Send again to retry.", code: "in_flight" },
        { status: 409 },
      );
    }

    let content: EmailContent = {};
    try {
      content = JSON.parse(draft.content) as EmailContent;
    } catch {
      return Response.json({ error: "This draft is malformed. Ask the bot to write it again." }, { status: 400 });
    }

    const { ok: to, invalid } = splitRecipients(String(content.to ?? ""));
    const subject = String(content.subject ?? "").trim();
    const bodyText = String(content.body ?? "");
    if (!to.length && !invalid.length) return Response.json({ error: "Add at least one recipient." }, { status: 400 });
    if (invalid.length) {
      return Response.json(
        {
          error: `${invalid.join(", ")} ${invalid.length === 1 ? "doesn't" : "don't"} look like a valid email address.`,
          code: "invalid_recipient",
        },
        { status: 400 },
      );
    }
    if (!subject) return Response.json({ error: "Add a subject before sending." }, { status: 400 });
    if (/[\r\n]/.test(subject)) return Response.json({ error: "The subject can't contain line breaks." }, { status: 400 });
    if (!bodyText.trim()) return Response.json({ error: "The email is empty." }, { status: 400 });

    const [claim] = await db
      .update(artifacts)
      .set({ kind: "email_sending" })
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id), inArray(artifacts.kind, ["email_draft", "email_sending"])))
      .returning({ id: artifacts.id });
    if (!claim) return Response.json({ error: "This email is already being sent." }, { status: 409 });
    claimedId = claim.id;

    let messageId: string;
    try {
      messageId = (
        await sendEmail({
          to,
          subject,
          body: bodyText,
          connectUid: CONNECTORS.google.uid,
          userId: user.id,
          scopes: [...CONNECTORS.google.scopes],
        })
      ).messageId;
    } catch (error) {
      await release();
      claimedId = null;
      if (error instanceof MailError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status, ...NO_STORE });
      }
      throw error;
    }

    await db
      .update(artifacts)
      .set({ kind: "sent_email" })
      .where(and(eq(artifacts.id, claim.id), eq(artifacts.userId, user.id), eq(artifacts.kind, "email_sending")));
    claimedId = null;

    return Response.json({ sent: true, messageId }, NO_STORE);
  } catch (error) {
    await release();
    return handleError(error);
  }
}
