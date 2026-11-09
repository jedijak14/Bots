"use client";

import { useEffect, type ReactNode } from "react";
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
      <div className="backdrop-in absolute inset-0 bg-black/55 backdrop-blur-md" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="modal-in relative max-h-full overflow-hidden rounded-[22px] border border-white/[0.07] bg-[#171717] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
        style={{ width: `min(${width}px, 100%)` }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
      <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
      <button onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white">
        <Icon name="close" size={16} />
      </button>
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
      className={cx("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200", checked ? "bg-[#2b8af7]" : "bg-[#333]")}
    >
      <span className={cx("absolute top-[3px] size-5 rounded-full bg-white shadow transition-all duration-200", checked ? "left-[21px]" : "left-[3px]")} />
    </button>
  );
}

export const inputCls =
  "w-full rounded-xl border border-white/[0.08] bg-[#0f0f0f] px-3.5 py-2.5 text-[14px] text-white placeholder:text-neutral-500 outline-none transition focus:border-white/25";

export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#232323] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#2c2c2c] active:scale-[0.97] disabled:opacity-40";
export const btnWhite =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.97] disabled:opacity-40";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#3a1418] px-4 py-2 text-[13px] font-medium text-[#ff6b7a] transition hover:bg-[#4a1a1f] active:scale-[0.97] disabled:opacity-40";
