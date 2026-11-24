"use client";

import useSWR from "swr";
import { useState } from "react";
import type { GoalStatus } from "@/lib/goals";
import { useApp } from "./AppProvider";
import { Icon, Spinner } from "./icons";
import { btnGhost, btnWhite, cx, inputCls } from "./ui";

type Goal = {
  id: string;
  title: string;
  detail: string;
  status: GoalStatus;
  botId: string | null;
  dueAt: string | null;
  createdAt: string;
};

const fetcher = async (url: string): Promise<Goal[]> => {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Couldn't load your goals.");
  return body;
};

const STATUS_LABEL: Record<GoalStatus, string> = { open: "Open", doing: "In progress", done: "Done" };

function relative(date: string): string {
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

/**
 * The goal list every Bot shares. Anything added here is in the system prompt
 * of every conversation, and a Bot can add or complete goals with its own tool,
 * so this is the one place the whole picture lives.
 */
export function GoalsPanel({ compact = false }: { compact?: boolean }) {
  const app = useApp();
  const { data, error, isLoading, mutate } = useSWR("/api/goals", fetcher, { revalidateOnFocus: true });
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function add() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, detail }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Couldn't add that goal.");
      setTitle("");
      setDetail("");
      await mutate();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Couldn't add that goal.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(goal: Goal, status: GoalStatus) {
    // Optimistic: the list is small and the click should feel instant.
    await mutate(
      (current) => current?.map((g) => (g.id === goal.id ? { ...g, status } : g)),
      { revalidate: false },
    );
    const response = await fetch(`/api/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (!response?.ok) {
      app.toast("Couldn't update that goal.", "err");
      await mutate();
    }
  }

  async function remove(goal: Goal) {
    const ok = await app.confirm({
      title: "Remove this goal?",
      body: `“${goal.title}” will be taken off every Bot's list.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await mutate(
      (current) => current?.filter((g) => g.id !== goal.id),
      { revalidate: false },
    );
    await fetch(`/api/goals/${goal.id}`, { method: "DELETE" }).catch(() => null);
  }

  const goals = data ?? [];
  const live = goals.filter((goal) => goal.status !== "done");
  const done = goals.filter((goal) => goal.status === "done");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-neutral-500">
        <Spinner size={13} /> Loading goals…
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-[12.5px] text-[#ff9aa5]">
        {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className={cx("rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3", compact && "p-2.5")}
      >
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What do you want to get done?"
            aria-label="New goal"
            className={cx(inputCls, "py-2 text-[13.5px]")}
          />
          <button type="submit" disabled={!title.trim() || busy} className={cx(btnWhite, "shrink-0 px-3 py-2 text-[12.5px]")}>
            {busy ? <Spinner size={13} /> : "Add"}
          </button>
        </div>
        {!compact && title.trim() && (
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Any detail a Bot should know — acceptance criteria, links, what done looks like."
            aria-label="Goal detail"
            rows={2}
            className={cx(inputCls, "mt-2 resize-none py-2 text-[13px]")}
          />
        )}
        {actionError && <p role="alert" className="mt-2 text-[12px] text-[#ff9aa5]">{actionError}</p>}
      </form>

      {!goals.length ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-8 text-center">
          <div className="mx-auto grid size-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-neutral-400">
            <Icon name="sparkles" size={15} />
          </div>
          <p className="mt-3 text-[13px] font-medium text-neutral-300">No goals yet</p>
          <p className="mx-auto mt-1 max-w-[320px] text-[12.5px] leading-relaxed text-neutral-500">
            Add one above, or just tell a Bot what you are working towards — it will write it down here and every other Bot will know.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {live.map((goal) => (
            <GoalRow key={goal.id} goal={goal} onStatus={setStatus} onRemove={remove} />
          ))}
          {done.length > 0 && (
            <details className="group pt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 py-1 text-[11.5px] font-medium text-neutral-600 transition hover:text-neutral-400">
                <Icon name="chevron" size={10} className="transition-transform group-open:rotate-180" />
                {done.length} finished
              </summary>
              <div className="mt-1.5 space-y-1.5">
                {done.map((goal) => (
                  <GoalRow key={goal.id} goal={goal} onStatus={setStatus} onRemove={remove} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function GoalRow({
  goal,
  onStatus,
  onRemove,
}: {
  goal: Goal;
  onStatus: (goal: Goal, status: GoalStatus) => Promise<void>;
  onRemove: (goal: Goal) => Promise<void>;
}) {
  const finished = goal.status === "done";
  return (
    <div className="group flex items-start gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.015] px-2.5 py-2 transition hover:border-white/10 hover:bg-white/[0.035]">
      <button
        type="button"
        role="checkbox"
        aria-checked={finished}
        aria-label={finished ? `Reopen ${goal.title}` : `Complete ${goal.title}`}
        onClick={() => void onStatus(goal, finished ? "open" : "done")}
        className={cx(
          "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border transition",
          finished ? "border-emerald-400/40 bg-emerald-400/20 text-emerald-300" : "border-white/20 text-transparent hover:border-white/40 hover:text-white/40",
        )}
      >
        <Icon name="check" size={11} />
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx("text-[13px] leading-snug", finished ? "text-neutral-600 line-through" : "text-neutral-200")}>{goal.title}</div>
        {goal.detail && <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-500">{goal.detail}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-600">
          {!finished && (
            <button
              type="button"
              onClick={() => void onStatus(goal, goal.status === "doing" ? "open" : "doing")}
              className={cx(
                "rounded-full px-1.5 py-0.5 transition",
                goal.status === "doing" ? "bg-[#7c9bff]/15 text-[#a8c0ff]" : "hover:bg-white/[0.06] hover:text-neutral-400",
              )}
            >
              {STATUS_LABEL[goal.status]}
            </button>
          )}
          {goal.dueAt && <span title={new Date(goal.dueAt).toLocaleDateString()}>Due {relative(goal.dueAt)}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onRemove(goal)}
        aria-label={`Remove ${goal.title}`}
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg text-neutral-600 opacity-0 transition hover:bg-white/[0.06] hover:text-neutral-300 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}
