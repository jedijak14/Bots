"use client";

import { useState } from "react";
import type { BotDTO } from "@/lib/bots";
import { BotAvatar } from "../BotAvatar";
import { Icon, Spinner } from "../icons";
import { cx } from "../ui";
import { Markdown } from "./Message";
import { formatSize, HOME, IconBadge, PanelState, useRemote, type Entry } from "./ComputerParts";

type Listing = { active: boolean; entries: Entry[] };
type FileBody = { name: string; path: string; size: number; kind: "text" | "image" | "binary"; text?: string; truncated?: boolean; dataUrl?: string };

const enc = encodeURIComponent;
const isPage = (name: string) => /\.html?$/i.test(name);
const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);

/** The Files tab: browse the bot's workspace, read a file in place, download it, or open a web page in Preview. */
export function ComputerFiles({
  bot,
  tick,
  waking,
  onWake,
  onPreview,
}: {
  bot: Pick<BotDTO, "id" | "name" | "shape" | "color">;
  /** Changes whenever the workspace may have changed. */
  tick: string | number;
  waking: boolean;
  onWake: () => void;
  onPreview: (path: string) => void;
}) {
  const [path, setPath] = useState(HOME);
  const [open, setOpen] = useState<Entry | null>(null);
  const [manual, setManual] = useState(0);
  const base = `/api/bots/${bot.id}/files`;
  const list = useRemote<Listing>(`${base}?path=${enc(path)}`, `${tick}:${manual}`);

  if (open) return <FileView base={base} entry={open} onBack={() => setOpen(null)} onPreview={onPreview} />;

  const parts = path.split("/").filter(Boolean);
  const entries = list.data?.entries ?? [];
  const asleep = list.data?.active === false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-4 text-[13px] text-neutral-400">
        <nav aria-label="Folder" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          <button type="button" onClick={() => setPath(HOME)} className={cx("shrink-0 rounded-md px-1.5 py-1 transition hover:bg-white/[0.06] hover:text-white", parts.length <= 2 && "font-medium text-neutral-200")}>
            Home
          </button>
          {parts.slice(2).map((p, i, all) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              <Icon name="chevron-right" size={12} className="text-neutral-600" />
              <button
                type="button"
                onClick={() => setPath("/" + parts.slice(0, i + 3).join("/"))}
                className={cx("rounded-md px-1.5 py-1 transition hover:bg-white/[0.06] hover:text-white", i === all.length - 1 && "font-medium text-neutral-200")}
              >
                {p}
              </button>
            </span>
          ))}
        </nav>
        <button type="button" onClick={() => setManual((n) => n + 1)} aria-label="Refresh files" className="grid size-8 shrink-0 place-items-center rounded-full transition hover:bg-white/[0.07] hover:text-white">
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {list.loading ? (
        <div className="grid flex-1 place-items-center text-neutral-600" role="status" aria-label="Loading files">
          <Spinner size={20} />
        </div>
      ) : list.error ? (
        <PanelState title="Couldn't load files" body={list.error} action={{ label: "Try again", onClick: () => setManual((n) => n + 1) }} />
      ) : asleep ? (
        waking ? (
          <PanelState icon={<BotAvatar shape={bot.shape} color={bot.color} size={56} working />} title="Waking up…" shimmer body="This takes a few seconds." />
        ) : (
          <PanelState
            icon={<BotAvatar shape={bot.shape} color={bot.color} size={56} follow={false} className="opacity-45 saturate-50" />}
            title={`${bot.name}'s computer is asleep`}
            body="Wake it to see the files it has been working on."
            action={{ label: "Wake", onClick: onWake }}
          />
        )
      ) : !entries.length ? (
        <PanelState
          icon={
            <IconBadge>
              <Icon name="folder" size={20} />
            </IconBadge>
          }
          title={path === HOME ? "No files yet" : "This folder is empty"}
          body={path === HOME ? `Anything ${bot.name} saves or downloads shows up here.` : undefined}
        />
      ) : (
        <ul className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-4">
          {entries.map((e) => (
            <li key={e.path} className="group relative">
              <button
                type="button"
                onClick={() => (e.type === "dir" ? setPath(e.path) : setOpen(e))}
                className="flex h-10 w-full items-center gap-3 rounded-lg pl-3 pr-12 text-left outline-offset-[-2px] transition-colors hover:bg-white/[0.05]"
              >
                <Icon name={e.type === "dir" ? "folder" : isPage(e.name) ? "globe" : "file"} size={16} className={e.type === "dir" ? "shrink-0 text-[#6aa9ff]" : "shrink-0 text-neutral-500"} />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{e.name}</span>
                {e.type === "file" && <span className="shrink-0 text-[12px] tabular-nums text-neutral-500 transition-opacity group-focus-within:opacity-0 group-hover:opacity-0">{formatSize(e.size)}</span>}
              </button>
              {e.type === "file" && (
                <a
                  href={`${base}?download=1&path=${enc(e.path)}`}
                  download={e.name}
                  aria-label={`Download ${e.name}`}
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-neutral-400 opacity-0 transition hover:bg-white/10 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Icon name="download" size={14} />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileView({ base, entry, onBack, onPreview }: { base: string; entry: Entry; onBack: () => void; onPreview: (path: string) => void }) {
  const file = useRemote<FileBody>(`${base}?read=1&path=${enc(entry.path)}`);
  const download = `${base}?download=1&path=${enc(entry.path)}`;
  const f = file.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 pl-2 pr-4">
        <button type="button" onClick={onBack} aria-label="Back to files" className="grid size-8 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/[0.07] hover:text-white">
          <Icon name="back" size={15} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{entry.name}</span>
        <span className="shrink-0 px-1 text-[12px] tabular-nums text-neutral-500">{formatSize(f?.size ?? entry.size)}</span>
        {isPage(entry.name) && (
          <button type="button" onClick={() => onPreview(entry.path)} className="shrink-0 rounded-full bg-[#1c1c1c] px-3 py-1.5 text-[12.5px] font-medium transition hover:bg-[#262626]">
            Preview
          </button>
        )}
        <a href={download} download={entry.name} aria-label={`Download ${entry.name}`} className="grid size-8 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/[0.07] hover:text-white">
          <Icon name="download" size={15} />
        </a>
      </div>

      {file.loading ? (
        <div className="grid flex-1 place-items-center text-neutral-600" role="status" aria-label="Loading file">
          <Spinner size={20} />
        </div>
      ) : file.error || !f ? (
        <PanelState title="Couldn't open this file" body={file.error ?? undefined} action={{ label: "Back to files", onClick: onBack }} />
      ) : f.kind === "image" && f.dataUrl ? (
        <div className="mx-4 mb-4 grid min-h-0 flex-1 place-items-center overflow-auto rounded-xl bg-[#111] p-4 ring-1 ring-white/[0.06]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a workspace file delivered as a data URL */}
          <img src={f.dataUrl} alt={f.name} className="max-h-full max-w-full object-contain" />
        </div>
      ) : f.kind === "text" ? (
        <div className="mx-4 mb-4 min-h-0 flex-1 overflow-auto rounded-xl bg-[#0e0e0e] ring-1 ring-white/[0.06]">
          {isMarkdown(f.name) ? (
            <div className="px-5 py-4">
              <Markdown text={f.text ?? ""} />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-neutral-200">{f.text}</pre>
          )}
          {f.truncated && <p className="border-t border-white/[0.06] px-4 py-3 text-[12px] text-neutral-500">This is the beginning of a large file. Download it to see the rest.</p>}
        </div>
      ) : (
        <PanelState
          icon={
            <IconBadge>
              <Icon name="file" size={20} />
            </IconBadge>
          }
          title="This file can't be shown here"
          body="Download it to open it on your own computer."
          action={{ label: "Download", onClick: () => window.location.assign(download) }}
        />
      )}
    </div>
  );
}
