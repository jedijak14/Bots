"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";

/**
 * The error boundary inside the app shell.
 *
 * Without this, a single throwing component unmounted the whole route — the
 * sidebar, the Bot list and the composer all disappeared and the page looked
 * like the app had never loaded, with no way back. Keeping the recovery here
 * means the failure is contained to the main pane and the rail still works.
 */
export default function AppPaneError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-16">
      <div className="w-full max-w-[420px] text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-neutral-400">
          <Icon name="info" size={22} />
        </div>
        <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-white">This view didn&apos;t load</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-500">
          The rest of the app is still here — your Bots and conversations are untouched. Try this view again, or pick a Bot
          from the sidebar.
        </p>
        {error.digest && <p className="mt-3 font-mono text-[11px] text-neutral-600">Reference {error.digest}</p>}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.97]"
          >
            Try again
          </button>
          <Link
            href="/bots"
            className="rounded-full px-4 py-2 text-[13px] font-medium text-neutral-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            Your bots
          </Link>
        </div>
      </div>
    </div>
  );
}
