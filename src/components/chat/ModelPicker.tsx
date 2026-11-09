"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { Icon, Spinner } from "../icons";
import { cx } from "../ui";

export function ModelPicker({ botId }: { botId: string }) {
  const app = useApp();
  const bot = app.bots.find((b) => b.id === botId);
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const effective = bot?.model || app.settings.defaultModel;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  async function toggle() {
    if (!app.settings.hasAiKey) return app.openSettings("ai");
    const next = !open;
    setOpen(next);
    setQ("");
    if (next && models === null) {
      setLoading(true);
      try {
        const j = await (await fetch("/api/models")).json();
        setModels(j.models ?? []);
      } catch {
        setModels([]);
      } finally {
        setLoading(false);
      }
    }
  }

  async function choose(model: string | null) {
    setOpen(false);
    app.upsertBot({ id: botId, model });
    const res = await fetch(`/api/bots/${botId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) app.toast("Couldn't change the model.", "err");
  }

  const list = (models ?? []).filter((m) => m.toLowerCase().includes(q.toLowerCase()));

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={toggle}
        className="flex max-w-[210px] items-center gap-2 rounded-full border border-white/[0.05] bg-[#141414] py-2 pl-3.5 pr-3 text-[13px] text-neutral-300 transition hover:bg-[#1b1b1b] hover:text-white"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{effective ?? (app.settings.hasAiKey ? "Select model" : "Add API key")}</span>
        <Icon name="chevron" size={13} className={cx("shrink-0 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="modal-in absolute right-0 top-[calc(100%+8px)] z-40 w-[290px] overflow-hidden rounded-2xl border border-white/10 bg-[#171717] shadow-2xl">
          <div className="border-b border-white/[0.06] p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q.trim()) choose(list[0] ?? q.trim());
              }}
              placeholder={models?.length ? "Search models" : "Type a model name + Enter"}
              aria-label="Search models"
              className="w-full rounded-lg bg-[#0f0f0f] px-3 py-2 text-[13px] outline-none placeholder:text-neutral-500"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1.5" role="listbox">
            {bot?.model && !q && (
              <button onClick={() => choose(null)} className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-neutral-400 transition hover:bg-white/[0.06] hover:text-white">
                Use default{app.settings.defaultModel ? ` (${app.settings.defaultModel})` : ""}
              </button>
            )}
            {loading && (
              <div className="grid place-items-center py-6 text-neutral-500">
                <Spinner />
              </div>
            )}
            {list.map((m) => (
              <button
                key={m}
                role="option"
                aria-selected={m === effective}
                onClick={() => choose(m)}
                className={cx("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-white/[0.06]", m === effective && "bg-white/[0.06]")}
              >
                <span className="truncate">{m}</span>
                {m === effective && <Icon name="check" size={14} className="shrink-0 text-[#3b8cff]" />}
              </button>
            ))}
            {!loading && !list.length && <p className="px-3 py-5 text-center text-[12.5px] text-neutral-500">{models?.length ? "No models match." : "Couldn't load models. Type a name above."}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
