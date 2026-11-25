"use client";

import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import useSWR from "swr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { BotDTO } from "@/lib/bots";
import { SIDEBAR_COOKIE } from "@/lib/ui-state";
import { signOutAction } from "@/lib/auth-actions";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { BotDialog } from "./BotDialog";
import { LogoMark } from "./Logo";
import { Menu, placeMenu, type MenuItem, type MenuPosition } from "./Menu";
import { SearchDialog } from "./SearchDialog";
import { SettingsDialog } from "./SettingsDialog";
import { PrivacyModeGate } from "./PrivacyModeGate";
import { ThemeSync } from "./ThemeSync";
import { useTooltip } from "./Tooltip";
import { Icon } from "./icons";
import { btnDanger, btnGhost, btnWhite, cx, Kbd, Modal } from "./ui";

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
      <div className="relative flex h-dvh overflow-hidden bg-[var(--app-canvas)] text-white transition-colors" inert={privacyActive} aria-hidden={privacyActive}>
        {/* Keyboard users can jump the 12-stop sidebar straight to the page. */}
        <a
          href="#main"
          className="sr-only z-[100] rounded-full bg-white px-4 py-2 text-[13px] font-medium leading-none text-black outline-none focus-visible:not-sr-only focus-visible:absolute focus-visible:left-1/2 focus-visible:top-3 focus-visible:z-[100] focus-visible:-translate-x-1/2 focus-visible:inline-flex focus-visible:h-8 focus-visible:items-center"
        >
          Skip to content
        </a>
        {/* mobile sidebar scrim */}
        <div
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
          className={cx("absolute inset-0 z-30 bg-black/70 backdrop-blur-sm transition-opacity duration-300 md:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        />
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        <main id="main" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col outline-none">{children}</main>

        {app.botDialog && <BotDialog key={app.botDialog.id ?? "new"} botId={app.botDialog.id} />}
        {app.settingsTab && <SettingsDialog />}
        {app.searchOpen && <SearchDialog />}
        {app.confirmState && <ConfirmDialog />}

        {/* Toasts sit under the top bar, not over the composer: an "Email sent."
            pill used to land right on top of the message box. */}
        <div className="pointer-events-none absolute inset-x-0 top-16 z-[90] flex flex-col items-center gap-2 px-4">
          {app.toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                "toast-in pointer-events-auto max-w-full rounded-full border px-4 py-2.5 text-[13px] shadow-xl",
                t.kind === "err" ? "border-[#5a1f26] bg-[#2a1215] text-[#ff8b98]" : "border-white/10 bg-[#212126] text-white",
              )}
              role={t.kind === "err" ? "alert" : "status"}
            >
              {t.msg}
            </div>
          ))}
        </div>
      </div>
      <ThemeSync />
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
    <Modal onClose={() => close(false)} width={390} label={c.title} z={80}>
      <div className="p-6">
        <h3 className="text-[16px] font-semibold tracking-tight">{c.title}</h3>
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

/**
 * How many goals are still open, shown next to the Goals row. SWR keeps it
 * fresh after any Bot or the panel changes the list.
 */
function OpenGoalCount({ collapsed }: { collapsed: boolean }) {
  const { data } = useSWR<Array<{ status: string }>>("/api/goals", async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? response.json() : [];
  });
  const open = data?.filter((goal) => goal.status !== "done").length ?? 0;
  if (!open) return null;
  return (
    <span
      className={cx(
        "shrink-0 rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-neutral-400",
        collapsed && "md:hidden",
      )}
    >
      {open}
    </span>
  );
}

function RailButton({ label, className, children, ...rest }: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/[0.07] hover:text-white active:scale-90",
        className,
      )}
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
 *   expanded 288px · rail 68px (= 16 + 36 + 16) · buttons 36px · avatars 28px
 */
const MOVE = "transition-[translate,right,background-color,color,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
const SIZE = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

