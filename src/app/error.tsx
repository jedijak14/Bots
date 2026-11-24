"use client";

import Link from "next/link";
import { useEffect } from "react";
import { LogoMark } from "@/components/Logo";

/**
 * Shown when a page throws on the client. It keeps the shell's look and gives
 * people the two things that actually help: try again, or go home. The error
 * itself is only summarised — a stack trace is noise to whoever hit it.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] px-6">
      <div className="w-full max-w-[440px] text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <LogoMark size={30} />
        </div>
        <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.03em] text-white">Something broke on the way here.</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
          Your bots and conversations are fine — this was only the page. Try again, and if it keeps happening the
          deployment needs a look.
        </p>
        {error.digest && <p className="mt-3 font-mono text-[11.5px] text-neutral-600">Reference {error.digest}</p>}
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.97]"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full px-4 py-2 text-[13px] font-medium text-neutral-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            Back to your bots
          </Link>
        </div>
      </div>
    </main>
  );
}
