"use client";

import { useEffect, useState } from "react";

type Draft = { id: string; recipient: string; subject: string; body: string };

/** Shows exactly what will be sent. No AI tool can perform the approval. */
export function EmailApprovals({ botId, busy }: { botId: string; busy: boolean }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    fetch(`/api/email-drafts?botId=${encodeURIComponent(botId)}`, { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(); const j = await r.json(); setDrafts(j.drafts ?? []); })
      .catch(() => { if (!controller.signal.aborted) setNotice("Could not load email approvals."); });
    return () => controller.abort();
  }, [botId, busy]);

  async function decide(id: string, action: "send" | "cancel") {
    setWorking(id); setNotice("");
    try {
      const r = await fetch(`/api/email-drafts/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!r.ok) {
        if (j.status === "unknown" || r.status === 409) setDrafts((items) => items.filter((item) => item.id !== id));
        throw new Error(j.error || "Could not process that draft.");
      }
      setDrafts((items) => items.filter((item) => item.id !== id));
      setNotice(action === "send" ? "Gmail confirmed the email was sent." : "Email draft cancelled.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not process that draft."); }
    finally { setWorking(null); }
  }
  if (!drafts.length && !notice) return null;
  return <div className="mx-6 mb-3 space-y-2" aria-live="polite">
    {drafts.map((d) => <section key={d.id} className="rounded-2xl border border-blue-400/30 bg-[#151c28] p-4 text-sm">
      <h3 className="font-semibold">Review email before sending</h3>
      <p className="mt-2 break-all"><b>To:</b> {d.recipient}</p>
      <p className="mt-1 break-words"><b>Subject:</b> {d.subject}</p>
      <p className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/25 p-3">{d.body}</p>
      <div className="mt-3 flex gap-2"><button disabled={!!working} onClick={() => void decide(d.id, "send")} className="rounded-full bg-white px-4 py-2 font-semibold text-black disabled:opacity-50">Approve &amp; send</button><button disabled={!!working} onClick={() => void decide(d.id, "cancel")} className="rounded-full px-4 py-2 hover:bg-white/10 disabled:opacity-50">Cancel draft</button></div>
    </section>)}
    {notice && <p className="text-sm text-neutral-300" role="status">{notice}</p>}
  </div>;
}
