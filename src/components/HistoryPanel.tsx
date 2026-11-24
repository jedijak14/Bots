"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import { Icon, Spinner } from "./icons";
import { cx, inputCls } from "./ui";

type Message = { role: string; content: string; createdAt: string };
type Archive = { id: string; botId: string; title: string; messages: Message[]; createdAt: string };

const fetcher = async (url: string): Promise<Archive[]> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load history.");
  return response.json();
};

const roleLabel = (role: string) => (role === "user" ? "You" : role === "assistant" ? "Bot" : role);

export function HistoryPanel({ botId }: { botId: string | null }) {
  const app = useApp();
  const { data, error, isLoading, mutate } = useSWR(`/api/history${botId ? `?botId=${encodeURIComponent(botId)}` : ""}`, fetcher, {
    shouldRetryOnError: false,
  });
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const filtered = useMemo(
    () =>
      data?.filter((archive) =>
        `${archive.title} ${archive.messages.map((message) => message.content).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()),
      ) ?? [],
    [data, query],
  );

  async function remove(archive: Archive) {
    const ok = await app.confirm({
      title: "Delete this conversation?",
      body: `“${archive.title || "Untitled conversation"}” will be removed from your history for good.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeleting(archive.id);
    setActionError("");
    try {
      const response = await fetch(`/api/history/${archive.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete this archive.");
      await mutate(data?.filter((item) => item.id !== archive.id), { revalidate: false });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete this archive.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="fade-up">
      <h3 className="text-[18px] font-semibold tracking-tight text-white">Conversation history</h3>
      <p className="mt-1 max-w-[540px] text-[13.5px] leading-relaxed text-neutral-400">
        Cleared conversations stay archived so the same Bot can pick them up again. Read them here, or delete them for good.
      </p>

      {data?.length ? (
        <label className="mt-5 block">
          <span className="sr-only">Search conversation history</span>
          <span className="relative block">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={cx(inputCls, "pl-9")}
              placeholder="Search conversations"
            />
          </span>
        </label>
      ) : null}

      {isLoading && (
        <p className="mt-5 flex items-center gap-2 text-[13px] text-neutral-500">
          <Spinner size={13} /> Loading history…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-5 text-[13px] text-[#ff9aa5]">
          {error.message}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-3 text-[12px] text-[#ff9aa5]">
          {actionError}
        </p>
      )}

      {!isLoading && !error && !filtered.length && (
        <div className="mt-5 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-full bg-white/[0.04] text-neutral-500">
            <Icon name="chat" size={17} />
          </span>
          <p className="mt-3 text-[13px] text-neutral-400">{query ? "No conversations match your search." : "No archived conversations yet."}</p>
          {!query && <p className="mt-1 text-[11.5px] text-neutral-600">Clear a chat and it will show up here.</p>}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {filtered.map((archive) => (
          <details key={archive.id} className="group rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition hover:border-white/[0.11]">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <Icon name="chevron" size={14} className="shrink-0 -rotate-90 text-neutral-600 transition group-open:rotate-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white">{archive.title || "Untitled conversation"}</span>
                <span className="block text-[11px] text-neutral-600">
                  {new Date(archive.createdAt).toLocaleString()} · {archive.messages.length} {archive.messages.length === 1 ? "message" : "messages"}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Permanently delete ${archive.title || "this conversation"}`}
                disabled={deleting === archive.id}
                onClick={(event) => {
                  event.preventDefault();
                  void remove(archive);
                }}
                className="rounded-full px-2 py-1 text-[11px] text-neutral-600 transition hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-50"
              >
                {deleting === archive.id ? "Deleting…" : "Delete"}
              </button>
            </summary>

            <div className="mt-3 flex max-h-[360px] flex-col gap-1.5 overflow-y-auto border-t border-white/[0.06] pt-3">
              {archive.messages.map((message, index) => (
                <div key={`${archive.id}-${index}`} className="rounded-xl bg-black/25 px-3 py-2">
                  <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-neutral-600">{roleLabel(message.role)}</p>
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-300">{message.content}</p>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
