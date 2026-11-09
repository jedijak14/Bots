"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { BotDTO } from "@/lib/bots";
import { BotAvatar } from "../BotAvatar";
import { Icon, Spinner } from "../icons";
import { cx } from "../ui";
import type { Computer } from "./useComputer";

/** Height reserved above (status / address bar) and below (control pill) the screen. */
const BAR_H = 44;
const PILL_H = 60;

const NAMED_KEYS: Record<string, string> = {
  Enter: "enter",
  Backspace: "backspace",
  Tab: "tab",
  Escape: "escape",
  Delete: "delete",
  Insert: "insert",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "page_up",
  PageDown: "page_down",
  " ": "space",
  "/": "slash",
  "-": "minus",
  "=": "equal",
  "+": "plus",
  ".": "period",
  ",": "comma",
  ";": "semicolon",
  "'": "apostrophe",
  "[": "bracketleft",
  "]": "bracketright",
  "\\": "backslash",
  "`": "grave",
};
for (let i = 1; i <= 12; i++) NAMED_KEYS[`F${i}`] = `f${i}`;

const TYPE_PAUSE_MS = 280;
const WHEEL_PAUSE_MS = 120;
const DRAG_THRESHOLD = 6;

/**
 * The Screen tab: the bot's desktop, one status line above it and one control
 * below it. Watching is the default; "Take control" lets the person click,
 * scroll and type straight on the screen until they hand it back.
 */
