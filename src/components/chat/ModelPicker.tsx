"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { Icon, Spinner } from "../icons";
import { cx } from "../ui";

export function ModelPicker({ botId, variant = "header" }: { botId: string; variant?: "header" | "chip" }) {
  const app = useApp();
  const bot = app.bots.find((b) => b.id === botId);
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const effective = bot?.model || app.settings.defaultModel;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape has to work wherever focus is: tabbing out of the search box used to
    // leave the panel floating over the page with no way to dismiss it from the
    // keyboard, because only the input's own handler listened for Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    // Focus leaving the picker (Tab, or a click on another control) closes it.
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node | null;
      if (t && !wrap.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focusin", onFocusIn);
    };
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
        ref={trigger}
        onClick={toggle}
        className={cx(
          "group flex items-center gap-1.5 rounded-full font-medium transition",
          variant === "chip"
            ? cx("h-8 border px-2.5 text-[12px]", open ? "border-white/25 bg-white/[0.08] text-white" : "border-white/[0.08] text-neutral-300 hover:border-white/20 hover:bg-white/[0.05] hover:text-white")
            : "h-9 max-w-[220px] px-2.5 text-[12.5px] text-neutral-300 hover:bg-white/[0.06] hover:text-white max-md:px-2",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose model"
        title="Choose model"
      >
        <Icon name="sparkles" size={13} className="text-neutral-500 transition group-hover:text-[#a8c0ff]" />
        <span className={cx("truncate", variant === "chip" ? "max-w-[170px]" : "max-w-[150px] max-sm:hidden")}>
          {effective ?? (app.settings.hasAiKey ? "Select model" : "Add API key")}
        </span>
        <Icon name="chevron" size={12} className={cx("shrink-0 text-neutral-600 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div
          className={cx(
            "modal-in absolute z-40 w-[300px] overflow-hidden rounded-2xl border border-white/10 bg-[#19191d] shadow-[0_24px_70px_rgba(0,0,0,0.65)]",
            variant === "chip" ? "bottom-[calc(100%+8px)] left-0" : "right-0 top-[calc(100%+6px)]",
          )}
        >
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
              className="w-full rounded-xl bg-black/30 px-3 py-2 text-[13px] outline-none placeholder:text-neutral-600"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1.5" role="listbox">
            {bot?.model && !q && (
              <button
                onClick={() => choose(null)}
                className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-neutral-400 transition hover:bg-white/[0.06] hover:text-white"
              >
                Use default{app.settings.defaultModel ? ` (${app.settings.defaultModel})` : ""}
              </button>
            )}
            {loading && (
              <div className="grid place-items-center py-8 text-neutral-500">
                <Spinner />
              </div>
            )}
            {list.map((m) => (
              <button
                key={m}
                role="option"
                aria-selected={m === effective}
                onClick={() => choose(m)}
                className={cx("flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-white/[0.06]", m === effective && "bg-white/[0.06] text-white")}
              >
                <span className="truncate">{m}</span>
                {m === effective && <Icon name="check" size={13} className="shrink-0 text-[#a8c0ff]" />}
              </button>
            ))}
            {!loading && !list.length && (
              <p className="px-3 py-6 text-center text-[12.5px] text-neutral-500">{models?.length ? "No models match." : "Couldn't load models. Type a name above."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
