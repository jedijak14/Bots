"use client";

import useSWR from "swr";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { Icon, Spinner } from "./icons";
import { btnGhost, btnWhite, cx, inputCls } from "./ui";

type EmailStatus = {
  mode: "user" | "app" | "smtp" | null;
  address: string | null;
  own: boolean;
  host: string;
  replyTo: string;
  available: boolean;
  deploymentSmtp: boolean;
};

const fetcher = async (url: string): Promise<EmailStatus> => {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Couldn't read email settings.");
  return body;
};

const MODE_COPY: Record<NonNullable<EmailStatus["mode"]>, { title: string; body: string; tone: "good" | "warn" | "neutral" }> = {
  smtp: {
    title: "Sending as you",
    body: "Mail goes out through the mailbox saved below, or a mail server this deployment already runs. Bots can draft and send without asking you to sign in again.",
    tone: "good",
  },
  user: {
    title: "Sending through your Google connection",
    body: "Tokens are issued per account by Vercel Connect, so mail leaves from the Google account you connected below.",
    tone: "good",
  },
  app: {
    title: "Sending with this deployment's Google account",
    body: "This deployment carries its own Google credentials, so email works without connecting anything. You can still save a Gmail address below to send as yourself instead.",
    tone: "neutral",
  },
};

/**
 * Email setup. This is the one thing a person can fix themselves when a draft
 * fails to send, so it sits above the connector list and explains what will be
 * used before asking for anything.
 */
export function EmailPanel() {
  const app = useApp();
  const { data, mutate } = useSWR<EmailStatus>("/api/settings/email", fetcher, { revalidateOnFocus: true });
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const own = !!data?.own;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password, from }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Couldn't save that mailbox.");
      await mutate();
      setEditing(false);
      setPassword("");
      setAddress("");
      setFrom("");
      app.toast("Saved — bots can send from that address now.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save that mailbox.");
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    const ok = await app.confirm({
      title: "Stop sending as this address?",
      body: "Drafts stay put. New sends fall back to whatever this deployment has configured.",
      confirmLabel: "Forget it",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await fetch("/api/settings/email", { method: "DELETE" });
      await mutate();
      app.toast("Saved mailbox removed.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-[12.5px] text-neutral-500">
        <Spinner size={13} /> Checking how email is sent…
      </div>
    );
  }

  const mode = data.mode;
  const copy = mode ? MODE_COPY[mode] : null;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.05] text-neutral-300">
          <Icon name="mail" size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium text-white">Email</span>
            {copy && (
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                  copy.tone === "good" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.06] text-neutral-400",
                )}
              >
                {copy.title}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
            {copy?.body ?? "No sender is set up on this deployment yet, so Send will fail. Add a Gmail address and app password below, or connect Google."}
          </p>
          {own && data.address && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-neutral-400">
              <Icon name="check" size={12} className="text-emerald-400" />
              <span className="truncate">{data.address}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {own ? (
            <>
              <button type="button" onClick={() => void forget()} disabled={busy} className="rounded-full px-2.5 py-1 text-[11px] text-neutral-500 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50">
                Remove
              </button>
              <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-white/10 px-3 py-1.5 text-[11.5px] font-medium transition hover:border-white/20 hover:bg-white/[0.06]">
                Change
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-full border border-white/10 px-3 py-1.5 text-[11.5px] font-medium transition hover:border-white/20 hover:bg-white/[0.06]">
              Use my Gmail
            </button>
          )}
        </div>
      </div>

      {editing && (
        <form
          className="mt-3.5 space-y-2.5 border-t border-white/[0.06] pt-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-neutral-600">Gmail address</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="you@gmail.com"
              aria-label="Gmail address"
              autoComplete="email"
              className={cx(inputCls, "py-2 text-[13px]")}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-neutral-600">App password</span>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="16 characters from Google"
                aria-label="App password"
                autoComplete="off"
                spellCheck={false}
                className={cx(inputCls, "py-2 pr-16 font-mono text-[13px]")}
              />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[12px] text-neutral-400 transition hover:text-white">
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-neutral-600">Reply-to (optional)</span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="If different from the address above"
              aria-label="Reply-to address"
              className={cx(inputCls, "py-2 text-[13px]")}
            />
          </label>
          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-neutral-600">
            <Icon name="info" size={12} className="mt-[3px] shrink-0" />
            <span>
              Google account → Security → 2-Step Verification →{" "}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-neutral-400 underline decoration-white/20 underline-offset-2 transition hover:text-white">
                App passwords
              </a>
              . Stored encrypted, used only to send mail, never shown again.
            </span>
          </p>
          {error && <p role="alert" className="text-[12px] leading-relaxed text-[#ff9aa5]">{error}</p>}
          <div className="flex justify-end gap-2 pt-0.5">
            <button type="button" onClick={() => { setEditing(false); setError(""); }} className={cx(btnGhost, "px-3 py-1.5 text-[12px]")}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !address.trim() || password.replace(/\s+/g, "").length < 8} className={cx(btnWhite, "px-3.5 py-1.5 text-[12px]")}>
              {busy ? "Saving…" : "Save mailbox"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
