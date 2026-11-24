import Link from "next/link";
import type { Metadata } from "next";
import { LogoMark } from "@/components/Logo";

export const metadata: Metadata = { title: { absolute: "Page not found · Bots" } };

/**
 * A wrong URL should still look like this product. Next's stock 404 is a plain
 * white page, which is jarring in an app that is otherwise all one dark surface.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--bg)] px-6">
      <div className="w-full max-w-[420px] text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <LogoMark size={30} />
        </div>
        <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.03em] text-white">This page wandered off.</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
          The link is old, or the Bot it pointed at was deleted. Nothing else is affected.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Link
            href="/"
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.97]"
          >
            Back to your bots
          </Link>
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-[13px] font-medium text-neutral-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
