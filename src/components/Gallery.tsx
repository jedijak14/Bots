"use client";

import { useRouter } from "next/navigation";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { Icon } from "./icons";
import { cx } from "./ui";

export function Gallery() {
  const app = useApp();
  const router = useRouter();
  const s = app.settings;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="relative flex h-[68px] shrink-0 items-center justify-center px-4">
        <button onClick={() => app.setSidebarOpen(true)} aria-label="Open sidebar" className="absolute left-4 grid size-9 place-items-center rounded-full bg-[#1a1a1a] text-neutral-300 md:hidden">
          <Icon name="menu" size={17} />
        </button>
        <h1 className="text-[15px] font-medium">{app.bots.length ? "Your Bots" : "Welcome"}</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-24">
        {app.bots.length ? (
          <div className="flex max-w-full flex-wrap items-start justify-center gap-x-12 gap-y-10">
            {app.bots.map((b, i) => (
              <button
                key={b.id}
                onClick={() => router.push(`/bot/${b.id}`)}
                className="group fade-up flex w-[120px] flex-col items-center gap-3 rounded-2xl p-2 outline-offset-4"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="relative transition duration-200 group-hover:-translate-y-1 group-hover:scale-110 group-active:scale-95">
                  <BotAvatar shape={b.shape} color={b.color} size={80} celebrate={app.celebrateId === b.id} />
                  <span
                    className={cx("absolute bottom-0 right-[-2px] size-[13px] rounded-full border-2 border-[#0a0a0a]", s.hasAiKey ? "bg-[#3b8cff]" : "bg-neutral-600")}
                    title={s.hasAiKey ? "Ready" : "Add an API key to wake this bot up"}
                  />
                </span>
                <span className="max-w-full truncate text-[13px] text-neutral-200">{b.name}</span>
              </button>
            ))}
            <button onClick={() => app.openBotDialog(null)} className="group fade-up flex w-[120px] flex-col items-center gap-3 rounded-2xl p-2" style={{ animationDelay: `${app.bots.length * 60}ms` }}>
              <span className="grid size-[80px] place-items-center rounded-full border border-dashed border-white/20 text-neutral-500 transition duration-200 group-hover:-translate-y-1 group-hover:scale-110 group-hover:border-white/40 group-hover:text-white">
                <Icon name="plus" size={26} />
              </span>
              <span className="text-[13px] text-neutral-500 transition group-hover:text-neutral-300">New Bot</span>
            </button>
          </div>
        ) : (
          <div className="fade-up flex max-w-md flex-col items-center text-center">
            <div className="flex items-end gap-5">
              <BotAvatar shape="heart" color="blue" size={74} />
              <BotAvatar shape="circle" color="white" size={96} />
              <BotAvatar shape="sparkle" color="red" size={74} />
            </div>
            <h2 className="mt-9 text-[26px] font-semibold tracking-tight">Make your first Bot</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-neutral-400">
              Pick a shape and a color, give it a name, and start chatting. Every bot keeps its own conversation — and its own computer.
            </p>
            <button onClick={() => app.openBotDialog(null)} className="mt-7 rounded-full bg-white px-6 py-3 text-[14px] font-semibold text-black transition hover:bg-neutral-200 active:scale-95">
              Create a Bot
            </button>
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-5 flex flex-wrap items-center justify-center gap-2 px-4">
        <button
          onClick={() => app.openSettings("ai")}
          className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#121212] px-3.5 py-2 text-[12.5px] text-neutral-400 transition hover:bg-[#191919] hover:text-white"
        >
          <span className={cx("size-1.5 rounded-full", s.hasAiKey ? "bg-emerald-400" : "bg-amber-400")} />
          {s.hasAiKey ? `AI: ${s.aiProviderLabel}` : "Add your AI key"}
        </button>
        <button
          onClick={() => app.openSettings("computer")}
          className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#121212] px-3.5 py-2 text-[12.5px] text-neutral-400 transition hover:bg-[#191919] hover:text-white"
        >
          <span className={cx("size-1.5 rounded-full", s.hasE2bKey ? "bg-emerald-400" : "bg-neutral-600")} />
          {s.hasE2bKey ? "Computer: E2B connected" : "Add E2B key for a computer"}
        </button>
      </div>
    </div>
  );
}
