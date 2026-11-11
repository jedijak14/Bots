"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";

type Archive = { id: string; botId: string; title: string; messages: Array<{ role: string; content: string; createdAt: string }>; createdAt: string };
const fetcher = async (url: string): Promise<Archive[]> => { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error("Could not load history."); return response.json(); };

export function HistoryPanel({ botId }: { botId: string | null }) {
  const { data, error, isLoading, mutate } = useSWR(`/api/history${botId ? `?botId=${encodeURIComponent(botId)}` : ""}`, fetcher);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const filtered = useMemo(() => data?.filter((archive) => `${archive.title} ${archive.messages.map((message) => message.content).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query]);
  async function remove(archive: Archive) {
    if (!window.confirm(`Permanently delete “${archive.title}”? This cannot be undone.`)) return;
    setDeleting(archive.id);
    setActionError("");
    try {
      const response = await fetch(`/api/history/${archive.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete this archive.");
      await mutate(data?.filter((item) => item.id !== archive.id), { revalidate: false });
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not delete this archive."); }
    finally { setDeleting(null); }
  }
  return <div className="fade-up"><h3 className="text-[18px] font-semibold tracking-tight">Conversation history</h3><p className="mt-1 max-w-[520px] text-[13.5px] leading-relaxed text-neutral-400">Cleared conversations stay archived for private context with the same Bot. Browse them read-only or delete them permanently.</p>
    {data?.length ? <label className="mt-5 block"><span className="sr-only">Search conversation history</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-neutral-500 focus:border-white/25" placeholder="Search conversations" /></label> : null}
    {isLoading && <p className="mt-5 text-sm text-neutral-500">Loading history…</p>}{error && <p role="alert" className="mt-5 text-sm text-rose-300">{error.message}</p>}{actionError && <p role="alert" className="mt-3 text-xs text-rose-300">{actionError}</p>}
    {!isLoading && !error && !filtered.length && <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-neutral-500">{query ? "No conversations match your search." : "No archived conversations yet."}</div>}
    <div className="mt-5 flex flex-col gap-3">{filtered.map((archive) => <div key={archive.id} className="flex items-start gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><details className="min-w-0 flex-1"><summary className="cursor-pointer text-[13px] font-medium">{archive.title}<span className="ml-2 text-[11px] font-normal text-neutral-500">{new Date(archive.createdAt).toLocaleString()} · {archive.messages.length} messages</span></summary><div className="mt-3 flex max-h-[360px] flex-col gap-2 overflow-y-auto">{archive.messages.map((message, index) => <div key={`${archive.id}-${index}`} className="rounded-xl bg-black/20 p-3"><p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">{message.role}</p><p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-300">{message.content}</p></div>)}</div></details><button type="button" aria-label={`Permanently delete ${archive.title}`} disabled={deleting === archive.id} onClick={() => void remove(archive)} className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-neutral-500 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-50">{deleting === archive.id ? "Deleting…" : "Delete"}</button></div>)}</div>
  </div>;
}
