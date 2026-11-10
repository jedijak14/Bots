"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BotDTO } from "@/lib/bots";
import { previewText } from "@/lib/preview";
import type { PublicSettings } from "@/lib/settings";
import { PrefsContext } from "./prefs";

export type AppUser = { id: string; email: string; displayName: string; avatarUrl: string | null };
export type SettingsTab = "account" | "ai" | "computer" | "connections" | "skills" | "preferences" | "data";
type ConfirmOpts = { title: string; body: string; confirmLabel?: string; danger?: boolean };
type Toast = { id: number; msg: string; kind: "ok" | "err" };

type AppCtx = {
  user: AppUser;
  setUserName: (n: string) => void;
  setUserAvatar: (url: string | null) => void;
  bots: BotDTO[];
  addBot: (b: BotDTO) => void;
  upsertBot: (b: Partial<BotDTO> & { id: string }) => void;
  removeBot: (id: string) => void;
  setPreview: (id: string, text: string) => void;
  celebrateId: string | null;
  /** The bot that is busy right now, and what it is doing (shown in the sidebar). */
  working: { id: string; label: string } | null;
  setWorking: (w: { id: string; label: string } | null) => void;
  settings: PublicSettings;
  setSettings: (s: PublicSettings) => void;
  patchSettings: (p: Partial<Pick<PublicSettings, "followMouse" | "animations" | "voiceReplies" | "defaultModel">>) => Promise<void>;
  botDialog: { id: string | null } | null;
  openBotDialog: (id?: string | null) => void;
  closeBotDialog: () => void;
  settingsTab: SettingsTab | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
  toasts: Toast[];
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  confirmState: (ConfirmOpts & { resolve: (v: boolean) => void }) | null;
  setConfirmState: (v: (ConfirmOpts & { resolve: (v: boolean) => void }) | null) => void;
};

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function AppProvider({
  user,
  bots: initialBots,
  settings: initialSettings,
  children,
}: {
  user: AppUser;
  bots: BotDTO[];
  settings: PublicSettings;
  children: ReactNode;
}) {
  const [bots, setBots] = useState(initialBots);
  const [settings, setSettings] = useState(initialSettings);
  const [name, setName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  const [working, setWorkingState] = useState<AppCtx["working"]>(null);
  const [botDialog, setBotDialog] = useState<{ id: string | null } | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<AppCtx["confirmState"]>(null);
  const toastId = useRef(0);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const patchSettings = useCallback<AppCtx["patchSettings"]>(
    async (p) => {
      const prev = settings;
      setSettings((s) => ({ ...s, ...p }));
      try {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        if (!res.ok) throw new Error();
        setSettings(await res.json());
      } catch {
        setSettings(prev);
        toast("Couldn't save that setting.", "err");
      }
    },
    [settings, toast],
  );

  const setWorking = useCallback<AppCtx["setWorking"]>((w) => {
    setWorkingState((cur) => (cur?.id === w?.id && cur?.label === w?.label ? cur : w));
  }, []);

  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })),
    [],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("connection");
    if (!result) return;
    url.searchParams.delete("connection");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    const timer = window.setTimeout(() => {
      setSettingsTab("connections");
      toast(result === "failed" ? "Connection failed or was cancelled. Please try again." : `${result === "gmail" ? "Gmail" : result === "github" ? "GitHub" : "YouTube"} connected.`, result === "failed" ? "err" : "ok");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // A session can expire while the tab stays open. Every API call then answers
  // 401, so send the user back to the sign-in page instead of leaving them
  // sitting in a shell that can no longer do anything.
  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : "";
      if (res.status === 401 && !url.includes("/api/auth/")) {
        window.location.assign("/login");
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  const value = useMemo<AppCtx>(
    () => ({
      user: { ...user, displayName: name, avatarUrl },
      setUserName: setName,
      setUserAvatar: setAvatarUrl,
      bots,
      addBot: (b) => {
        setBots((l) => [...l, b]);
        setCelebrateId(b.id);
        setTimeout(() => setCelebrateId((c) => (c === b.id ? null : c)), 4000);
      },
      upsertBot: (b) => setBots((l) => l.map((x) => (x.id === b.id ? { ...x, ...b } : x))),
      removeBot: (id) => setBots((l) => l.filter((x) => x.id !== id)),
      setPreview: (id, text) =>
        setBots((l) =>
          l.map((x) =>
            x.id === id
              ? { ...x, preview: previewText(text) || x.preview }
              : x,
          ),
        ),
      celebrateId,
      working,
      setWorking,
      settings,
      setSettings,
      patchSettings,
      botDialog,
      openBotDialog: (id = null) => setBotDialog({ id }),
      closeBotDialog: () => setBotDialog(null),
      settingsTab,
      openSettings: (tab = "ai") => setSettingsTab(tab),
      closeSettings: () => setSettingsTab(null),
      searchOpen,
      setSearchOpen,
      sidebarOpen,
      setSidebarOpen,
      toast,
      toasts,
      confirm,
      confirmState,
      setConfirmState,
    }),
    [user, name, avatarUrl, bots, celebrateId, working, setWorking, settings, patchSettings, botDialog, settingsTab, searchOpen, sidebarOpen, toast, toasts, confirm, confirmState],
  );

  return (
    <Ctx.Provider value={value}>
      <PrefsContext.Provider value={{ followMouse: settings.followMouse, animations: settings.animations }}>
        {children}
      </PrefsContext.Provider>
    </Ctx.Provider>
  );
}
