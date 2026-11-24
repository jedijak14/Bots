"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{ zIndex: z }}>
      <div className="backdrop-in absolute inset-0 bg-black/65 backdrop-blur-md" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
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