export function ComputerScreen({
  bot,
  computer,
  hasE2b,
  agentBusy,
  activity,
  control,
  onControl,
  centered,
  onOpenSettings,
}: {
  bot: Pick<BotDTO, "name" | "shape" | "color">;
  computer: Computer;
  hasE2b: boolean;
  agentBusy: boolean;
  /** What the bot is doing right now, if anything. */
  activity: string | null;
  control: boolean;
  onControl: (v: boolean) => void;
  /** Centre the screen in the available space (full view) instead of pinning it to the top. */
  centered: boolean;
  onOpenSettings: () => void;
}) {
  const { phase, image, error, busy, act, wake, retry } = computer;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const takeRef = useRef<HTMLButtonElement>(null);
  const [addr, setAddr] = useState("");
  const [ripple, setRipple] = useState<{ x: number; y: number; k: number } | null>(null);

  const typed = useRef("");
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheel = useRef<{ dy: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null }>({ dy: 0, x: 0, y: 0, timer: null });
  const press = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const skipClick = useRef(false);

  const live = phase === "on" && !!image;
  const driving = control && live;

  /** Maps a pointer position to a pixel on the remote screen (null when outside the picture). */
  const toRemote = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const r = img.getBoundingClientRect();
    const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    if (!scale) return null;
    const left = r.left + (r.width - img.naturalWidth * scale) / 2;
    const top = r.top + (r.height - img.naturalHeight * scale) / 2;
    const x = (clientX - left) / scale;
    const y = (clientY - top) / scale;
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return null;
    return { x: Math.round(x), y: Math.round(y), fx: ((clientX - r.left) / r.width) * 100, fy: ((clientY - r.top) / r.height) * 100 };
  }, []);

  const flushTyped = useCallback(() => {
    if (typeTimer.current) clearTimeout(typeTimer.current);
    typeTimer.current = null;
    const text = typed.current;
    typed.current = "";
    if (text) act({ action: "type", text });
  }, [act]);

  const flushWheel = useCallback(() => {
    const w = wheel.current;
    w.timer = null;
    const amount = Math.max(1, Math.min(10, Math.round(Math.abs(w.dy) / 80)));
    if (w.dy) act({ action: "scroll", direction: w.dy > 0 ? "down" : "up", amount, x: w.x, y: w.y });
    w.dy = 0;
  }, [act]);

  useEffect(
    () => () => {
      if (typeTimer.current) clearTimeout(typeTimer.current);
      const w = wheel.current;
      if (w.timer) clearTimeout(w.timer);
    },
    [],
  );

  // Put the keyboard on the screen as soon as the person takes control.
  useEffect(() => {
    if (driving) surfaceRef.current?.focus({ preventScroll: true });
  }, [driving]);

  // The wheel has to be a native, non-passive listener so the page behind doesn't scroll too.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || !driving) return;
    const onWheel = (e: WheelEvent) => {
      const p = toRemote(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      const w = wheel.current;
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
      if (w.dy && Math.sign(w.dy) !== Math.sign(e.deltaY)) w.dy = 0;
      w.dy += e.deltaY * unit;
      w.x = p.x;
      w.y = p.y;
      if (!w.timer) w.timer = setTimeout(flushWheel, WHEEL_PAUSE_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [driving, toRemote, flushWheel]);

  const handBack = useCallback(() => {
    flushTyped();
    onControl(false);
    requestAnimationFrame(() => takeRef.current?.focus({ preventScroll: true }));
  }, [flushTyped, onControl]);

  function onPointerDown(e: PointerEvent) {
    if (!driving || e.button !== 0) return;
    const p = toRemote(e.clientX, e.clientY);
    press.current = p ? { x: p.x, y: p.y, cx: e.clientX, cy: e.clientY } : null;
  }

  function onPointerUp(e: PointerEvent) {
    const from = press.current;
    press.current = null;
    if (!driving || !from || e.button !== 0) return;
    if (Math.hypot(e.clientX - from.cx, e.clientY - from.cy) < DRAG_THRESHOLD) return;
    const to = toRemote(e.clientX, e.clientY);
    if (!to) return;
    // A press that travelled is a drag (select text, move a slider), not a click.
    skipClick.current = true;
    flushTyped();
    act({ action: "drag", x: from.x, y: from.y, toX: to.x, toY: to.y });
  }

  function onClick(e: MouseEvent) {
    if (!driving) return;
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    const p = toRemote(e.clientX, e.clientY);
    if (!p || e.detail > 2) return;
    flushTyped();
    setRipple({ x: p.fx, y: p.fy, k: Date.now() });
    act({ action: e.detail === 2 ? "doubleClick" : "click", x: p.x, y: p.y });
  }

  function onContextMenu(e: MouseEvent) {
    if (!driving) return;
    e.preventDefault();
    const p = toRemote(e.clientX, e.clientY);
    if (!p) return;
    flushTyped();
    setRipple({ x: p.fx, y: p.fy, k: Date.now() });
    act({ action: "rightClick", x: p.x, y: p.y });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!driving || e.nativeEvent.isComposing) return;
    const k = e.key;
    if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta" || k === "CapsLock" || k === "Dead" || k === "Unidentified") return;
    const mod = e.ctrlKey || e.metaKey;
    // Shift+Tab is left alone so keyboard users can always move focus off the screen.
    if (k === "Tab" && e.shiftKey && !mod) return;
    // Paste is left to the browser so the clipboard text arrives through the paste event.
    if (mod && !e.altKey && k.toLowerCase() === "v") return;

    e.preventDefault();
    e.stopPropagation();

    const altGr = e.getModifierState("AltGraph");
    const plainAlt = e.altKey && !altGr && /^[a-z0-9]$/i.test(k);
    if (k.length === 1 && k !== " " && (!mod || altGr) && !plainAlt) {
      // An ordinary character: batch a few together so fast typing is one request, not ten.
      typed.current += k;
      if (typeTimer.current) clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(flushTyped, TYPE_PAUSE_MS);
      return;
    }
    if (k === " " && !mod && !e.altKey) {
      typed.current += " ";
      if (typeTimer.current) clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(flushTyped, TYPE_PAUSE_MS);
      return;
    }

    const name = NAMED_KEYS[k] ?? (/^[a-z0-9]$/i.test(k) ? k.toLowerCase() : null);
    if (!name) return;
    const chord: string[] = [];
    if (mod) chord.push("ctrl");
    if (e.altKey) chord.push("alt");
    if (e.shiftKey) chord.push("shift");
    flushTyped();
    act({ action: "key", key: [...chord, name] });
  }

  function onPaste(e: ClipboardEvent) {
    if (!driving) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text").slice(0, 2000);
    if (!text) return;
    flushTyped();
    act({ action: "type", text });
  }

  function navigate(e: FormEvent) {
    e.preventDefault();
    const url = addr.trim();
    if (!url) return;
    flushTyped();
    act({ action: "navigate", url });
    surfaceRef.current?.focus({ preventScroll: true });
  }

  const owner = `${bot.name}'s`;

  return (
    <div className={cx("flex min-h-0 flex-1 justify-center px-4 pb-2 pt-1 [container-type:size]", centered ? "items-center" : "items-start")}>
      {/* As wide as the space allows while the 4:3 screen, the bar above it and the pill below it all still fit. */}
      <div className="flex max-w-full flex-col" style={{ width: `min(100cqw, calc((100cqh - ${BAR_H + PILL_H}px) * 4 / 3))` }}>
        <div className="flex shrink-0 items-center" style={{ height: BAR_H }}>
          {driving ? (
            <form onSubmit={navigate} className="flex h-9 w-full items-center gap-2 rounded-full border border-white/[0.08] bg-[#141414] pl-3 pr-1 transition focus-within:border-white/25">
              <Icon name="globe" size={15} className="shrink-0 text-neutral-500" />
              <input
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder="Search or enter a web address"
                aria-label="Web address"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-neutral-500"
              />
              <button type="submit" disabled={!addr.trim()} aria-label="Go" className="grid size-7 shrink-0 place-items-center rounded-full text-neutral-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30">
                <Icon name="arrow-right" size={15} />
              </button>
            </form>
          ) : (
            <div className="flex w-full min-w-0 items-center gap-2 px-1 text-[13px]" aria-live="polite">
              <span className="shrink-0 font-medium text-neutral-200">{owner} screen</span>
              {live && agentBusy && activity ? (
                <span className="shimmer-text min-w-0 truncate">{activity}</span>
              ) : (
                <span className="min-w-0 truncate text-neutral-500">
                  {!hasE2b ? "Not set up" : phase === "on" ? (agentBusy ? "Working" : "Idle") : phase === "asleep" ? "Asleep" : phase === "waking" ? "Waking up" : phase === "unreachable" ? "Offline" : ""}
                </span>
              )}
            </div>
          )}
          {busy && live && (
            <span className="ml-2 shrink-0 text-neutral-400" role="status" aria-label="Working">
              <Spinner size={14} />
            </span>
          )}
        </div>

        <div
          ref={surfaceRef}
          // Only a live screen is a picture; the other states hold real text and buttons.
          role={driving ? "application" : live ? "img" : undefined}
          tabIndex={driving ? 0 : undefined}
          aria-label={
            driving
              ? `${owner} computer. You are in control: click, scroll and type here. Press Shift+Tab to leave the screen.`
              : live
                ? `${owner} computer screen`
                : undefined
          }
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onClick={onClick}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={flushTyped}
          className={cx(
            "relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-[#070707] outline-none ring-1 transition-shadow duration-200",
            driving ? "cursor-default ring-2 ring-[#3b8cff] focus:shadow-[0_0_0_5px_rgba(59,140,255,0.18)]" : "ring-white/[0.08]",
          )}
        >
          {live ? (
            // eslint-disable-next-line @next/next/no-img-element -- a live screenshot delivered as a data URL
            <img ref={imgRef} src={`data:image/png;base64,${image}`} alt="" className="size-full select-none object-contain" draggable={false} />
          ) : !hasE2b ? (
            <ScreenState
              avatar={<BotAvatar shape={bot.shape} color={bot.color} size={56} className="opacity-70" />}
              title={`${bot.name} doesn't have a computer yet`}
              body="Add an E2B key and every bot gets its own cloud desktop to browse the web and work with files."
              action={{ label: "Add E2B key", onClick: onOpenSettings }}
            />
          ) : phase === "loading" ? (
            <div className="absolute inset-0 grid place-items-center text-neutral-600" role="status" aria-label="Connecting">
              <Spinner size={20} />
            </div>
          ) : phase === "waking" ? (
            <ScreenState avatar={<BotAvatar shape={bot.shape} color={bot.color} size={56} working />} title="Waking up…" shimmer body="This takes a few seconds." />
          ) : phase === "asleep" ? (
            <ScreenState
              avatar={<BotAvatar shape={bot.shape} color={bot.color} size={56} follow={false} className="opacity-45 saturate-50" />}
              title={`${owner} computer is asleep`}
              body={`It wakes up on its own when ${bot.name} needs it.`}
              action={{ label: "Wake", onClick: wake }}
            />
          ) : (
            <ScreenState
              avatar={<BotAvatar shape={bot.shape} color={bot.color} size={56} follow={false} className="opacity-45 saturate-50" />}
              title="Can't reach the computer"
              body={error ?? "Something went wrong while connecting."}
              action={{ label: "Try again", onClick: retry }}
            />
          )}
          {ripple && (
            <span
              key={ripple.k}
              className="pointer-events-none absolute size-8 rounded-full border-2 border-[#3b8cff] bg-[#3b8cff]/30"
              style={{ left: `${ripple.x}%`, top: `${ripple.y}%`, animation: "click-ripple .6s ease-out forwards" }}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center justify-center" style={{ height: PILL_H }}>
          {live && (
            <div className={cx("fade-up flex h-10 items-center rounded-full border bg-[#151515] pl-4 pr-1 text-[13px] shadow-[0_8px_30px_rgba(0,0,0,0.45)]", driving ? "border-[#3b8cff]/40" : "border-white/[0.08]")}>
              <span className="flex items-center gap-2 pr-3.5 text-neutral-300">
                <span className={cx("size-2 rounded-full", driving ? "bg-[#3b8cff]" : "bg-emerald-400", !driving && agentBusy && "soft-pulse")} aria-hidden="true" />
                {driving ? "You're in control" : "Watching"}
              </span>
              <span className="h-4 w-px bg-white/10" aria-hidden="true" />
              {driving ? (
                <button type="button" onClick={handBack} className="ml-1 h-8 rounded-full bg-white px-3.5 font-semibold text-black transition hover:bg-neutral-200 active:scale-95">
                  I&apos;m done
                </button>
              ) : (
                <button
                  ref={takeRef}
                  type="button"
                  disabled={agentBusy}
                  title={agentBusy ? `${bot.name} is using the computer. Stop it, or wait until it's finished.` : undefined}
                  onClick={() => onControl(true)}
                  className="ml-1 h-8 rounded-full px-3 font-medium text-white transition hover:bg-white/10 active:scale-95 disabled:text-neutral-500 disabled:hover:bg-transparent"
                >
                  Take control
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScreenState({ avatar, title, body, action, shimmer }: { avatar: ReactNode; title: string; body?: string; action?: { label: string; onClick: () => void }; shimmer?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-6 text-center">
      {avatar}
      <h3 className={cx("mt-5 text-[15px] font-semibold tracking-tight", shimmer && "shimmer-text")}>{title}</h3>
      {body && <p className="mt-1.5 line-clamp-3 max-w-[340px] text-[13px] leading-relaxed text-neutral-500">{body}</p>}
      {action && (
        <button type="button" onClick={action.onClick} className="mt-5 rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-95">
          {action.label}
        </button>
      )}
    </div>
  );
}
