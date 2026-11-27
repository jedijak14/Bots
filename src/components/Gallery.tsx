"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { Icon } from "./icons";
import { LogoMark } from "./Logo";
import { Menu, placeMenu, type MenuItem, type MenuPosition } from "./Menu";
import { Pill, cx } from "./ui";

type Bot = ReturnType<typeof useApp>["bots"][number];

export function Gallery() {
  const app = useApp();
  const router = useRouter();
  const s = app.settings;
  const bots = app.bots;
  const [menu, setMenu] = useState<{ bot: Bot; position: MenuPosition; trigger: HTMLElement } | null>(null);

  const items = (bot: Bot): MenuItem[] => [
    { label: "Open", icon: "arrow-right", onSelect: () => router.push(`/bots/${bot.id}`) },
    { label: "Edit look & name", icon: "pencil", onSelect: () => app.openBotDialog(bot.id) },
    {
      label: "Delete",
      icon: "trash",
      danger: true,
      onSelect: async () => {
        const ok = await app.confirm({
          title: `Delete ${bot.name}?`,
          body: "Its conversation and artifacts go with it. This can't be undone.",
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        const response = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
        if (response.ok) {
          app.removeBot(bot.id);
          app.toast(`${bot.name} deleted.`);
        } else {
          app.toast("Couldn't delete that bot.", "err");
        }
      },
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="relative z-10 flex h-16 shrink-0 items-center gap-2 px-4 sm:px-6">
        <button onClick={() => app.setSidebarOpen(true)} aria-label="Open sidebar" className="grid size-9 place-items-center rounded-full text-neutral-300 transition hover:bg-white/[0.07] md:hidden">
          <Icon name="menu" size={18} />
        </button>
        <div className="flex items-center gap-2 md:hidden">
          <LogoMark size={22} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Bots</span>
        </div>
        <h1 className="hidden text-[15px] font-medium text-neutral-200 md:block">Your bots</h1>
        <div className="flex-1" />
        <button
          onClick={() => app.openBotDialog(null)}
          className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-white/[0.14] active:scale-[0.98]"
        >
          <Icon name="plus" size={15} />
          <span className="max-sm:sr-only">New bot</span>
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {/* soft brand glow behind the grid */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-140px] h-[380px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(124,140,255,0.10),transparent)] blur-2xl" />

        <div className="relative mx-auto w-full max-w-[960px] px-5 pb-28 pt-4 sm:px-8">
          {bots.length ? (
            <>
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-[13px] text-neutral-500">Each one keeps its own conversation, memory and computer.</p>
                <Pill tone="neutral" className="hidden shrink-0 sm:inline-flex">
                  {bots.length} {bots.length === 1 ? "bot" : "bots"}
                </Pill>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {bots.map((b, i) => (
                  <div
                    key={b.id}
                    className="group fade-up relative min-w-0 rounded-[20px] border border-white/[0.07] bg-white/[0.025] transition duration-200 focus-within:border-white/[0.18] hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.05]"
                    style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                  >
                    {/* The whole card is one big target, kept as a sibling of the
                        options button so it is never a button inside a button. */}
                    <button
                      type="button"
                      onClick={() => router.push(`/bots/${b.id}`)}
                      className="absolute inset-0 z-0 rounded-[20px] outline-none"
                      aria-label={`Open ${b.name}`}
                    />
                    <div className="pointer-events-none relative z-10 flex min-w-0 flex-col items-start p-4">
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="transition duration-200 group-hover:scale-105">
                          <BotAvatar shape={b.shape} color={b.color} size={46} celebrate={app.celebrateId === b.id} />
                        </span>
                        <button
                          type="button"
                          aria-label={`Options for ${b.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menu?.bot.id === b.id}
                          onClick={(e) => {
                            setMenu({ bot: b, position: placeMenu(e.currentTarget.getBoundingClientRect(), 3, { align: "end" }), trigger: e.currentTarget });
                          }}
                          className="pointer-events-auto -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-neutral-500 opacity-0 transition hover:bg-white/[0.1] hover:text-white focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100"
                        >
                          <Icon name="dots" size={15} />
                        </button>
                      </div>
                      <span className="mt-3 w-full truncate text-[14px] font-medium text-white">{b.name}</span>
                      <span className="mt-0.5 line-clamp-2 w-full text-[12px] leading-snug text-neutral-500">{b.preview}</span>
                      <span className="mt-3 flex items-center gap-1.5 text-[11px] text-neutral-600">
                        <span className={cx("size-1.5 rounded-full", s.hasAiKey || s.preferOrbitLocal ? "bg-[#7c9bff]" : "bg-neutral-700")} />
                        {s.preferOrbitLocal ? "Bots Local · Beta" : s.hasAiKey ? "Ready" : "Choose an AI provider"}
                      </span>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => app.openBotDialog(null)}
                  className="group fade-up flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-white/10 p-4 text-neutral-500 transition duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.02] hover:text-white active:scale-[0.99]"
                  style={{ animationDelay: `${Math.min(bots.length, 8) * 45}ms` }}
                >
                  <span className="grid size-11 place-items-center rounded-full border border-white/15 transition group-hover:border-white/30">
                    <Icon name="plus" size={19} />
                  </span>
                  <span className="text-[12.5px] font-medium">New bot</span>
                </button>
              </div>
            </>
          ) : (
            <div className="fade-up mx-auto flex max-w-[520px] flex-col items-center pt-[10vh] text-center">
              <div className="relative">
                <div aria-hidden className="absolute inset-0 -z-10 scale-[2.2] rounded-full bg-[radial-gradient(closest-side,rgba(124,140,255,0.22),transparent)] blur-2xl" />
                <LogoMark size={88} className="float-y" />
              </div>
              <h2 className="mt-8 text-[32px] font-semibold tracking-[-0.035em] text-white">Make your first Bot</h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-neutral-400">
                Pick a shape and a color, give it a name, and start chatting. Every bot keeps its own conversation — and its own computer.
              </p>
              <button
                onClick={() => app.openBotDialog(null)}
                className="mt-8 flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-semibold text-black transition hover:bg-neutral-200 active:scale-95"
              >
                <Icon name="plus" size={16} strokeWidth={2.4} />
                Create a Bot
              </button>
              <div className="mt-10 flex items-end gap-4 opacity-70">
                <BotAvatar shape="heart" color="blue" size={54} follow={false} />
                <BotAvatar shape="sparkle" color="purple" size={70} follow={false} />
                <BotAvatar shape="square" color="green" size={54} follow={false} />
              </div>
            </div>
          )}

          {/* Below the grid: the parts of the workspace that are not a single
              Bot. These were only reachable from the account menu, which made
              the gallery feel like the whole product. */}
          <div className="mt-10">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-neutral-500">Everything else</span>
              <span aria-hidden className="h-px flex-1 bg-white/[0.06]" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: "AI Provider", hint: "Bots Local Beta & more", icon: "sparkles" as const, tab: "ai" as const },
                { label: "Goals", hint: "Shared with every Bot", icon: "target" as const, tab: "goals" as const },
                { label: "Artifacts", hint: "Work your Bots saved", icon: "archive" as const, tab: "artifacts" as const },
                { label: "History", hint: "Cleared conversations", icon: "clock" as const, tab: "history" as const },
                { label: "Connections", hint: "Accounts they can use", icon: "link" as const, tab: "connections" as const },
              ].map((item, i) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => app.openSettings(item.tab)}
                  style={{ animationDelay: `${Math.min(bots.length, 8) * 30 + i * 30}ms` }}
                  className="fade-up group flex flex-col items-start gap-2 rounded-[16px] border border-white/[0.06] bg-white/[0.018] p-3 text-left transition hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.045] active:scale-[0.99]"
                >
                  <span className="grid size-8 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-neutral-300 transition group-hover:text-white">
                    <Icon name={item.icon} size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-neutral-200">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {menu && <Menu label={`Options for ${menu.bot.name}`} items={items(menu.bot)} position={menu.position} trigger={menu.trigger} onClose={() => setMenu(null)} />}

      {/* On a phone these sat on top of the last shortcut card, so they are
          desktop-only and the scroll column reserves room for them. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 hidden flex-wrap items-center justify-center gap-2 px-4 md:flex">
        <button
          onClick={() => app.openSettings("ai")}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#101013]/90 px-3.5 py-2 text-[12px] text-neutral-400 backdrop-blur transition hover:bg-[#19191d] hover:text-white"
        >
          <span className={cx("size-1.5 rounded-full", s.hasAiKey || s.preferOrbitLocal ? "bg-emerald-400" : "bg-amber-400")} />
          {s.preferOrbitLocal ? "AI · Bots Local Beta" : s.hasAiKey ? `AI · ${s.aiProviderLabel}` : "Choose AI provider"}
        </button>
        <button
          onClick={() => app.openSettings("computer")}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#101013]/90 px-3.5 py-2 text-[12px] text-neutral-400 backdrop-blur transition hover:bg-[#19191d] hover:text-white"
        >
          <span className={cx("size-1.5 rounded-full", s.hasE2bKey ? "bg-emerald-400" : "bg-neutral-700")} />
          {s.hasE2bKey ? "Computer · connected" : "Add E2B key for a computer"}
        </button>
      </div>
    </div>
  );
}
