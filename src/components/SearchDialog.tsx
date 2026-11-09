"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { Icon, Spinner } from "./icons";
import { Modal } from "./ui";

type Result = { id: string; name: string; shape: string; color: string; snippet: string };

export function SearchDialog() {
  const app = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const my = ++seq.current;
    const t = setTimeout(async () => {
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
  }, [q]);

  const open = (r: Result) => {
    app.setSearchOpen(false);
    router.push(`/bot/${r.id}`);
  };

  return (
    <Modal onClose={() => app.setSearchOpen(false)} width={520} label="Search">
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
        <Icon name="search" size={18} className="text-neutral-500" />
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
          className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-neutral-500"
        />
        {loading && <Spinner size={15} />}
      </div>
      <div className="max-h-[360px] overflow-y-auto p-2">
        {results.map((r, i) => (
          <button
            key={`${r.id}-${i}`}
            onMouseEnter={() => setSel(i)}
            onClick={() => open(r)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${i === sel ? "bg-white/[0.07]" : ""}`}
          >
            <BotAvatar shape={r.shape} color={r.color} size={28} follow={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{r.name}</span>
              <span className="block truncate text-[12.5px] text-neutral-500">{r.snippet}</span>
            </span>
          </button>
        ))}
        {!results.length && (
          <p className="px-3 py-8 text-center text-[13px] text-neutral-500">
            {q.trim().length < 2 ? "Type at least two characters." : loading ? "Searching…" : "Nothing found."}
          </p>
        )}
      </div>
    </Modal>
  );
}
