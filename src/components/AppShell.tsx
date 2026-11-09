"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { BotDTO } from "@/lib/bots";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { BotDialog } from "./BotDialog";
import { SearchDialog } from "./SearchDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Icon } from "./icons";
import { btnDanger, btnGhost, btnWhite, cx, Modal } from "./ui";

export function AppShell({ children }: { children: ReactNode }) {
  const app = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        app.setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex h-dvh overflow-hidden bg-[#0a0a0a]">
      {/* mobile sidebar scrim */}
      {app.sidebarOpen && <div className="absolute inset-0 z-30 bg-black/60 md:hidden" onClick={() => app.setSidebarOpen(false)} />}
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col bg-[#0a0a0a]">{children}</main>

      {app.botDialog && <BotDialog key={app.botDialog.id ?? "new"} botId={app.botDialog.id} />}
      {app.settingsTab && <SettingsDialog />}
      {app.searchOpen && <SearchDialog />}
      {app.confirmState && <ConfirmDialog />}

      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[90]">
        {app.toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto absolute bottom-0 left-1/2 rounded-full border px-4 py-2.5 text-[13px] shadow-xl",
              t.kind === "err" ? "border-[#5a1f26] bg-[#2a1215] text-[#ff8b98]" : "border-white/10 bg-[#1d1d1d] text-white",
            )}
            style={{ animation: "toast-in .3s ease-out both" }}
            role="status"
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmDialog() {
  const app = useApp();
  const c = app.confirmState!;
  const close = (v: boolean) => {
    c.resolve(v);
    app.setConfirmState(null);
  };
  return (
    <Modal onClose={() => close(false)} width={380} label={c.title} z={80}>
      <div className="p-6">
        <h3 className="text-[16px] font-semibold">{c.title}</h3>
        <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-400">{c.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button className={btnGhost} onClick={() => close(false)}>
            Cancel
          </button>
          <button className={c.danger ? btnDanger : btnWhite} onClick={() => close(true)} autoFocus>
            {c.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RoundBtn({ label, onClick, children, className }: { label: string; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx("grid size-9 shrink-0 place-items-center rounded-full bg-[#1a1a1a] text-neutral-300 transition hover:bg-[#262626] hover:text-white active:scale-90", className)}
    >
      {children}
    </button>
  );
}

function Sidebar() {
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const activeId = pathname.startsWith("/bot/") ? pathname.split("/")[2] : null;
  const [menu, setMenu] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    app.setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  async function clearChat(b: BotDTO) {
    if (!(await app.confirm({ title: `Clear chat with ${b.name}?`, body: "All messages in this conversation will be deleted.", confirmLabel: "Clear", danger: true }))) return;
    const res = await fetch(`/api/bots/${b.id}/messages`, { method: "DELETE" });
    if (res.ok) {
      app.toast("Conversation cleared.");
      window.location.assign(`/bot/${b.id}`);
    }
  }

  const initial = (app.user.displayName || app.user.email).charAt(0).toUpperCase();

  return (
    <aside
      className={cx(
        "z-40 flex shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c0c] transition-[width,transform] duration-300 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:w-[290px]",
        collapsed ? "w-[76px]" : "w-[300px]",
        app.sidebarOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      <div className={cx("flex items-center gap-2 pb-3 pt-4", collapsed ? "flex-col px-3" : "px-4")}>
        <RoundBtn label="All bots" onClick={() => router.push("/")} className={pathname === "/" ? "!bg-[#2a2a2a] text-white" : ""}>
          <Icon name="grid" size={17} />
        </RoundBtn>
        {!collapsed && <RoundBtn label="Collapse sidebar" onClick={() => setCollapsed(true)}>
          <Icon name="chevron-left" size={16} />
        </RoundBtn>}
        {collapsed && <RoundBtn label="Expand sidebar" onClick={() => setCollapsed(false)}>
          <Icon name="chevron-right" size={16} />
        </RoundBtn>}
        {!collapsed && <RoundBtn label="Search (Ctrl+K)" onClick={() => app.setSearchOpen(true)}>
          <Icon name="search" size={17} />
        </RoundBtn>}
        {!collapsed && <RoundBtn label="New bot" onClick={() => app.openBotDialog(null)}>
          <Icon name="plus" size={18} />
        </RoundBtn>}
      </div>

      <nav className={cx("min-h-0 flex-1 space-y-0.5 overflow-y-auto py-1", collapsed ? "px-2" : "px-3")} aria-label="Bots">
        {app.bots.map((b) => {
          const active = b.id === activeId;
          return (
            <div key={b.id} className="group relative">
              <Link
                href={`/bot/${b.id}`}
                title={collapsed ? b.name : undefined}
                className={cx(
                  "flex items-center gap-3 rounded-xl py-2.5 transition",
                  collapsed ? "justify-center px-2" : "px-2.5",
                  active ? "bg-[#171717]" : "hover:bg-[#131313]",
                  app.celebrateId === b.id && "pop-in",
                )}>
                <BotAvatar shape={b.shape} color={b.color} size={30} celebrate={app.celebrateId === b.id} />
                {!collapsed && <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium leading-tight">{b.name}</span>
                  <span className="mt-0.5 block truncate pr-5 text-[12.5px] leading-tight text-neutral-500">{b.preview}</span>
                </span>}
              </Link>
              {!collapsed && <button
                aria-label={`Options for ${b.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === b.id ? null : b.id);
                }}
                className={cx(
                  "absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white",
                  menu === b.id ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100",
                )}
              >
                <Icon name="dots" size={16} />
              </button>}
              {menu === b.id && !collapsed && (
                <div className="modal-in absolute right-2 top-[calc(50%+16px)] z-20 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#1b1b1b] p-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  {[{ l: "Edit look & name", i: "pencil", f: () => app.openBotDialog(b.id) }, { l: "Clear conversation", i: "eraser", f: () => clearChat(b) }].map((m) => (
                    <button key={m.l} onClick={() => { setMenu(null); m.f(); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-neutral-200 transition hover:bg-white/[0.07]">
                      <Icon name={m.i} size={15} /> {m.l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!app.bots.length && (
          <button onClick={() => app.openBotDialog(null)} className="mt-2 w-full rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[13px] text-neutral-500 transition hover:border-white/20 hover:text-neutral-300">
            Create your first Bot
          </button>
        )}
      </nav>

      <div className={cx("flex items-center gap-2.5 border-t border-white/[0.04] py-3.5", collapsed ? "flex-col px-3" : "px-4")}>
        <button onClick={() => app.openSettings("account")} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full text-left transition hover:opacity-80" aria-label="Account settings">
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#3a3f66] to-[#1d2038] text-[14px] font-semibold">{app.user.avatarUrl ? <img src={app.user.avatarUrl} alt="" className="size-full object-cover" /> : initial}</span>
          {!collapsed && <span className="truncate text-[14px] font-medium">{app.user.displayName}</span>}
        </button>
        {!collapsed && <RoundBtn label="All bots" onClick={() => router.push("/")}>
          <Icon name="grid" size={16} />
        </RoundBtn>}
        <button
          onClick={() => app.openSettings(app.settings.hasAiKey ? "preferences" : "ai")}
          aria-label="Settings"
          title="Settings"
          className="relative grid size-9 shrink-0 place-items-center rounded-full bg-[#2b7fff] text-white transition hover:brightness-110 active:scale-90"
        >
          <Icon name="gear" size={17} />
          {!app.settings.hasAiKey && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-[#0c0c0c] bg-amber-400" />}
        </button>
      </div>
    </aside>
  );
}
