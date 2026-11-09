"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";

export type TipOptions = {
  /** Keyboard shortcut shown after the label. "mod" becomes ⌘ on Apple devices and Ctrl elsewhere. */
  hint?: string;
  side?: "right" | "bottom" | "top";
  align?: "center" | "start" | "end";
  /** Return false to skip the tooltip (for example when the label is already visible). */
  when?: () => boolean;
};

type Tip = { label: string; hint?: string; side: "right" | "bottom" | "top"; align: "center" | "start" | "end"; x: number; y: number };

const HOVER_DELAY = 380;

function formatHint(hint: string): string {
  const apple = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  return hint.replace(/mod\+?/i, apple ? "⌘" : "Ctrl ");
}

/**
 * Small text tooltips for icon-only controls. Rendered in a portal so they are
 * never clipped by a scrolling or narrow parent (such as the sidebar rail).
 *
 * The control must still carry its own `aria-label`; the tooltip is visual only.
 */
export function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setTip(null);
  }, []);

  const show = useCallback((el: Element, label: string, o: TipOptions, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    const open = () => {
      timer.current = null;
      if (!el.isConnected || (o.when && !o.when())) return;
      const r = el.getBoundingClientRect();
      const side = o.side ?? "bottom";
      const align = o.align ?? "center";
      const alongX = align === "start" ? r.left : align === "end" ? r.right : r.left + r.width / 2;
      setTip({
        label,
        hint: o.hint ? formatHint(o.hint) : undefined,
        side,
        align,
        x: side === "right" ? r.right + 10 : alongX,
        y: side === "right" ? r.top + r.height / 2 : side === "top" ? r.top - 8 : r.bottom + 8,
      });
    };
    if (delay) timer.current = setTimeout(open, delay);
    else open();
  }, []);

  // Clear a pending timer when the owner unmounts.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // A tooltip must never outlive the interaction that opened it.
  const open = tip !== null;
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  /** Spread onto the control: `<button aria-label="Search" {...tip.bind("Search", { hint: "mod+K" })}>` */
  const bind = useCallback(
    (label: string, o: TipOptions = {}) => ({
      onPointerEnter: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === "mouse") show(e.currentTarget, label, o, HOVER_DELAY);
      },
      onPointerLeave: hide,
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, label, o, 0);
      },
      onBlur: hide,
    }),
    [show, hide],
  );

  const transform =
    tip?.side === "right"
      ? "translateY(-50%)"
      : `translate(${tip?.align === "start" ? "0" : tip?.align === "end" ? "-100%" : "-50%"}, ${tip?.side === "top" ? "-100%" : "0"})`;

  const node = tip
    ? createPortal(
        <div aria-hidden="true" className="pointer-events-none fixed z-[100]" style={{ left: tip.x, top: tip.y, transform }}>
          <div className="tip-in flex items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#242424] px-2.5 py-1.5 text-[12px] font-medium leading-none text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            {tip.label}
            {tip.hint && <span className="font-normal text-neutral-400">{tip.hint}</span>}
          </div>
        </div>,
        document.body,
      )
    : null;

  return { bind, hide, node };
}
