"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Spinner } from "../icons";
import { btnGhost, cx } from "../ui";

type Status = "ready" | "starting" | "working" | "error";
type Body = Record<string, unknown> & { action: string };

const SCREEN_W = 1024;
const SCREEN_H = 768;

export function ComputerPanel({
  botId,
  hasE2b,
  mode,
  agentBusy,
  externalShot,
  expanded,
  onToggleExpand,
  onClose,
  onOpenSettings,
}: {
  botId: string;
  hasE2b: boolean;
  mode: "computer" | "files" | "preview";
  agentBusy: boolean;
  externalShot: { n: number; data: string } | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState<string | null>(null);
  const [control, setControl] = useState(false);
  const [addr, setAddr] = useState("");
  const [typed, setTyped] = useState("");
  const [ripple, setRipple] = useState<{ x: number; y: number; k: number } | null>(null);
  const [filesTick, setFilesTick] = useState(0);
  const inflight = useRef(false);
  const imgRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const call = useCallback(
    async (body: Body, label: Status = "working") => {
      const quiet = body.action === "screenshot";
      if (quiet && inflight.current) return;
      inflight.current = true;
      if (!quiet) setStatus(label);
      try {
        const res = await fetch(`/api/bots/${botId}/computer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "The computer isn't responding.");
        setActive(!!j.active);
        if (j.image) setImage(j.image);
        setStatus("ready");
        setError(null);
      } catch (e) {
        if (!quiet) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "The computer isn't responding.");
        }
      } finally {
        inflight.current = false;
      }
    },
    [botId],
  );

  // initial look + gentle polling while the panel is open
  useEffect(() => {
    if (!hasE2b || mode !== "computer") return;
    call({ action: "screenshot" });
    const t = setInterval(() => {
      if (!document.hidden && !agentBusy) call({ action: "screenshot" });
    }, 3000);
    return () => clearInterval(t);
  }, [hasE2b, mode, agentBusy, call]);

  // screenshots pushed from the agent while it works
  useEffect(() => {
    if (externalShot) {
      setImage(externalShot.data);
      setActive(true);
      setFilesTick((n) => n + 1);
    }
  }, [externalShot]);

  const busy = status === "starting" || status === "working";

  function navigate() {
    if (!addr.trim() || busy) return;
    call({ action: "navigate", url: addr }, active ? "working" : "starting");
  }

  function onScreenClick(e: React.MouseEvent) {
    if (!control || busy || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    setRipple({ x: fx * 100, y: fy * 100, k: Date.now() });
    call({ action: "click", x: fx * SCREEN_W, y: fy * SCREEN_H });
  }

  function onWheel(e: React.WheelEvent) {
    if (!control) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    const dir = e.deltaY > 0 ? "down" : "up";
    scrollTimer.current = setTimeout(() => call({ action: "scroll", direction: dir }), 120);
  }

  return (
    <aside
      className={cx(
        "flex min-h-0 flex-col border-l border-white/[0.06] bg-[#0b0b0b]",
        expanded ? "absolute inset-0 top-[68px] z-20 w-full" : "w-[min(420px,100%)] shrink-0 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:top-[68px] max-lg:shadow-[-20px_0_60px_rgba(0,0,0,0.6)]",
      )}
      aria-label={mode === "computer" ? "Computer" : mode === "preview" ? "Website preview" : "Files"}
    >
      <div className="flex shrink-0 items-center justify-between px-5 pb-3.5 pt-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cx("size-2 rounded-full", mode === "computer" && active ? "bg-emerald-400" : "bg-neutral-600")} aria-hidden="true" />
          <h2 className="truncate text-[16px] font-semibold tracking-tight">{mode === "computer" ? "Computer" : mode === "preview" ? "Preview" : "Files"}</h2>
          {mode === "computer" && <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-neutral-500">Live</span>}
        </div>
        <div className="flex items-center gap-1 text-neutral-400">
          <button
            onClick={() => (mode === "computer" ? call({ action: "screenshot" }) : setFilesTick((n) => n + 1))}
            className="rounded-lg px-2.5 py-1.5 text-[12.5px] transition hover:bg-white/[0.07] hover:text-white"
          >
            Refresh
          </button>
          <button onClick={onToggleExpand} aria-label={expanded ? "Collapse" : "Expand"} className="grid size-8 place-items-center rounded-lg transition hover:bg-white/[0.07] hover:text-white">
            <Icon name="expand" size={16} />
          </button>
          <button onClick={onClose} aria-label="Close panel" className="grid size-8 place-items-center rounded-lg transition hover:bg-white/[0.07] hover:text-white">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
      <div className="h-px shrink-0 bg-white/[0.06]" />

      {!hasE2b ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-[#171717] text-neutral-400">
            <Icon name="expand" size={20} />
          </div>
          <h3 className="text-[15px] font-semibold">Give your bots a computer</h3>
          <p className="text-[13px] leading-relaxed text-neutral-500">Add your E2B API key in Settings and every bot gets its own cloud desktop to browse, research and run code.</p>
          <button onClick={onOpenSettings} className={btnGhost}>
            Add E2B key
          </button>
        </div>
      ) : mode === "files" || mode === "preview" ? (
        <FilesView botId={botId} tick={filesTick} preview={mode === "preview"} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setControl((c) => !c)}
              className={cx("shrink-0 rounded-full px-4 py-2.5 text-[13px] font-medium transition active:scale-95", control ? "bg-[#2b7fff] text-white" : "bg-[#1a1a1a] text-white hover:bg-[#232323]")}
            >
              {control ? "Hand back" : "Take control"}
            </button>
            <p className="text-[12px] leading-snug text-neutral-500">
              {control ? "You're in control. Click the screen, scroll, or type below." : "Live view · Take control to use the mouse and keyboard."}
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-white/[0.06] bg-[#101010] p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-neutral-500">
              <span>Browser session</span>
              <span className={cx("flex items-center gap-1.5", active ? "text-emerald-400" : "text-neutral-500")}><span className="size-1.5 rounded-full bg-current" />{active ? "Connected" : "Standby"}</span>
            </div>
            <div className="flex items-center gap-2">
            <button
              disabled={busy}
              onClick={() => call({ action: "restart" }, active ? "working" : "starting")}
              className="rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-95 disabled:opacity-50"
            >
              Restart browser
            </button>
            <span className={cx("flex items-center gap-2 text-[12.5px]", status === "error" ? "text-[#ff6b7a]" : "text-neutral-400")}>
              {busy && <Spinner size={12} />}
              {status === "ready" ? (active ? "Ready" : "Ready") : status === "starting" ? "Starting…" : status === "working" ? "Working…" : "Error"}
            </span>
            </div>
          </div>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              navigate();
            }}
          >
            <input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="Search or enter a web address"
              aria-label="Address"
              className="min-w-0 flex-1 rounded-xl border border-white/[0.06] bg-[#111] px-3.5 py-3 text-[13px] outline-none placeholder:text-neutral-500 focus:border-white/20"
            />
            <button type="submit" disabled={busy || !addr.trim()} className="rounded-xl bg-[#171717] px-3.5 text-[13px] font-semibold transition hover:bg-[#222] disabled:opacity-40">
              Go
            </button>
          </form>

          <div
            ref={imgRef}
            onClick={onScreenClick}
            onWheel={onWheel}
            className={cx(
              "relative mt-4 aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#050505]",
              control && image && "cursor-crosshair ring-1 ring-[#2b7fff]/60",
            )}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/png;base64,${image}`} alt="Your bot's computer screen" className="size-full select-none object-contain" draggable={false} />
            ) : (
              <div className="absolute inset-0 grid place-items-center px-6 text-center">
                {busy ? (
                  <div className="flex flex-col items-center gap-3 text-neutral-400">
                    <Spinner size={22} />
                    <p className="text-[12.5px]">{status === "starting" ? "Starting your computer… first boot takes a few seconds." : "Working…"}</p>
                  </div>
                ) : (
                  <div>
                    <div className="mx-auto mb-3 size-4 rounded-full border-[3px] border-white/80" />
                    <p className="text-[13px] font-semibold">Your computer is ready</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">Ask your bot to browse, research, or work with files. You can also open a website using the address bar.</p>
                    {!active && (
                      <button onClick={() => call({ action: "start" }, "starting")} className="mt-4 rounded-full bg-[#1c1c1c] px-4 py-2 text-[12.5px] font-medium transition hover:bg-[#262626]">
                        Start computer
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {image && busy && (
              <div className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white">
                <Spinner size={14} />
              </div>
            )}
            {ripple && (
              <span
                key={ripple.k}
                className="pointer-events-none absolute size-8 rounded-full border-2 border-[#2b7fff] bg-[#2b7fff]/30"
                style={{ left: `${ripple.x}%`, top: `${ripple.y}%`, animation: "click-ripple .6s ease-out forwards" }}
              />
            )}
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-500">Your computer</p>

          {error && <p className="mt-3 rounded-xl bg-[#2a1215] px-3.5 py-2.5 text-[12.5px] text-[#ff8b98]">{error}</p>}

          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed || busy) return;
              call({ action: "type", text: typed, enter: true });
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type into the browser"
              aria-label="Type into the browser"
              className="w-full rounded-xl border border-white/[0.06] bg-[#111] px-3.5 py-3 text-[13px] outline-none placeholder:text-neutral-500 focus:border-white/20"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!typed || busy}
                onClick={() => {
                  call({ action: "type", text: typed });
                  setTyped("");
                }}
                className="rounded-xl bg-[#171717] px-4 py-2.5 text-[13px] font-medium transition hover:bg-[#222] disabled:opacity-40"
              >
                Type
              </button>
              {["Enter", "Tab", "Escape", "BackSpace"].map((k) => (
                <button key={k} type="button" disabled={busy || !active} onClick={() => call({ action: "key", key: k })} className="rounded-xl px-2.5 py-2 text-[12px] text-neutral-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-30">
                  {k === "BackSpace" ? "Backspace" : k}
                </button>
              ))}
            </div>
          </form>
          <p className="mt-4 text-[12px] leading-relaxed text-neutral-500">
            Take control to click and type yourself, then hand it back to your bot. Files your bot creates show up under <b className="font-medium text-neutral-300">Files</b>.
          </p>
        </div>
      )}
    </aside>
  );
}

type Entry = { name: string; path: string; type: "file" | "dir"; size: number };

function FilesView({ botId, tick, preview }: { botId: string; tick: number; preview: boolean }) {
  const [path, setPath] = useState("/home/user");
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    fetch(`/api/bots/${botId}/files?path=${encodeURIComponent(path)}`)
      .then(async (r) => ({ ok: r.ok, j: await r.json() }))
      .then(({ ok, j }) => {
        if (dead) return;
        if (!ok) throw new Error(j.error || "Couldn't load files.");
        setEntries(j.entries ?? []);
        setActive(j.active !== false);
        setError(null);
      })
      .catch((e) => !dead && setError(e instanceof Error ? e.message : "Couldn't load files."))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [botId, path, tick]);

  const parts = path.split("/").filter(Boolean);
  const fmt = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n > 1000 ? `${Math.round(n / 1000)} KB` : `${n} B`);

  const selectedUrl = selected ? `/api/bots/${botId}/files?download=1&path=${encodeURIComponent(selected)}` : null;

  return (
    <div className={cx("min-h-0 flex-1 overflow-hidden", preview ? "flex flex-col" : "overflow-y-auto px-4 py-4")}>
      <div className="mb-3 flex flex-wrap items-center gap-1 px-1 text-[12.5px] text-neutral-400">
        <button onClick={() => setPath("/home/user")} className="rounded-md px-1.5 py-1 hover:bg-white/[0.06] hover:text-white">
          ~
        </button>
        {parts.slice(2).map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-neutral-600">/</span>
            <button onClick={() => setPath("/" + parts.slice(0, i + 3).join("/"))} className="rounded-md px-1.5 py-1 hover:bg-white/[0.06] hover:text-white">
              {p}
            </button>
          </span>
        ))}
      </div>
      {loading && !entries.length ? (
        <div className="grid place-items-center py-10 text-neutral-500">
          <Spinner />
        </div>
      ) : error ? (
        <p className="rounded-xl bg-[#2a1215] px-3.5 py-2.5 text-[12.5px] text-[#ff8b98]">{error}</p>
      ) : !active ? (
        <p className="px-2 py-10 text-center text-[13px] text-neutral-500">Your computer isn&apos;t running yet. Ask your bot to do something and it will start.</p>
      ) : !entries.length ? (
        <p className="px-2 py-10 text-center text-[13px] text-neutral-500">No files here yet. Ask your bot to create something.</p>
      ) : (
        <div className={cx(preview && "flex min-h-0 flex-1 flex-col")}>
          <ul className={cx("space-y-0.5", preview && "min-h-0 overflow-y-auto px-4") }>
            {entries.map((e) => (
              <li key={e.path}>
                {e.type === "dir" ? (
                  <button onClick={() => setPath(e.path)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]">
                    <Icon name="folder" size={17} className="text-[#6aa9ff]" />
                    <span className="truncate text-[13.5px]">{e.name}</span>
                  </button>
                ) : preview ? (
                  <button onClick={() => setSelected(e.path)} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]", selected === e.path && "bg-white/[0.08]")}>
                    <Icon name="file" size={17} className="text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{e.name}</span>
                    <span className="text-[11.5px] text-neutral-500">{fmt(e.size)}</span>
                  </button>
                ) : (
                  <a href={`/api/bots/${botId}/files?download=1&path=${encodeURIComponent(e.path)}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.05]">
                    <Icon name="file" size={17} className="text-neutral-400" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{e.name}</span>
                    <span className="text-[11.5px] text-neutral-500">{fmt(e.size)}</span>
                    <Icon name="download" size={14} className="text-neutral-500" />
                  </a>
                )}
              </li>
            ))}
          </ul>
          {preview && (
            <div className="mt-2 min-h-0 flex-1 border-t border-white/[0.06] bg-[#080808]">
              {selectedUrl ? (
                <>
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-[12px] text-neutral-400">
                    <span className="truncate">{selected}</span>
                    <a href={selectedUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg px-2 py-1 hover:bg-white/[0.08] hover:text-white">Open in new tab</a>
                  </div>
                  <iframe title={`Preview of ${selected}`} src={selectedUrl} className="h-[min(420px,60vh)] w-full border-0 bg-white" />
                </>
              ) : (
                <div className="grid h-full min-h-40 place-items-center px-8 text-center text-[13px] text-neutral-500">Select an HTML file to preview it here. Your bot can create a website in the workspace.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
