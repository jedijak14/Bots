import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailDrafts } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { accessToken, googleConfig } from "@/lib/connections/google";
import { mimeMessage, validateDraft } from "@/lib/connections/mail-format";

export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const cfg = googleConfig();
    if (!cfg || req.headers.get("origin") !== cfg.origin) throw new HttpError(403, "Invalid request origin or Google configuration.");
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Invalid draft.");
    const { action } = await req.json().catch(() => ({}));
    if (action !== "send" && action !== "cancel") throw new HttpError(400, "Choose send or cancel.");
    // One atomic transition means two tabs cannot send the same draft twice.
    const [draft] = await db.update(emailDrafts).set({ status: action === "send" ? "sending" : "cancelled" }).where(and(eq(emailDrafts.id, id), eq(emailDrafts.userId, user.id), eq(emailDrafts.status, "pending"))).returning();
    if (!draft) throw new HttpError(409, "This draft is no longer awaiting approval.");
    if (action === "cancel") return Response.json({ status: "cancelled" });
    try {
      const error = validateDraft(draft.recipient, draft.subject, draft.body);
      if (error) throw new Error(error);
      const token = await accessToken(user.id, "gmail");
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: mimeMessage(draft.recipient, draft.subject, draft.body) }), cache: "no-store",
      });
      if (!res.ok) throw new Error("Gmail did not confirm delivery.");
      await db.update(emailDrafts).set({ status: "sent" }).where(eq(emailDrafts.id, id));
      return Response.json({ status: "sent" });
    } catch {
      // Do not automatically retry: a timeout could mean Google already sent it.
      await db.update(emailDrafts).set({ status: "unknown" }).where(eq(emailDrafts.id, id));
      return Response.json({ error: "Send could not be confirmed. Check Gmail's Sent folder before trying again.", status: "unknown" }, { status: 502 });
    }
  } catch (e) { return handleError(e); }
}
