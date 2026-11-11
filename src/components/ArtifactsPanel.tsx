"use client";

import useSWR from "swr";
import { useState } from "react";
import { Icon } from "./icons";
import { btnWhite, cx } from "./ui";

type Artifact = { id: string; title: string; kind: string; content: string; archived: boolean; createdAt: string };
const fetcher = async (url: string): Promise<Artifact[]> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load Artifacts.");
  return response.json();
};

function EmailDraft({ artifact, onSent }: { artifact: Artifact; onSent: () => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  let email: { to?: string; subject?: string; body?: string } = {};
  try { email = JSON.parse(artifact.content); } catch { /* malformed drafts stay review-only */ }
  async function send() {
    if (!window.confirm(`Send this email to ${email.to ?? "the recipient"}?`)) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/artifacts/${artifact.id}/send`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not send email.");
      onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send email.");
      setSending(false);
    }
  }
  return <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 p-3 text-[12.5px]">
    <div><span className="text-neutral-500">To </span>{email.to}</div><div className="mt-1"><span className="text-neutral-500">Subject </span>{email.subject}</div>
    <p className="mt-3 whitespace-pre-wrap leading-relaxed text-neutral-300">{email.body}</p>
    {artifact.kind === "email_sending" && <p className="mt-3 text-[11px] text-amber-200">Sending or awaiting confirmation from Gmail. This draft is locked to prevent duplicate sends.</p>}
    {artifact.kind === "email_draft" && !artifact.archived && <div className="mt-3 flex items-center gap-3"><button type="button" onClick={() => void send()} disabled={sending} className={cx(btnWhite, "px-3 py-1.5 text-xs")}>{sending ? "Sending…" : "Send email"}</button><span className="text-[11px] text-neutral-500">Review before sending</span></div>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
  </div>;
}

function artifactBlob(artifact: Artifact) {
  const type = artifact.kind === "html" || artifact.kind === "website" ? "text/html" : artifact.kind.startsWith("email_") || artifact.kind === "sent_email" ? "application/json" : "text/plain";
  return new Blob([artifact.content], { type: `${type};charset=utf-8` });
}

function artifactFileName(artifact: Artifact) {
  const base = artifact.title.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "artifact";
  const extension = artifact.kind === "html" || artifact.kind === "website" ? ".html" : artifact.kind.startsWith("email_") || artifact.kind === "sent_email" ? ".json" : ".txt";
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

export function ArtifactsPanel() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [actionError, setActionError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`/api/artifacts${includeArchived ? "?includeArchived=true" : ""}`, fetcher, { revalidateOnFocus: true });
  function openArtifact(artifact: Artifact) {
    const url = URL.createObjectURL(artifactBlob(artifact));
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  function downloadArtifact(artifact: Artifact) {
    const url = URL.createObjectURL(artifactBlob(artifact));
    const link = document.createElement("a");
    link.href = url;
    link.download = artifactFileName(artifact);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function setArchived(artifact: Artifact, archived: boolean) {
    setActionError("");
    const response = await fetch(`/api/artifacts/${artifact.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived }) });
    const result = await response.json();
    if (!response.ok) { setActionError(result.error ?? "Could not update this artifact."); return; }
    await mutate();
  }
  async function remove(artifact: Artifact) {
    if (!window.confirm(`Permanently delete “${artifact.title}”? This cannot be undone.`)) return;
    setActionError("");
    const response = await fetch(`/api/artifacts/${artifact.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) { setActionError(result.error ?? "Could not delete this artifact."); return; }
    await mutate();
  }
  return <div className="fade-up"><h3 className="text-[18px] font-semibold tracking-tight">Artifacts</h3><p className="mt-1 max-w-[520px] text-[13.5px] leading-relaxed text-neutral-400">Stories, documents, websites, and reviewed email drafts your Bots save for you.</p>
    <label className="mt-4 flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Show archived artifacts</label>
    {isLoading && <p className="mt-5 text-sm text-neutral-500">Loading artifacts…</p>}{error && <p role="alert" className="mt-5 text-sm text-rose-300">{error.message}</p>}{actionError && <p role="alert" className="mt-3 text-xs text-rose-300">{actionError}</p>}
    {!isLoading && !error && !data?.length && <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-neutral-500">{includeArchived ? "No artifacts in this view." : "Your saved work will appear here."}</div>}
    <div className="mt-5 flex flex-col gap-3">{data?.map((artifact) => <article key={artifact.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="flex items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06]"><Icon name="file" size={16} /></div><div className="min-w-0 flex-1"><h4 className="truncate text-[13.5px] font-medium">{artifact.title}</h4><p className="mt-0.5 text-[11px] text-neutral-500">{artifact.kind.replaceAll("_", " ")} · {new Date(artifact.createdAt).toLocaleDateString()}{artifact.archived ? " · archived" : ""}</p></div><button type="button" onClick={() => openArtifact(artifact)} className="rounded-full px-2 py-1 text-[11px] text-neutral-500 hover:bg-white/[0.05] hover:text-white">Open</button><button type="button" onClick={() => downloadArtifact(artifact)} className="rounded-full px-2 py-1 text-[11px] text-neutral-500 hover:bg-white/[0.05] hover:text-white">Download</button><button type="button" onClick={() => void setArchived(artifact, !artifact.archived)} className="rounded-full px-2 py-1 text-[11px] text-neutral-500 hover:bg-white/[0.05] hover:text-white">{artifact.archived ? "Restore" : "Archive"}</button><button type="button" aria-label={`Permanently delete ${artifact.title}`} onClick={() => void remove(artifact)} className="rounded-full px-2 py-1 text-[11px] text-neutral-500 hover:bg-rose-400/10 hover:text-rose-300">Delete</button></div>
      {artifact.kind === "email_draft" || artifact.kind === "sent_email" || artifact.kind === "email_sending" ? <EmailDraft artifact={artifact} onSent={() => void mutate()} /> : <details className="mt-3"><summary className="cursor-pointer text-[12px] text-neutral-400 hover:text-white">View artifact</summary>{artifact.kind === "html" || artifact.kind === "website" ? <iframe title={artifact.title} sandbox="" srcDoc={artifact.content} className="mt-3 h-[360px] w-full rounded-xl bg-white" /> : <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-[12px] leading-relaxed text-neutral-300">{artifact.content}</pre>}</details>}
    </article>)}</div>
  </div>;
}
