"use client";

import { useId } from "react";
import { BRAND } from "@/lib/brand";
import { cx } from "./ui";

/**
 * The Bots mark: a rounded tile with a pair of eyes. It is the same idea as the
 * bot avatars, so the product, the app icon and every bot on screen read as one
 * family. Drawn as SVG so it stays crisp from a 16px favicon to a 160px splash.
 */
export function LogoMark({ size = 28, className, title = BRAND.name }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={cx("shrink-0", className)}
      style={{ borderRadius: (size * 9.5) / 32 }}
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="3" y1="1" x2="29" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9DBBFF" />
          <stop offset="0.55" stopColor="#7C8CFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="0.28" cy="0.12" r="0.78">
          <stop stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9.5" fill={`url(#${id}-tile)`} />
      <rect x="1" y="1" width="30" height="30" rx="9.5" fill={`url(#${id}-shine)`} />
      <rect x="1" y="1" width="30" height="30" rx="9.5" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="1" />
      <rect x="9.2" y="12.4" width="4.3" height="8.2" rx="2.15" fill="#07070A" />
      <rect x="18.5" y="12.4" width="4.3" height="8.2" rx="2.15" fill="#07070A" />
    </svg>
  );
}

/** The mark on its own, sized for small UI slots. */
export function LogoGlyph({ size = 20, className }: { size?: number; className?: string }) {
  return <LogoMark size={size} className={className} />;
}

/**
 * Mark + wordmark. Used in the sidebar, the sign-in screen and dialogs.
 * `tone="muted"` is for busy surfaces where the lockup should sit back.
 */
export function Logo({
  size = 26,
  tone = "default",
  withWordmark = true,
  className,
  wordmarkClassName,
}: {
  size?: number;
  tone?: "default" | "muted";
  withWordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} />
      {withWordmark && (
        <span
          className={cx(
            "text-[17px] font-semibold leading-none tracking-[-0.02em]",
            tone === "muted" ? "text-neutral-300" : "text-white",
            wordmarkClassName,
          )}
        >
          {BRAND.name}
        </span>
      )}
    </span>
  );
}
