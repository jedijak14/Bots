"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../ui";

export const HOME = "/home/user";

export type Entry = { name: string; path: string; type: "file" | "dir"; size: number };

export const formatSize = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${Math.round(n / 1000)} KB` : `${n} B`);

/** "/home/user/site/index.html" → "site/index.html" */
export const fromHome = (p: string) => (p === HOME ? "~" : p.startsWith(`${HOME}/`) ? p.slice(HOME.length + 1) : p);

/**
 * Loads JSON for the panel. Changing `url` shows a loading state; changing only
 * `tick` refetches quietly and keeps what is on screen until the new answer is
 * in, so a background refresh never flashes.
 */
export function useRemote<T>(url: string | null, tick: string | number = 0) {
  const [res, setRes] = useState<{ url: string; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch(url, { signal: ac.signal });
        const j = (await r.json().catch(() => ({}))) as T & { error?: string };
        if (ac.signal.aborted) return;
        setRes(r.ok ? { url, data: j, error: null } : { url, data: null, error: j.error || "Couldn't load that." });
      } catch {
        if (!ac.signal.aborted) setRes({ url, data: null, error: "Couldn't reach the server." });
      }
    })();
    return () => ac.abort();
  }, [url, tick]);

  const current = url && res?.url === url ? res : null;
  return { loading: !!url && !current, data: current?.data ?? null, error: current?.error ?? null };
}

/** A calm, centred message for the states where there is nothing to show yet. */
export function PanelState({
  icon,
  title,
  body,
  action,
  shimmer,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  shimmer?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-10 text-center", className)}>
      {icon}
      <h3 className={cx("text-[15px] font-semibold tracking-tight", icon ? "mt-5" : "", shimmer && "shimmer-text")}>{title}</h3>
      {body && <p className="mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-neutral-500">{body}</p>}
      {action && (
        <button type="button" onClick={action.onClick} disabled={action.disabled} className="mt-5 rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-95 disabled:opacity-50">
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Round badge used behind an icon in empty states. */
export function IconBadge({ children }: { children: ReactNode }) {
  return <div className="grid size-12 place-items-center rounded-full bg-[#171717] text-neutral-400">{children}</div>;
}
