"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";

export type MenuItem = {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type MenuPosition = { left: number; top: number; origin: string };

export const MENU_WIDTH = 208;
const ITEM_H = 36;
const PAD = 5;
const EDGE = 8;

/**
 * Works out where a menu should open so it always stays on screen: below the
 * trigger when there is room, above it otherwise. Call this in the event
 * handler that opens the menu.
 */
export function placeMenu(
  anchor: { left: number; right: number; top: number; bottom: number },
  itemCount: number,
  opts: { width?: number; align?: "start" | "end"; gap?: number } = {},
): MenuPosition {
  const width = opts.width ?? MENU_WIDTH;
  const gap = opts.gap ?? 6;
  const height = itemCount * ITEM_H + PAD * 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wanted = opts.align === "start" ? anchor.left : anchor.right - width;
  const left = Math.max(EDGE, Math.min(wanted, vw - width - EDGE));
  const below = anchor.bottom + gap;
  const fitsBelow = below + height <= vh - EDGE;
  const top = fitsBelow ? below : Math.max(EDGE, anchor.top - gap - height);
  return { left, top, origin: `${opts.align === "start" ? "left" : "right"} ${fitsBelow ? "top" : "bottom"}` };
}

/**
 * A small popup menu rendered in a portal (so a scrolling parent can't clip
 * it). Closes on outside press, Escape, scroll, resize and Tab; arrow keys move
 * between items; focus returns to the trigger on Escape.
 */
export function Menu({
  label,
  items,
  position,
  onClose,
  trigger,
  width = MENU_WIDTH,
}: {
  label: string;
  items: MenuItem[];
  position: MenuPosition;
  onClose: () => void;
  trigger?: HTMLElement | null;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const outside = (e: Event) => {
      const t = e.target as Node | null;
      if (t && ref.current?.contains(t)) return;
      // Pressing the trigger again should toggle, not close-then-reopen.
      if (t && trigger?.contains(t)) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        trigger?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, trigger]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      buttons[(n + buttons.length) % buttons.length].focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(buttons.length - 1);
    else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
      trigger?.focus({ preventScroll: true });
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="menu-in fixed z-[95] rounded-xl border border-white/10 bg-[#1c1c1c] shadow-[0_18px_50px_rgba(0,0,0,0.6)]"
      style={{ left: position.left, top: position.top, width, padding: PAD, transformOrigin: position.origin }}
    >
      {items.map((m) => (
        <button
          key={m.label}
          role="menuitem"
          disabled={m.disabled}
          onClick={() => {
            onClose();
            m.onSelect();
          }}
          style={{ height: ITEM_H }}
          className={cx(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] outline-none transition-colors disabled:opacity-40",
            m.danger ? "text-[#ff7a88] hover:bg-[#ff5c6c]/10 focus-visible:bg-[#ff5c6c]/10" : "text-neutral-200 hover:bg-white/[0.07] focus-visible:bg-white/[0.07]",
          )}
        >
          {m.icon && <Icon name={m.icon} size={15} className="shrink-0 opacity-80" />}
          <span className="truncate">{m.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
