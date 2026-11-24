import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * The one card shape every settings tab uses.
 *
 * Before this, each tab invented its own row layout: some were bordered
 * panels, some bare text floating in the panel, some a 2xl box — so Settings
 * read like five different apps stacked behind one sidebar. A Card has a
 * title, an optional description, an optional trailing action, and content.
 */
export function Card({
  title,
  desc,
  action,
  icon,
  children,
  className,
  tone = "default",
}: {
  title?: string;
  desc?: string;
  action?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "default" | "danger" | "warn";
}) {
  return (
    <section
      className={cx(
        "rounded-2xl border p-3.5 sm:p-4",
        tone === "default" && "border-white/[0.07] bg-white/[0.02]",
        tone === "warn" && "border-amber-300/15 bg-amber-300/[0.04]",
        tone === "danger" && "border-rose-400/15 bg-rose-500/[0.03]",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-start gap-3">
          {icon && <div className="grid size-8 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-neutral-300">{icon}</div>}
          <div className="min-w-0 flex-1">
            {title && <h4 className="text-[13.5px] font-semibold leading-snug text-white">{title}</h4>}
            {desc && <p className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-500">{desc}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children && <div className={cx(Boolean(title || action) && "mt-3.5")}>{children}</div>}
    </section>
  );
}

/** A page title + one-line purpose, identical on every tab. */
export function TabHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <header className="mb-5">
      <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{title}</h3>
      <p className="mt-1 max-w-[560px] text-[13px] leading-relaxed text-neutral-500">{desc}</p>
    </header>
  );
}

/**
 * A compact stat used in the "at a glance" strip at the top of Settings, where
 * it is also a shortcut to the tab that owns it.
 */
export function StatChip({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <span
        className={cx(
          "size-1.5 shrink-0 rounded-full",
          tone === "good" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : "bg-neutral-600",
        )}
      />
      <span className="text-[11.5px] text-neutral-500">{label}</span>
      <span className="ml-auto truncate text-[12px] font-medium text-neutral-300">{value}</span>
    </div>
  );
}
