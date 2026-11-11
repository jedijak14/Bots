"use client";

import useSWR from "swr";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { ComputerPanel } from "./chat/ComputerPanel";
import { Icon } from "./icons";
import { btnWhite, cx } from "./ui";

type PrivacyState = { status: "active" | "idle"; session?: { botId: string | null } };
const fetcher = async (url: string): Promise<PrivacyState> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not verify Privacy Mode.");
  return response.json();
};

export function PrivacyModeGate({ initialActive, initialBotId }: { initialActive: boolean; initialBotId: string | null }) {
  const app = useApp();
  const { data, mutate } = useSWR<PrivacyState>("/api/privacy", fetcher, {
    fallbackData: initialActive ? { status: "active", session: { botId: initialBotId } } : undefined,
    revalidateOnFocus: true,
  });
  const [dismissedInitial, setDismissedInitial] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");
  const active = data?.status === "active" || (initialActive && !dismissedInitial);
  if (!active) return null;

  const botId = data?.session?.botId ?? initialBotId;
  const bot = app.bots.find((candidate) => candidate.id === botId) ?? app.bots[0];

  async function finish() {
    setEnding(true);
    setError("");
    try {
      const response = await fetch("/api/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "done" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not end Privacy Mode.");
      setDismissedInitial(true);
      await mutate({ status: "idle" }, { revalidate: false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not end Privacy Mode.");
    } finally { setEnding(false); }
  }

  return <main role="dialog" aria-modal="true" aria-labelledby="privacy-mode-title" className="fixed inset-0 z-[100] flex flex-col bg-[#09090b]">
    <header className="flex min-h-[68px] items-center gap-3 border-b border-white/[0.08] px-5">
      <div className="grid size-9 place-items-center rounded-full bg-amber-300/10 text-amber-200"><Icon name="lock" size={16} /></div>
      <div className="min-w-0 flex-1"><h1 id="privacy-mode-title" className="text-sm font-semibold text-amber-100">Privacy Mode</h1><p className="text-xs text-amber-100/60">The Bot is paused and cannot see or interact with the sandbox.</p></div>
      <button type="button" autoFocus onClick={() => void finish()} disabled={ending} className={cx(btnWhite, "shrink-0 px-3.5 py-2 text-xs")}>{ending ? "Resuming…" : "I'm Done"}</button>
    </header>
    {error && <p role="alert" className="px-5 pt-3 text-sm text-rose-300">{error}</p>}
    <p className="px-5 py-3 text-xs text-neutral-500">After you press Take Control, I will go into Privacy Mode. Only you can interact with the sandbox while the Bot is paused.</p>
    {bot ? <div className="relative min-h-0 flex-1"><ComputerPanel botId={bot.id} hasE2b={app.settings.hasE2bKey} mode="computer" agentBusy={false} externalShot={null} expanded onToggleExpand={() => {}} onClose={() => {}} onOpenSettings={() => {}} privateMode /></div> : <div className="grid flex-1 place-items-center text-sm text-neutral-500">Open a Bot to choose its sandbox before taking control.</div>}
  </main>;
}
