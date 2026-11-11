"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { BotDTO } from "@/lib/bots";
import { Icon } from "../icons";
import { Menu, placeMenu, type MenuPosition } from "../Menu";
import { useTooltip } from "../Tooltip";
import { cx } from "../ui";
import { ComputerFiles } from "./ComputerFiles";
import { ComputerPreview } from "./ComputerPreview";
import { ComputerScreen } from "./ComputerScreen";
import { useComputer, type ComputerPhase } from "./useComputer";

export type ComputerTab = "screen" | "files" | "preview";

const TABS: { id: ComputerTab; label: string }[] = [
  { id: "screen", label: "Screen" },
  { id: "files", label: "Files" },
  { id: "preview", label: "Preview" },
];

const WIDTH_KEY = "bots.computer-panel-width";
const MIN_WIDTH = 360;
/** Room always left for the conversation next to the panel. */
const MIN_CHAT = 380;
const DEFAULT_WIDTH = "clamp(380px, 46%, 680px)";

function storedWidth(): number | null {
  try {
    const n = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : null;
  } catch {
    return null;
  }
}

/**
 * The bot's computer, beside the conversation: its screen, its files and a
 * preview of pages it has built. One panel, three tabs, and as few controls as
 * the job needs.
 */
export function ComputerPanel({
  bot,
  hasE2b,
  tab,
  onTab,
  agentBusy,
  activity,
  externalShot,
  expanded,
  onToggleExpand,
  onClose,
  onOpenSettings,
  onPhase,
  onError,
  privateMode = false,
}: {
  bot: Pick<BotDTO, "id" | "name" | "shape" | "color">;
  hasE2b: boolean;
  privateMode?: boolean;
  tab: ComputerTab;
  onTab: (t: ComputerTab) => void;
  agentBusy: boolean;
  /** What the bot is doing right now, shown above the screen. */
  activity: string | null;
  externalShot: { n: number; data: string } | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onPhase: (phase: ComputerPhase) => void;
  onError: (message: string) => void;
}) {
  const [control, setControl] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [width, setWidth] = useState<number | null>(storedWidth);
  const [menu, setMenu] = useState<{ position: MenuPosition; trigger: HTMLElement } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startW: number; max: number } | null>(null);
  const tip = useTooltip();

  const computer = useComputer({
    botId: bot.id,
    enabled: hasE2b,
    watching: tab === "screen",
    inControl: control,
    agentBusy,
    externalShot,
    onActionError: onError,
    privateMode,
  });
  const { phase } = computer;

  // The person only holds the controls while the screen is live and the bot is idle.
  if (control && (agentBusy || phase !== "on" || tab !== "screen")) setControl(false);

  useEffect(() => {
    onPhase(phase);
  }, [phase, onPhase]);

  // Esc leaves the full view, unless the person is driving (then Esc belongs to the computer) or a dialog is open.
  useEffect(() => {
    if (!expanded || control) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      onToggleExpand();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, control, onToggleExpand]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const selectTab = (t: ComputerTab) => {
    tip.hide();
    onTab(t);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next === -1 || (e.key.startsWith("Arrow") && (next < 0 || next >= TABS.length))) return;
    e.preventDefault();
    onTab(TABS[next].id);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  /* ---- resizing: drag the left edge, or use the arrow keys on it ---- */
  const limit = () => Math.max(MIN_WIDTH, (asideRef.current?.parentElement?.clientWidth ?? 1200) - MIN_CHAT);
  const clampWidth = (w: number, max: number) => Math.round(Math.max(MIN_WIDTH, Math.min(max, w)));
  const saveWidth = (w: number | null) => {
    try {
      if (w === null) window.localStorage.removeItem(WIDTH_KEY);
      else window.localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      /* private mode: the width simply isn't remembered */
    }
  };

  const onResizeDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !asideRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: asideRef.current.getBoundingClientRect().width, max: limit() };
  };
  const onResizeMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setWidth(clampWidth(d.startW + (d.startX - e.clientX), d.max));
  };
  const onResizeUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    saveWidth(clampWidth(d.startW + (d.startX - e.clientX), d.max));
  };
  const onResizeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const now = asideRef.current?.getBoundingClientRect().width ?? MIN_WIDTH;
    const next = clampWidth(now + (e.key === "ArrowLeft" ? 32 : -32), limit());
    setWidth(next);
    saveWidth(next);
  };
  const resetWidth = () => {
    setWidth(null);
    saveWidth(null);
  };

  const headBtn = "grid size-8 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/[0.07] hover:text-white";
  const filesTick = `${externalShot?.n ?? 0}:${agentBusy ? 1 : 0}:${phase === "on" ? 1 : 0}`;
  const pagesTick = `${agentBusy ? 1 : 0}:${phase === "on" ? 1 : 0}`;
  const waking = phase === "waking";

  return (
    <aside
      ref={asideRef}
      id="computer-panel"
      aria-label={`${bot.name}'s computer`}
      style={{ "--panel-w": width ? `min(${width}px, calc(100% - ${MIN_CHAT}px))` : DEFAULT_WIDTH } as React.CSSProperties}
      className={cx(
        "flex min-h-0 flex-col bg-[#0b0b0b]",
        expanded ? "absolute inset-0 z-30" : "relative shrink-0 border-l border-white/[0.06] max-lg:absolute max-lg:inset-0 max-lg:z-30 max-lg:border-l-0 lg:w-[var(--panel-w)] lg:min-w-[360px]",
      )}
    >
      {!expanded && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the computer panel"
          tabIndex={0}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onKeyDown={onResizeKey}
          onDoubleClick={resetWidth}
          className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none max-lg:hidden"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-white/25 group-focus-visible:bg-[#3b8cff] group-active:bg-[#3b8cff]" />
        </div>
      )}

      <div className="flex h-[60px] shrink-0 items-center gap-2 pl-4 pr-3">
        {!privateMode && (
          <div role="tablist" aria-label="Computer" onKeyDown={onTabKey} className="flex items-center rounded-full bg-[#151515] p-[3px]">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`computer-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="computer-tabpanel"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => selectTab(t.id)}
                className={cx("h-[30px] rounded-full px-3.5 text-[13px] transition-colors", tab === t.id ? "bg-[#2a2a2a] font-medium text-white" : "text-neutral-400 hover:text-white")}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {tab === "screen" && hasE2b && phase === "on" && (
          <button
            type="button"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={(e) => {
              tip.hide();
              if (menu) return setMenu(null);
              setMenu({ position: placeMenu(e.currentTarget.getBoundingClientRect(), 2), trigger: e.currentTarget });
            }}
            className={cx(headBtn, menu && "bg-white/[0.07] text-white")}
            {...tip.bind("More")}
          >
            <Icon name="dots" size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            tip.hide();
            onToggleExpand();
          }}
          aria-label={expanded ? "Exit full view" : "Full view"}
          className={cx(headBtn, "max-lg:hidden")}
          {...tip.bind(expanded ? "Exit full view" : "Full view", expanded && !control ? { hint: "Esc" } : {})}
        >
          <Icon name={expanded ? "collapse" : "maximize"} size={15} />
        </button>
        <button type="button" onClick={onClose} aria-label="Close computer" className={headBtn} {...tip.bind("Close", { align: "end" })}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div id="computer-tabpanel" role="tabpanel" aria-labelledby={`computer-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === "screen" || !hasE2b ? (
          <ComputerScreen
            bot={bot}
            computer={computer}
            hasE2b={hasE2b}
            agentBusy={agentBusy}
            activity={activity}
            control={control}
            onControl={setControl}
            centered={expanded}
            onOpenSettings={onOpenSettings}
          />
        ) : tab === "files" ? (
          <ComputerFiles
            bot={bot}
            tick={filesTick}
            waking={waking}
            onWake={computer.wake}
            onPreview={(p) => {
              setPreviewPath(p);
              onTab("preview");
            }}
          />
        ) : (
          <ComputerPreview bot={bot} tick={pagesTick} path={previewPath} onPath={setPreviewPath} waking={waking} onWake={computer.wake} />
        )}
      </div>

      {menu && (
        <Menu
          label="Computer options"
          position={menu.position}
          trigger={menu.trigger}
          onClose={closeMenu}
          items={[
            { label: "Refresh screen", icon: "refresh", onSelect: () => void computer.refresh() },
            { label: "Restart browser", icon: "globe", disabled: agentBusy, onSelect: () => computer.act({ action: "restart" }) },
          ]}
        />
      )}
      {tip.node}
    </aside>
  );
}