type RowMenu = { bot: BotDTO; position: MenuPosition; trigger: HTMLElement | null };
type AcctMenu = { position: MenuPosition; trigger: HTMLElement };

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const app = useApp();
  const { setSidebarOpen } = app;
  const router = useRouter();
  const pathname = usePathname();
  const activeId = pathname.startsWith("/bots/") ? pathname.split("/")[2] : null;
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [acct, setAcct] = useState<AcctMenu | null>(null);
  const tip = useTooltip();

  // Close the mobile drawer after navigating.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeAcct = useCallback(() => setAcct(null), []);

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
    if (b.id === activeId) router.push("/bots");
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

  const needsKey = !app.settings.hasAiKey;
  const label = cx("min-w-0 flex-1 truncate transition-opacity duration-200 motion-reduce:transition-none", collapsed && "md:opacity-0");
  const row = (active: boolean) =>
    cx(
      "flex items-center gap-2.5 overflow-hidden outline-offset-[-2px] transition-colors",
      // Collapsed, the row is just a 28px face, so a full-height padded row drew
      // a 47x50 hover bubble around a 28px avatar — bigger than the bot it was
      // labelling. The rail row becomes a square just large enough to sit the
      // face on, so the highlight reads as a halo around the Bot.
      collapsed ? "mx-auto size-9 justify-center rounded-[10px] px-0" : "h-11 rounded-xl pl-2 pr-2",
      active ? "bg-white/[0.08] text-white" : "text-neutral-300 hover:bg-white/[0.045] hover:text-white",
    );

  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      className={cx(
        "z-40 flex w-[288px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[var(--surface-1)] transition-[width,translate,visibility]",
        SIZE,
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:max-w-[88vw] max-md:shadow-[20px_0_60px_rgba(0,0,0,0.5)]",
        collapsed && "md:w-[68px]",
        app.sidebarOpen ? "max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full",
      )}
    >
      {/* Brand + collapse. In the rail the mark itself is the expand control. */}
      <div className={cx("relative flex h-16 shrink-0 items-center gap-2 px-4", collapsed && "md:justify-center md:px-0")}>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
          className="grid size-9 shrink-0 place-items-center rounded-full text-neutral-300 hover:bg-white/[0.07] md:hidden"
        >
          <Icon name="close" size={17} />
        </button>

        {/* Mobile always shows the full lockup; the rail is a desktop-only idea. */}
        <Link href="/bots" aria-label="Bots home" className="flex min-w-0 items-center gap-2 rounded-lg outline-offset-4 md:hidden">
          <LogoMark size={24} />
          <span className="text-[16px] font-semibold tracking-[-0.02em] text-white">Bots</span>
        </Link>

        <Link
          href="/bots"
          aria-label="Bots home"
          className={cx("hidden min-w-0 items-center gap-2 rounded-lg outline-offset-4 md:flex", collapsed && "md:hidden")}
        >
          <LogoMark size={24} />
          <span className="text-[16px] font-semibold tracking-[-0.02em] text-white">Bots</span>
        </Link>

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          aria-keyshortcuts="Control+B Meta+B"
          className={cx(
            "hidden size-9 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/[0.07] hover:text-white active:scale-90 md:grid",
            !collapsed && "md:ml-auto",
            MOVE,
          )}
          {...(collapsed ? btnTip("Expand sidebar", "mod+B", "start") : btnTip("Collapse sidebar", "mod+B", "end"))}
        >
          <Icon name="sidebar" size={17} />
        </button>
      </div>

      {/* Search */}
      <div className={cx("shrink-0 px-2.5", collapsed && "md:px-0 md:text-center")}>
        <button
          type="button"
          onClick={() => app.setSearchOpen(true)}
          aria-label="Search"
          aria-keyshortcuts="Control+K Meta+K"
          className={cx(
            "flex h-10 w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.035] text-[13.5px] text-neutral-400 transition hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-neutral-200",
            collapsed && "md:w-9 md:justify-center md:border-0 md:bg-transparent md:px-0 md:hover:bg-white/[0.07]",
          )}
        >
          <Icon name="search" size={16} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search</span>
              <Kbd>⌘K</Kbd>
            </>
          )}
        </button>
      </div>

      {/* New bot */}
      <div className={cx("mt-1.5 shrink-0 px-2.5", collapsed && "md:px-0")}>
        <button
          type="button"
          onClick={() => app.openBotDialog(null)}
          className={cx(
            "flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.08] text-[13.5px] font-medium text-white transition hover:bg-white/[0.14] active:scale-[0.98]",
            collapsed && "md:w-9 md:rounded-full md:bg-transparent md:hover:bg-white/[0.07]",
          )}
          aria-label="New bot"
        >
          <Icon name="plus" size={17} />
          <span className={cx(collapsed && "md:hidden")}>New bot</span>
        </button>
      </div>

      {/* Goals — shared with every Bot, one click from anywhere */}
      <div className={cx("mt-1.5 shrink-0 px-2.5", collapsed && "md:px-0")}>
        <button
          type="button"
          onClick={() => app.openSettings("goals")}
          className={cx(
            "group flex h-9 w-full items-center gap-2 rounded-xl px-2 text-[13px] text-neutral-400 transition hover:bg-white/[0.06] hover:text-white",
            collapsed && "md:w-9 md:justify-center md:px-0",
          )}
          aria-label="Goals"
          {...railTip("Goals")}
        >
          <Icon name="target" size={15} className="shrink-0 text-neutral-500 transition group-hover:text-[#a8c0ff]" />
          <span className={cx("min-w-0 flex-1 truncate text-left", collapsed && "md:hidden")}>Goals</span>
          <OpenGoalCount collapsed={collapsed} />
        </button>
      </div>

      <nav aria-label="Bots" onScroll={() => { tip.hide(); closeMenu(); }} className={cx("mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2.5 pb-3", collapsed && "md:[scrollbar-width:none]")}>
        <div className={cx("flex items-center justify-between px-2 pb-1.5 pt-1.5", collapsed && "md:hidden")}>
            <Link href="/" aria-label="Home" className="text-[11px] font-medium uppercase tracking-[0.09em] text-neutral-500 transition hover:text-neutral-300">
              Your bots
            </Link>
          <span className="text-[11px] tabular-nums text-neutral-600">{app.bots.length || ""}</span>
        </div>
        <Link
          href="/bots"
          aria-current={pathname === "/bots" ? "page" : undefined}
          aria-label="All bots"
          className={cx(row(pathname === "/bots"))}
          {...railTip("All bots")}
        >
          <span className={cx("grid size-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-neutral-300")}>
            <Icon name="grid" size={15} />
          </span>
          <span className={cx(label, "text-[13.5px] font-medium")}>All bots</span>
        </Link>

        {app.bots.map((b) => {
          const active = b.id === activeId;
          const working = app.working?.id === b.id;
          const menuOpen = menu?.bot.id === b.id;
          return (
            <div key={b.id} className="group relative">
              <Link
                href={`/bots/${b.id}`}
                aria-current={active ? "page" : undefined}
                aria-label={b.name}
                onContextMenu={(e) => openMenuAtPointer(b, e)}
                // Bot rows carry two lines of text when the rail is open, so they
                // are taller than the one-line rows — but not collapsed, where
                // the row is a halo around the face alone.
                className={cx(row(active || menuOpen), !collapsed && "h-[50px]", app.celebrateId === b.id && "pop-in")}
                {...railTip(working ? `${b.name} · ${app.working?.label}` : b.name)}
              >
                <BotAvatar shape={b.shape} color={b.color} size={28} working={working} celebrate={app.celebrateId === b.id} />
                <span className={cx(label, "group-focus-within:pr-6 group-hover:pr-6 max-md:pr-6", menuOpen && "pr-6")}>
                  <span className="block truncate text-[13.5px] font-medium leading-tight">{b.name}</span>
                  <span className={cx("mt-[2px] block truncate text-[11.5px] leading-tight", working ? "shimmer-text" : "text-neutral-500")}>
                    {working ? app.working?.label : b.preview}
                  </span>
                </span>
                {working && <span className="absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-[#7c9bff] max-md:hidden" />}
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
              "!mt-2 w-full rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-[12.5px] text-neutral-500 transition hover:border-white/20 hover:text-neutral-300",
              collapsed && "md:hidden",
            )}
          >
            Create your first Bot
          </button>
        )}
      </nav>

      {/* Bottom: you on the left, settings on the right. In the rail settings sits above your picture. */}
      <div className={cx("relative shrink-0 border-t border-white/[0.05]", collapsed ? "h-[116px] max-md:h-[64px]" : "h-[64px]")}>
        <button
          type="button"
          onClick={() => app.openSettings(needsKey ? "ai" : "preferences")}
          aria-label={needsKey ? "Settings, add an AI key to get started" : "Settings"}
          className={cx(
            "absolute bottom-[14px] right-4 grid size-9 place-items-center rounded-full text-neutral-400 transition hover:bg-white/[0.07] hover:text-white active:scale-90",
            collapsed && "md:bottom-[68px] max-md:bottom-[14px]",
            MOVE,
          )}
          {...btnTip(needsKey ? "Settings · add an AI key" : "Settings", undefined, "end")}
        >
          <Icon name="gear" size={17} />
          {needsKey && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-[#08080a] bg-amber-400" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            tip.hide();
            if (acct) return setAcct(null);
            setAcct({ position: placeMenu(e.currentTarget.getBoundingClientRect(), 3, { align: "start", gap: 6 }), trigger: e.currentTarget });
          }}
          aria-label={`Account: ${app.user.displayName || app.user.email}`}
          aria-haspopup="menu"
          aria-expanded={!!acct}
          className={cx(
            "absolute bottom-[14px] left-4 flex h-9 items-center gap-2.5 overflow-hidden rounded-full text-left transition-opacity hover:opacity-85",
            collapsed && "md:right-4",
            !collapsed && "right-[60px]",
          )}
          {...railTip("Account")}
        >
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#3a3f66] to-[#1d2038] text-[13px] font-semibold text-white">
            {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded blob of unknown size */}
            {app.user.avatarUrl ? <img src={app.user.avatarUrl} alt="" className="size-full object-cover" /> : (app.user.displayName || app.user.email).charAt(0).toUpperCase()}
          </span>
          <span className={cx(label, "pr-1 text-[13.5px] font-medium")}>{app.user.displayName || app.user.email}</span>
        </button>
      </div>

      {menu && <Menu label={`Options for ${menu.bot.name}`} items={menuItems(menu.bot)} position={menu.position} trigger={menu.trigger} onClose={closeMenu} />}
      {acct && (
        <Menu
          label="Account"
          items={[
            { label: "Account settings", icon: "gear", onSelect: () => app.openSettings("account") },
            { label: "Connections", icon: "link", onSelect: () => app.openSettings("connections") },
            { label: "Sign out", icon: "logout", onSelect: () => void signOutAction() },
          ]}
          position={acct.position}
          trigger={acct.trigger}
          onClose={closeAcct}
        />
      )}
      {tip.node}
    </aside>
  );
}
