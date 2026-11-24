"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Holds the element a dialog should hand focus back to. A dialog opened from a
 * menu can't work this out for itself: opening the menu moves focus into the
 * menu, and choosing an item closes the menu, which drops focus to <body> before
 * the dialog mounts. The provider records the trigger on the way in.
 */
export const appFocusReturn = { current: null as HTMLElement | null };

export function Modal({
  onClose,
  children,
  width = 420,
  label,
  z = 50,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  label: string;
  z?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Take the element to return to from the provider (which records it before the
  // menu that opened this dialog clears focus), then fall back to whatever had
  // focus at mount.
  const restoreTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // Read and consume in one go: a stale value left behind would make the *next*
    // dialog restore focus to a trigger from a different part of the page.
    const active = document.activeElement;
    const own = active instanceof HTMLElement && active !== document.body ? active : null;
    const handed = appFocusReturn.current;
    appFocusReturn.current = null;
    restoreTo.current = handed ?? own;
    // Publish this dialog's trigger so a confirm opened on top of it — which can
    // only see <body> as active — returns focus here instead of to <body>.
    if (own) appFocusReturn.current = own;
    return () => {
      const t = restoreTo.current;
      if (t?.isConnected) t.focus({ preventScroll: true });
      if (appFocusReturn.current === own) appFocusReturn.current = null;
    };
  }, []);

  // Initial focus: [autofocus] if the dialog has one, else the first control, else
  // the panel itself (which is focusable but not tabbable).
  useEffect(() => {
    const root = panelRef.current;
    if (!root || root.contains(document.activeElement)) return;
    const target = root.querySelector<HTMLElement>("[autofocus]") ?? root.querySelector<HTMLElement>("button, a[href], input, textarea, select");
    (target ?? root).focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    // Every dialog listens on window, and stopPropagation() does not stop other
    // listeners on the same target. So Escape in a confirm used to close the
    // Settings dialog underneath it as well. Only the topmost dialog reacts.
    const isTopmost = () => {
      const open = document.querySelectorAll('[role="dialog"]');
      return !open.length || open[open.length - 1] === panelRef.current;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep Tab inside the dialog: without this, Tab walks into the page behind
      // it, which is still scrollable and reachable.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !panel.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !panel.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{ zIndex: z }}>
      {/* preventDefault: without it the matching mouseup/click blurs the element
          the dialog just restored focus to, leaving focus on <body>. */}
      <div
        className="backdrop-in absolute inset-0 bg-black/65 backdrop-blur-md"
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={label}
        className="modal-in relative flex max-h-full flex-col overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#121215] shadow-[0_40px_120px_rgba(0,0,0,0.75)]"
        style={{ width: `min(${width}px, 100%)` }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
      <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
      <div className="flex items-center gap-2">
        {children}
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * A labelled checkbox for multi-select lists. The browser default is a 13px blue
 * square that looks pasted in; this reads as part of the same surface as the
 * inputs and switches around it.
 */
export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="group flex cursor-pointer items-center gap-2.5 text-[12.5px] text-neutral-300 transition hover:text-white">
      <span className="relative grid size-[17px] shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer size-[17px] cursor-pointer appearance-none rounded-[5px] border border-white/20 bg-white/[0.04] transition checked:border-[#7c9bff] checked:bg-[#7c9bff] focus-visible:border-white/40"
        />
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="pointer-events-none absolute size-3 scale-75 text-[#0a0a0c] opacity-0 transition peer-checked:scale-100 peer-checked:opacity-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3 8.5 3.2 3.2L13 4.8" />
        </svg>
      </span>
      {label}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200", checked ? "bg-[#7c9bff]" : "bg-[#333]")}
    >
      <span className={cx("absolute top-[3px] size-5 rounded-full bg-white shadow transition-all duration-200", checked ? "left-[21px]" : "left-[3px]")} />
    </button>
  );
}

export const inputCls =
  "w-full rounded-xl border border-white/[0.08] bg-[#0b0b0e] px-3.5 py-2.5 text-[14px] text-white placeholder:text-neutral-500 outline-none transition focus:border-white/25";

export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#26262b] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#303036] active:scale-[0.97] disabled:opacity-40";
export const btnWhite =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.97] disabled:opacity-40";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#3a1418] px-4 py-2 text-[13px] font-medium text-[#ff6b7a] transition hover:bg-[#4a1a1f] active:scale-[0.97] disabled:opacity-40";
export const btnQuiet =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-neutral-300 transition hover:bg-white/[0.07] hover:text-white active:scale-[0.97] disabled:opacity-40";

/** Icon-only button used in headers and toolbars. */
export function IconButton({
  label,
  className,
  children,
  active = false,
  ...rest
}: { label: string; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-full transition active:scale-90",
        active ? "bg-white/[0.12] text-white" : "text-neutral-400 hover:bg-white/[0.07] hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Small rounded label, e.g. “Beta”, “Connected”, “Draft”. */
export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warn"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium leading-none",
        tone === "neutral" && "border border-white/[0.08] bg-white/[0.04] text-neutral-300",
        tone === "accent" && "border border-[#7c9bff]/25 bg-[#7c9bff]/10 text-[#c3d1ff]",
        tone === "good" && "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
        tone === "warn" && "border border-amber-400/20 bg-amber-400/10 text-amber-200",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Keyboard hint chip. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-sans text-[10.5px] font-medium text-neutral-400">
      {children}
    </kbd>
  );
}
