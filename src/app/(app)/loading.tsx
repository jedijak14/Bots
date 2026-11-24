/**
 * Shown while a page in the app shell is loading. It mirrors the real layout —
 * header line, conversation column, composer — so the transition reads as the
 * page arriving rather than the window flashing.
 */
export default function AppLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-live="polite">
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        <span className="skeleton size-[26px] rounded-full" />
        <span className="skeleton h-3 w-24 rounded-full" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-4 pt-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4">
          <span className="skeleton h-3 w-40 rounded-full" />
          <div className="flex flex-col gap-2">
            <span className="skeleton h-3 w-[72%] rounded-full" />
            <span className="skeleton h-3 w-[58%] rounded-full" />
            <span className="skeleton h-3 w-[64%] rounded-full" />
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[820px] px-4 pb-5 sm:px-6">
        <div className="skeleton h-[104px] w-full rounded-[26px]" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
