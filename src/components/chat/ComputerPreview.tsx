"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BotDTO } from "@/lib/bots";
import { BotAvatar } from "../BotAvatar";
import { Icon, Spinner } from "../icons";
import { Menu, placeMenu, type MenuPosition } from "../Menu";
import { fromHome, IconBadge, PanelState, useRemote, type Entry } from "./ComputerParts";

type Found = { active: boolean; entries: Entry[] };
type Page = { path: string; name: string; html: string };

const enc = encodeURIComponent;
const PICKER_WIDTH = 280;
const PICKER_MAX = 10;

/**
 * Pages the bot wrote are untrusted. They run in a frame with its own opaque
 * origin (no `allow-same-origin`), so they can't read this app's cookies,
 * storage or DOM, and they can't navigate the app itself.
 */
const SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox";

/** The Preview tab: shows a web page the bot built, picking the newest one automatically. */
export function ComputerPreview({
  bot,
  tick,
  path,
  onPath,
  waking,
  onWake,
}: {
  bot: Pick<BotDTO, "id" | "name" | "shape" | "color">;
  /** Changes whenever the workspace may have changed. */
  tick: string | number;
  /** The page the person picked; null means "the newest one". */
  path: string | null;
  onPath: (path: string | null) => void;
  waking: boolean;
  onWake: () => void;
}) {
  const base = `/api/bots/${bot.id}/files`;
  const [manual, setManual] = useState(0);
  const [picker, setPicker] = useState<{ position: MenuPosition; trigger: HTMLElement } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const found = useRemote<Found>(`${base}?find=html`, `${tick}:${manual}`);
  const pages = found.data?.entries ?? [];
  const current = path ?? pages[0]?.path ?? null;
  const page = useRemote<Page>(current ? `${base}?preview=1&path=${enc(current)}` : null, `${tick}:${manual}`);

  // Links between local pages are reported by the frame instead of followed (see lib/preview-html).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { source?: unknown; type?: unknown; path?: unknown } | null;
      if (!d || d.source !== "bot-preview" || d.type !== "navigate" || typeof d.path !== "string") return;
      if (!/^\/[^\0]{1,1024}\.html?$/i.test(d.path) || d.path.includes("..")) return;
      onPath(d.path);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onPath]);

  const closePicker = useCallback(() => setPicker(null), []);
  const reload = () => setManual((n) => n + 1);
  const asleep = found.data?.active === false;

  if (found.loading) {
    return (
      <div className="grid flex-1 place-items-center text-neutral-600" role="status" aria-label="Looking for pages">
        <Spinner size={20} />
      </div>
    );
  }
  if (found.error) return <PanelState title="Couldn't load the preview" body={found.error} action={{ label: "Try again", onClick: reload }} />;
  if (asleep) {
    return waking ? (
      <PanelState icon={<BotAvatar shape={bot.shape} color={bot.color} size={56} working />} title="Waking up…" shimmer body="This takes a few seconds." />
    ) : (
      <PanelState
        icon={<BotAvatar shape={bot.shape} color={bot.color} size={56} follow={false} className="opacity-45 saturate-50" />}
        title={`${bot.name}'s computer is asleep`}
        body="Wake it to preview the pages it has built."
        action={{ label: "Wake", onClick: onWake }}
      />
    );
  }
  if (!current) {
    return (
      <PanelState
        icon={
          <IconBadge>
            <Icon name="globe" size={20} />
          </IconBadge>
        }
        title="Nothing to preview yet"
        body={`When ${bot.name} builds a web page, it shows up here.`}
      />
    );
  }

  const options = pages.slice(0, PICKER_MAX);
  const label = fromHome(current);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-4">
        <button
          type="button"
          disabled={options.length < 2}
          aria-haspopup="menu"
          aria-expanded={!!picker}
          aria-label={`Page: ${label}`}
          onClick={(e) => {
            if (picker) return setPicker(null);
            setPicker({ position: placeMenu(e.currentTarget.getBoundingClientRect(), options.length, { width: PICKER_WIDTH, align: "start" }), trigger: e.currentTarget });
          }}
          className="flex h-8 min-w-0 items-center gap-2 rounded-full bg-[#141414] pl-3 pr-2.5 text-[13px] text-neutral-200 transition enabled:hover:bg-[#1e1e1e] disabled:pr-3.5"
        >
          <Icon name="globe" size={14} className="shrink-0 text-neutral-500" />
          <span className="truncate">{label}</span>
          {options.length > 1 && <Icon name="chevron" size={13} className="shrink-0 text-neutral-500" />}
        </button>
        <div className="flex-1" />
        {page.loading && (
          <span className="px-1 text-neutral-500" role="status" aria-label="Loading page">
            <Spinner size={14} />
          </span>
        )}
        <button type="button" onClick={reload} aria-label="Reload page" className="grid size-8 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/[0.07] hover:text-white">
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {page.error ? (
        <PanelState title="Couldn't open this page" body={page.error} action={path ? { label: "Show the newest page", onClick: () => onPath(null) } : { label: "Try again", onClick: reload }} />
      ) : (
        <div className="relative mx-4 mb-4 min-h-0 flex-1 overflow-hidden rounded-xl bg-white ring-1 ring-white/[0.08]">
          {page.data && (
            <iframe
              ref={frame}
              title={`Preview of ${label}`}
              srcDoc={page.data.html}
              sandbox={SANDBOX}
              referrerPolicy="no-referrer"
              className="absolute inset-0 size-full border-0 bg-white"
            />
          )}
        </div>
      )}

      {picker && (
        <Menu
          label="Pages"
          width={PICKER_WIDTH}
          position={picker.position}
          trigger={picker.trigger}
          onClose={closePicker}
          items={options.map((p) => ({ label: fromHome(p.path), icon: p.path === current ? "check" : "globe", onSelect: () => onPath(p.path) }))}
        />
      )}
    </div>
  );
}
