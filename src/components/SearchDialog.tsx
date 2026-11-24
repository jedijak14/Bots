"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { Icon, Spinner } from "./icons";
import { Kbd, Modal } from "./ui";

type Result = { id: string; name: string; shape: string; color: string; snippet: string };

export function SearchDialog() {
  const app = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);

  const term = q.trim();
  const searching = term.length >= 2 && loading;

  useEffect(() => {
    if (term.length < 2) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const j = await res.json();
        if (my === seq.current) {
          setResults(j.results ?? []);
          setSel(0);
        }
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [term]);

  const open = (r: Result) => {
    app.setSearchOpen(false);
    router.push(`/bot/${r.id}`);
  };

  return (
    <Modal onClose={() => app.setSearchOpen(false)} width={540} label="Search">
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <Icon name="search" size={17} className="shrink-0 text-neutral-500" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter" && results[sel]) open(results[sel]);
          }}
          placeholder="Search bots and conversations"
          aria-label="Search"
          className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-neutral-600 focus-visible:outline-none"
        />
        {searching ? <Spinner size={15} /> : <Kbd>esc</Kbd>}
      </div>

      <div className="max-h-[380px] overflow-y-auto p-2">
        {(term.length < 2 ? [] : results).map((r, i) => (
          <button
            key={`${r.id}-${i}`}
            onMouseEnter={() => setSel(i)}
            onClick={() => open(r)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${i === sel ? "bg-white/[0.07]" : ""}`}
          >
            <BotAvatar shape={r.shape} color={r.color} size={30} follow={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-white">{r.name}</span>
              <span className="block truncate text-[12px] text-neutral-500">{r.snippet}</span>
            </span>
            {i === sel && <Icon name="arrow-right" size={14} className="text-neutral-500" />}
          </button>
        ))}

        {term.length >= 2 && !results.length && (
          <div className="flex flex-col items-center px-3 py-10 text-center">
            <span className="grid size-10 place-items-center rounded-full bg-white/[0.04] text-neutral-500">
              <Icon name="search" size={17} />
            </span>
            <p className="mt-3 text-[13px] text-neutral-500">
              {term.length < 2 ? "Type at least two characters." : searching ? "Searching…" : "Nothing found."}
            </p>
            {term.length < 2 && <p className="mt-1 text-[11.5px] text-neutral-600">Search every bot and message you have saved.</p>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-2.5 text-[11px] text-neutral-600">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> to open
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd>esc</Kbd> to close
        </span>
      </div>
    </Modal>
  );
}
