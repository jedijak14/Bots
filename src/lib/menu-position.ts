export const MENU_ITEM_HEIGHT = 36;
export const MENU_PADDING = 5;
export const MENU_EDGE = 8;

/** Keep even a very tall or wide menu within the visible viewport. */
export function menuPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  itemCount: number,
  viewport: { width: number; height: number },
  opts: { width: number; align?: "start" | "end"; gap?: number },
) {
  const edge = MENU_EDGE;
  const width = Math.max(0, Math.min(opts.width, viewport.width - 2 * edge));
  const height = Math.max(0, Math.min(itemCount * MENU_ITEM_HEIGHT + MENU_PADDING * 2, viewport.height - 2 * edge));
  const gap = opts.gap ?? 6;
  const wanted = opts.align === "start" ? anchor.left : anchor.right - width;
  const left = Math.max(edge, Math.min(wanted, viewport.width - width - edge));
  const below = anchor.bottom + gap;
  const fitsBelow = below + height <= viewport.height - edge;
  const preferredTop = fitsBelow ? below : anchor.top - gap - height;
  const top = Math.max(edge, Math.min(preferredTop, viewport.height - height - edge));
  return { left, top, origin: `${opts.align === "start" ? "left" : "right"} ${fitsBelow ? "top" : "bottom"}` };
}
