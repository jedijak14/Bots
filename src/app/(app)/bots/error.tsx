"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The gallery's own boundary. A Bot list that fails to render should not take
 * the rail with it — and it is the most likely thing to fail, because it is
 * what every session opens on.
 */
export default function GalleryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6">
      <div className="max-w-[380px] text-center">
        <h1 className="text-[19px] font-semibold text-white">Your bots didn&apos;t load</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-500">
          They are still saved. This was only the list — try again, or open one from the sidebar.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={reset} className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black hover:bg-neutral-200">
            Try again
          </button>
          <Link href="/" className="rounded-full px-4 py-2 text-[13px] font-medium text-neutral-400 hover:text-white">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
