"use client";

import useSWR from "swr";
import { useState, type ReactNode } from "react";
import { splitRecipients } from "@/lib/email";
import { useApp } from "../AppProvider";
import { Icon, Spinner } from "../icons";
import { btnGhost, btnWhite, cx, Pill } from "../ui";

type Artifact = { id: string; title: string; kind: string; content: string; archived: boolean; createdAt: string };
type Email = { to?: string; subject?: string; body?: string };

/** True when every recipient parses; mirrors the server-side check in @/lib/email. */
const validRecipients = (value: string) => {
  const { ok, invalid } = splitRecipients(value);
  return ok.length > 0 && invalid.length === 0;
};

function parseEmail(content: string): Email {
  try {
    const parsed = JSON.parse(content) as Email;
    return { to: parsed.to ?? "", subject: parsed.subject ?? "", body: parsed.body ?? "" };
  } catch {
    return {};
  }
}

/**
 * The email a Bot drafted, shown inline in the conversation. Review it, fix a
 * line, then send — nothing leaves until Send is pressed.
 */
export function EmailDraftCard({ artifact: initial }: { artifact: Artifact }) {
  const app = useApp();
  const [to, setTo] = useState(() => parseEmail(initial.content).to ?? "");
  const [subject, setSubject] = useState(() => parseEmail(initial.content).subject ?? "");
  const [body, setBody] = useState(() => parseEmail(initial.content).body ?? "");
  /** Local override so a successful send flips the card without a refetch. */
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const status = statusOverride ?? initial.kind;
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(initial.content);
  /** Which mailbox this will leave from, so "Send" is never a guess. */
  const { data: mail } = useSWR<{ mode: string | null; address: string | null }>(
    "/api/settings/email",
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    { revalidateOnFocus: false },
  );
  const sender = mail?.address ?? null;

  const dirty = JSON.stringify({ to, subject, body }) !== JSON.stringify(parseEmail(savedSnapshot));

  async function save() {
    if (!dirty || status !== "email_draft") return;
    setSaving(true);
    try {
      const response = await fetch(`/api/artifacts/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify({ to: to.trim(), subject: subject.trim(), body }) }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "Couldn't save your changes.");
      }
      setSavedSnapshot(JSON.stringify({ to: to.trim(), subject: subject.trim(), body }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save your changes.");
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    const { ok: list } = splitRecipients(to);
    if (!list.length) return setError("Add at least one recipient.");
    if (!validRecipients(to)) return setError("Check the To field — every address needs to be a valid email.");
    if (!subject.trim()) return setError("Add a subject.");
    if (!body.trim()) return setError("The email is empty.");

    const ok = await app.confirm({
      title: "Send this email?",
      body: `To ${list.join(", ")}${subject.trim() ? ` · “${subject.trim()}”` : ""}`,
      confirmLabel: "Send",
    });
    if (!ok) return;

    // Save the edited version first so the message that goes out is the one on screen.
    if (dirty) {
      await fetch(`/api/artifacts/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify({ to: list.join(", "), subject: subject.trim(), body }) }),
      }).catch(() => null);
    }

    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/artifacts/${initial.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retry: status === "email_sending" }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; sent?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Gmail couldn't send this message.");
      setStatusOverride("sent_email");
      app.toast("Email sent.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Gmail couldn't send this message.";
      setError(message);
      setStatusOverride("email_draft");
    } finally {
      setSending(false);
    }
  }

  const sent = status === "sent_email";
  const locked = status === "email_sending" && !sending;

  return (
    <div className="w-full max-w-[600px] overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#101013] shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <span className="grid size-7 place-items-center rounded-lg bg-white/[0.06] text-neutral-300">
          <Icon name="mail" size={15} />
        </span>
        <span className="text-[12.5px] font-medium text-neutral-200">Email draft</span>
        <div className="flex-1" />
        {sent ? <Pill tone="good">Sent</Pill> : locked ? <Pill tone="warn">Sending…</Pill> : <Pill>Saved locally</Pill>}
        {sender && !sent && (
          <span className="ml-1 max-w-[45%] truncate text-[11.5px] text-neutral-600" title={`Sends from ${sender}`}>
            from {sender}
          </span>
        )}
      </div>

      <div className="space-y-2.5 p-4">
        <Field label="To">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={() => void save()}
            disabled={sent || locked}
            placeholder="name@example.com"
            aria-label="Recipient"
            className="w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-neutral-600 disabled:opacity-60"
          />
        </Field>
        <Field label="Subject">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => void save()}
            disabled={sent || locked}
            placeholder="Subject"
            aria-label="Subject"
            className="w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-neutral-600 disabled:opacity-60"
          />
        </Field>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => void save()}
          disabled={sent || locked}
          rows={6}
          aria-label="Email body"
          placeholder="Write your message…"
          className="w-full resize-y rounded-xl border border-white/[0.06] bg-black/20 p-3 text-[13.5px] leading-relaxed text-neutral-200 outline-none transition placeholder:text-neutral-600 focus:border-white/20 disabled:opacity-60"
        />
      </div>

      <div className="flex items-start gap-3 border-t border-white/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          {error ? (
            <p role="alert" className="line-clamp-3 text-[12px] leading-relaxed text-[#ff8b98]">
              {error}
            </p>
          ) : saving ? (
            <p className="text-[12px] text-neutral-500">Saving…</p>
          ) : sent ? (
            <p className="text-[12px] text-emerald-300">Delivered to {splitRecipients(to).ok.join(", ")}.</p>
          ) : (
            <p className="truncate text-[12px] text-neutral-600">
              {locked
                ? "A previous send didn't finish. Retry to send it now."
                : dirty
                  ? "Unsaved edits — they're kept when you send."
                  : "Only you can see this. Nothing sends until you press Send."}
            </p>
          )}
        </div>
        {status !== "sent_email" && (
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className={cx(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition active:scale-[0.97] disabled:opacity-60",
              sending ? "bg-white/10 text-white" : "bg-white text-black hover:bg-neutral-200",
            )}
          >
            {sending ? <Spinner size={13} /> : <Icon name="arrow-up" size={13} strokeWidth={2.4} />}
            <span>{sending ? "Sending…" : locked ? "Retry" : "Send"}</span>
          </button>
        )}
        {error && (
          <button onClick={() => app.openSettings("connections")} className={cx(btnGhost, "shrink-0 px-3 py-1.5 text-[12px]")}>
            Connections
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 transition focus-within:border-white/20">
      <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wide text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

/** Anything else a Bot saved while answering: a story, a page, a document. */
export function ArtifactCard({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  const kind = artifact.kind.replaceAll("_", " ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full max-w-[600px] items-center gap-3 rounded-[18px] border border-white/[0.08] bg-[#101013] p-3.5 text-left transition hover:border-white/[0.16] hover:bg-[#141417]"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-neutral-300 transition group-hover:bg-white/[0.1]">
        <Icon name="file" size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-white">{artifact.title}</span>
        <span className="block truncate text-[11.5px] capitalize text-neutral-500">{kind} · saved to Artifacts</span>
      </span>
      <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11.5px] font-medium text-neutral-300 transition group-hover:bg-white/[0.12] group-hover:text-white">Open</span>
    </button>
  );
}
