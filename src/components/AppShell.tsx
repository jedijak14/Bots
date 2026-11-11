"use client";

import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import useSWR from "swr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { BotDTO } from "@/lib/bots";
import { SIDEBAR_COOKIE } from "@/lib/ui-state";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { BotDialog } from "./BotDialog";
import { Menu, placeMenu, type MenuItem, type MenuPosition } from "./Menu";
import { SearchDialog } from "./SearchDialog";
import { SettingsDialog } from "./SettingsDialog";
import { PrivacyModeGate } from "./PrivacyModeGate";
import { useTooltip } from "./Tooltip";
import { Icon } from "./icons";
import { btnDanger, btnGhost, btnWhite, cx, Modal } from "./ui";

const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;

export function AppShell({ children, initialCollapsed = false, initialPrivacyMode = false, privacyBotId = null }: { children: ReactNode; initialCollapsed?: boolean; initialPrivacyMode?: boolean; privacyBotId?: string | null }) {
  const app = useApp();
  const { setSearchOpen, sidebarOpen, setSidebarOpen } = app;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const { data: privacy } = useSWR<{ status: "active" | "idle" }>("/api/privacy", async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not verify Privacy Mode.");
    return response.json();
  }, { fallbackData: initialPrivacyMode ? { status: "active" } : undefined, revalidateOnFocus: true });
  const privacyActive = privacy?.status === "active";

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  // Remembered in a cookie (not localStorage) so the server can render the right width straight away.
  useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (k === "b") {
        e.preventDefault();
        if (isDesktop()) toggleCollapsed();
        else setSidebarOpen(!sidebarOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen, setSidebarOpen, sidebarOpen, toggleCollapsed]);

  return (
    <>
    <div className="relative flex h-dvh overflow-hidden bg-[#0a0a0a]" inert={privacyActive} aria-hidden={privacyActive}>
      {/* mobile sidebar scrim */}
      <div
        aria-hidden="true"
        onClick={() => setSidebarOpen(false)}
        className={cx("absolute inset-0 z-30 bg-black/60 transition-opacity duration-300 md:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}
      />
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <main className="relative flex min-w-0 flex-1 flex-col bg-[#0a0a0a]">{children}</main>

      {app.botDialog && <BotDialog key={app.botDialog.id ?? "new"} botId={app.botDialog.id} />}
      {app.settingsTab && <SettingsDialog />}
      {app.searchOpen && <SearchDialog />}
      {app.confirmState && <ConfirmDialog />}

      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-[90] flex flex-col items-center gap-2 px-4">
        {app.toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "toast-in pointer-events-auto max-w-full rounded-full border px-4 py-2.5 text-[13px] shadow-xl",
              t.kind === "err" ? "border-[#5a1f26] bg-[#2a1215] text-[#ff8b98]" : "border-white/10 bg-[#1d1d1d] text-white",
            )}
            role={t.kind === "err" ? "alert" : "status"}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
    <PrivacyModeGate initialActive={initialPrivacyMode} initialBotId={privacyBotId} />
    </>
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

function RoundBtn({ label, className, children, ...rest }: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx("grid size-9 shrink-0 place-items-center rounded-full bg-[#1a1a1a] text-neutral-300 hover:bg-[#262626] hover:text-white active:scale-90", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/*
 * Sidebar geometry. Collapsing only changes the width: avatars and the
 * left-hand buttons stay exactly where they are, labels are clipped rather than
 * re-flowed, and the right-hand buttons ride the edge in and tuck under (or
 * over) their neighbour. Nothing pops or jumps.
 *
 *   expanded 288px · rail 68px (= 16 + 36 + 16) · buttons 36px · avatars 30px at x=19
 */
const MOVE = "transition-[translate,right,background-color,color,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
const SIZE = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

type RowMenu = { bot: BotDTO; position: MenuPosition; trigger: HTMLElement | null };

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const app = useApp();
  const { setSidebarOpen } = app;
  const router = useRouter();
  const pathname = usePathname();
  const activeId = pathname.startsWith("/bot/") ? pathname.split("/")[2] : null;
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const tip = useTooltip();

  // Close the mobile drawer after navigating.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Rail-only tooltip: when the sidebar is open the label is already on screen. */
  const railTip = (label: string) => tip.bind(label, { side: "right", when: () => collapsed && isDesktop() });
  /** Tooltip for the icon buttons: beside them in the rail, below them otherwise. */
  const btnTip = (label: string, hint?: string, align: "start" | "center" | "end" = "center") =>
    tip.bind(label, collapsed ? { hint, side: "right", when: isDesktop } : { hint, side: "bottom", align, when: isDesktop });

  async function clearChat(b: BotDTO) {
    if (!(await app.confirm({ title: `Archive chat with ${b.name}?`, body: "This starts a fresh conversation, but safely saves the current chat to History.", confirmLabel: "Archive & clear", danger: true }))) return;
    const res = await fetch(`/api/bots/${b.id}/messages`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      app.toast("Couldn't archive that conversation.", "err");
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { archived?: boolean; preview?: string };
    if (j.preview) app.setPreview(b.id, j.preview);
    app.toast(j.archived ? "Conversation archived. A fresh chat is ready." : "A fresh chat is ready.");
    if (b.id === activeId) router.refresh();
  }

  async function deleteBot(b: BotDTO) {
    const ok = await app.confirm({
      title: `Delete ${b.name}?`,
      body: "This permanently deletes the bot, its conversation, and shuts down its computer.",
      confirmLabel: "Delete bot",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/bots/${b.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      app.toast(`Couldn't delete ${b.name}.`, "err");
      return;
    }
    if (b.id === activeId) router.push("/");
    app.removeBot(b.id);
    app.toast(`${b.name} was deleted.`);
  }

  const menuItems = (b: BotDTO): MenuItem[] => [
    { label: "Edit look & name", icon: "pencil", onSelect: () => app.openBotDialog(b.id) },
    { label: "Clear conversation", icon: "eraser", onSelect: () => void clearChat(b) },
    { label: "Delete bot", icon: "trash", danger: true, onSelect: () => void deleteBot(b) },
  ];

  const openMenuFromButton = (b: BotDTO, el: HTMLElement) => {
    tip.hide();
    if (menu?.bot.id === b.id) return setMenu(null);
    setMenu({ bot: b, position: placeMenu(el.getBoundingClientRect(), 3), trigger: el });
  };
  const openMenuAtPointer = (b: BotDTO, e: MouseEvent) => {
    e.preventDefault();
    tip.hide();
    const at = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
    setMenu({ bot: b, position: placeMenu(at, 3, { align: "start", gap: 2 }), trigger: null });
  };

  const initial = (app.user.displayName || app.user.email).charAt(0).toUpperCase();
  const needsKey = !app.settings.hasAiKey;
  const label = cx("min-w-0 flex-1 transition-opacity duration-200 motion-reduce:transition-none", collapsed && "md:opacity-0");
  const row = (active: boolean) =>
    cx(
      "flex items-center gap-3 overflow-hidden rounded-xl pl-[9px] pr-2 outline-offset-[-2px] transition-colors",
      active ? "bg-white/[0.08]" : "hover:bg-white/[0.045]",
    );

  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      className={cx(
        "z-40 flex w-[288px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[#0c0c0c] transition-[width,translate,visibility]",
        SIZE,
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:max-w-[88vw] max-md:shadow-[20px_0_60px_rgba(0,0,0,0.5)]",
        collapsed && "md:w-[68px]",
        app.sidebarOpen ? "max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full",
      )}
    >
      {/* Top: toggle on the left, Search and New on the right. In the rail the two fold down under the toggle. */}
      <div className={cx("relative shrink-0 transition-[height]", SIZE, collapsed ? "h-[64px] md:h-[152px]" : "h-[64px]")}>
        <RoundBtn
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          aria-keyshortcuts="Control+B Meta+B"
          onClick={onToggle}
          className={cx("absolute left-4 top-[14px] max-md:hidden", MOVE)}
          {...btnTip(collapsed ? "Expand sidebar" : "Collapse sidebar", "mod+B", "start")}
        >
          <Icon name="sidebar" size={17} />
        </RoundBtn>
        <RoundBtn label="Close sidebar" onClick={() => setSidebarOpen(false)} className={cx("absolute left-4 top-[14px] md:hidden", MOVE)}>
          <Icon name="close" size={17} />
        </RoundBtn>
        <RoundBtn
          label="Search"
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => app.setSearchOpen(true)}
          className={cx("absolute right-[60px] top-[14px]", MOVE, collapsed && "md:right-4 md:translate-y-[44px]")}
          {...btnTip("Search", "mod+K")}
        >
          <Icon name="search" size={17} />
        </RoundBtn>
        <RoundBtn
          label="New bot"
          onClick={() => app.openBotDialog(null)}
          className={cx("absolute right-4 top-[14px]", MOVE, collapsed && "md:translate-y-[88px]")}
          {...btnTip("New bot", undefined, "end")}
        >
          <Icon name="plus" size={18} />
        </RoundBtn>
      </div>

      <nav
        aria-label="Bots"
        onScroll={() => {
          tip.hide();
          closeMenu();
        }}
        className={cx("min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-[10px] pb-3", collapsed && "md:[scrollbar-width:none]")}
      >
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined} aria-label="All bots" className={cx(row(pathname === "/"), "h-11")} {...railTip("All bots")}>
          <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[#1d1d1d] text-neutral-300">
            <Icon name="grid" size={15} />
          </span>
          <span className={cx(label, "truncate text-[14px] font-medium")}>All bots</span>
        </Link>

        {app.bots.map((b) => {
          const active = b.id === activeId;
          const working = app.working?.id === b.id;
          const menuOpen = menu?.bot.id === b.id;
          return (
            <div key={b.id} className="group relative">
              <Link
                href={`/bot/${b.id}`}
                aria-current={active ? "page" : undefined}
                aria-label={b.name}
                onContextMenu={(e) => openMenuAtPointer(b, e)}
                className={cx(row(active || menuOpen), "h-[52px]", app.celebrateId === b.id && "pop-in")}
                {...railTip(working ? `${b.name} · ${app.working?.label}` : b.name)}
              >
                <BotAvatar shape={b.shape} color={b.color} size={30} working={working} celebrate={app.celebrateId === b.id} />
                <span className={cx(label, "group-focus-within:pr-7 group-hover:pr-7 max-md:pr-7", menuOpen && "pr-7")}>
                  <span className="block truncate text-[14px] font-medium leading-tight">{b.name}</span>
                  <span className={cx("mt-[3px] block truncate text-[12.5px] leading-tight", working ? "shimmer-text" : "text-neutral-500")}>{working ? app.working?.label : b.preview}</span>
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Options for ${b.name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={(e) => openMenuFromButton(b, e.currentTarget)}
                className={cx(
                  "absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white",
                  menuOpen ? "bg-white/10 text-white opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100",
                  collapsed && "md:hidden",
                )}
              >
                <Icon name="dots" size={16} />
              </button>
            </div>
          );
        })}

        {!app.bots.length && (
          <button
            type="button"
            onClick={() => app.openBotDialog(null)}
            className={cx(
              "!mt-3 w-full rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[13px] text-neutral-500 transition hover:border-white/20 hover:text-neutral-300",
              collapsed && "md:hidden",
            )}
          >
            Create your first Bot
          </button>
        )}
      </nav>

      {/* Bottom: you on the left, Settings on the right. In the rail Settings sits above your picture. */}
      <div className={cx("relative shrink-0 border-t border-white/[0.05] transition-[height]", SIZE, collapsed ? "h-[64px] md:h-[108px]" : "h-[64px]")}>
        <button
          type="button"
          onClick={() => app.openSettings(needsKey ? "ai" : "preferences")}
          aria-label={needsKey ? "Settings, add an AI key to get started" : "Settings"}
          className={cx(
            "absolute bottom-[14px] right-4 grid size-9 place-items-center rounded-full bg-[#1a1a1a] text-neutral-300 hover:bg-[#262626] hover:text-white active:scale-90",
            MOVE,
            collapsed && "md:translate-y-[-44px]",
          )}
          {...btnTip(needsKey ? "Settings · add an AI key" : "Settings", undefined, "end")}
        >
          <Icon name="gear" size={17} />
          {needsKey && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-[#0c0c0c] bg-amber-400" />}
        </button>
        <button
          type="button"
          onClick={() => app.openSettings("account")}
          aria-label={`Account: ${app.user.displayName || app.user.email}`}
          className={cx("absolute bottom-[14px] left-4 flex h-9 items-center gap-2.5 overflow-hidden rounded-full text-left transition-[right,opacity] hover:opacity-80", SIZE, collapsed ? "right-[60px] md:right-4" : "right-[60px]")}
          {...railTip("Account")}
        >
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#3a3f66] to-[#1d2038] text-[14px] font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded blob of unknown size */}
            {app.user.avatarUrl ? <img src={app.user.avatarUrl} alt="" className="size-full object-cover" /> : initial}
          </span>
          <span className={cx(label, "truncate pr-2 text-[14px] font-medium")}>{app.user.displayName || app.user.email}</span>
        </button>
      </div>

      {menu && <Menu label={`Options for ${menu.bot.name}`} items={menuItems(menu.bot)} position={menu.position} trigger={menu.trigger} onClose={closeMenu} />}
      {tip.node}
    </aside>
  );
}
