"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../AppProvider";
import { BotAvatar } from "../BotAvatar";
import { Icon } from "../icons";
import { cx } from "../ui";

type Brief = {
  greeting: string;
  headline: string;
  openGoals: { id: string; title: string; status: string; dueAt: string | null }[];
  dueToday: number;
  overdue: number;
  working: { botId: string; botName: string; shape: string; color: string; preview: string | null; at: string | null }[];
  recent: { id: string; title: string; kind: string; at: string }[];
};

/**
 * The brief a good assistant gives before you ask.
 *
 * It reads what the app already knows — open goals, the last thing each Bot was
 * doing, work saved recently — so it appears at once and costs no tokens. Each
 * row is a real control: a goal opens the goals list, a Bot opens that chat with
 * the sentence already typed.
 */
export function BriefCard() {
  const app = useApp();
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [failed, setFailed] = useState(false);
  // Anchored once, when the data arrives, rather than read during render.
  const [now] = useState(() => Date.now());
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/brief")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Brief) => {
        if (alive) setBrief(j);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // A brief that is still loading, or that failed, should not leave a hole in
  // the page — the composer and the suggestions are enough on their own.
  if (failed || !brief) return null;

  const quiet = !brief.openGoals.length && !brief.working.length && !brief.recent.length;
  if (quiet && !brief.dueToday && !brief.overdue) return null;

  async function finish(id: string) {
    // Remove it from the list at once — the tick should feel instant — and put
    // it back if the request did not take.
    setDone((d) => [...d, id]);
    try {
      const res = await fetch(`/api/goals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setDone((d) => d.filter((x) => x !== id));
      app.toast("Could not update that goal.");
    }
  }

  const due = (iso: string | null) => {
    if (!iso) return null;
    const when = new Date(iso);
    const days = Math.round((when.getTime() - now) / 86_400_000);
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    return when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <section aria-label="Brief" className="fade-up mt-8 w-full max-w-[560px] rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 text-left">
      {/* Side by side when there is room; stacked when the phone would
          otherwise break both lines in half. */}
      <div className="flex flex-col gap-0.5 px-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <p className="text-[13px] font-medium text-white">{brief.greeting}.</p>
        <p className="text-[11.5px] leading-snug text-neutral-500 sm:text-right">{brief.headline}</p>
      </div>

      {!!brief.openGoals.length && (
        <div className="mt-2.5 space-y-0.5">
          {brief.openGoals
            .filter((g) => !done.includes(g.id))
            .slice(0, 3)
            .map((goal) => {
            const when = due(goal.dueAt);
            return (
              <div
                key={goal.id}
                className="group flex items-center gap-2 rounded-lg pr-1 transition hover:bg-white/[0.05] focus-within:bg-white/[0.05]"
              >
                <button
                  onClick={() => app.openSettings("goals")}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-1.5 text-left"
                >
                  <span
                    aria-hidden
                    className={cx(
                      "size-1.5 shrink-0 rounded-full",
                      when === "overdue" ? "bg-rose-400" : goal.status === "doing" ? "bg-[#7c9bff]" : "bg-neutral-600",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-300">{goal.title}</span>
                  {when && (
                    <span className={cx("shrink-0 text-[11px] group-focus-within:hidden group-hover:hidden", when === "overdue" ? "text-rose-300/90" : "text-neutral-600")}>{when}</span>
                  )}
                </button>
                {/* Closing a loop is the one action an assistant should be able
                    to finish for you, and it belongs next to the thing. */}
                <button
                  aria-label={`Mark "${goal.title}" done`}
                  title="Mark done"
                  onClick={() => void finish(goal.id)}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-neutral-600 opacity-0 transition hover:bg-white/10 hover:text-emerald-300 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  <Icon name="check" size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!!brief.working.length && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-2.5">
          {brief.working.map((bot) => (
            <button
              key={bot.botId}
              onClick={() => router.push(`/bots/${bot.botId}`)}
              title={bot.preview ?? undefined}
              className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/[0.07] py-1 pl-1 pr-2.5 text-[11.5px] text-neutral-400 transition hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-white"
            >
              <BotAvatar shape={bot.shape} color={bot.color} size={16} follow={false} />
              <span className="truncate">{bot.botName}</span>
            </button>
          ))}
          {!!brief.recent.length && (
            <button
              onClick={() => app.openSettings("artifacts")}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11.5px] text-neutral-500 transition hover:bg-white/[0.05] hover:text-white"
            >
              <Icon name="archive" size={11} />
              Saved this week
            </button>
          )}
        </div>
      )}
    </section>
  );
}
