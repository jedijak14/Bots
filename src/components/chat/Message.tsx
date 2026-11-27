"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChoicesRecord } from "@/db/schema";
import { Icon, Spinner } from "../icons";
import { cx } from "../ui";
import { ArtifactCard, EmailDraftCard } from "./EmailDraftCard";
import { LyricVideoCard } from "./LyricVideoCard";
import { VideoStudioCard } from "./VideoStudioCard";
import { AudioStudioCard } from "./AudioStudioCard";
import { ImageCard, ModelCard } from "./ModelCard";

export type LiveStep = {
  id: string;
  name: string;
  label: string;
  status: "running" | "done" | "error";
  output?: string;
  /** How long the tool took, once it has finished. */
  ms?: number;
  artifactId?: string;
};

export type ArtifactRef = { id: string; title: string; kind: string; content: string; archived: boolean; createdAt: string };

export function CopyLink({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {}
      }}
      className={cx(
        "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-neutral-600 transition hover:bg-white/[0.05] hover:text-neutral-200",
        align === "right" && "ml-auto",
      )}
    >
      <Icon name={done ? "check" : "copy"} size={12} />
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="group/code relative my-3">
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ref.current?.innerText ?? "");
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          } catch {}
        }}
        className="absolute right-2 top-2 z-10 rounded-lg border border-white/[0.06] bg-[#19191d] px-2 py-1 text-[11px] text-neutral-400 opacity-0 transition hover:text-white focus:opacity-100 group-hover/code:opacity-100"
      >
        {done ? "Copied" : "Copy"}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** "1 second", "2 seconds", "under a second" — never "1 seconds". */
function humanDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (ms < 950) return "under a second";
  if (seconds < 60) return seconds === 1 ? "1 second" : `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** A tool that only collects a choice is a question, not visible labour. */
const isAskTool = (name: string) => name === "ask_user";

/**
 * What the Bot did, above what it said.
 *
 * The reasoning line is the resume of the run — "Thought for 2 seconds" while
 * it is still thinking, the total once it has finished. Below it, each tool is
 * a quiet row with its own icon, and a tool that ran more than once collapses
 * into one row with a count, so a long run does not become a wall of pills.
 * Rows open on click to show the tool's output.
 */
export function StepList({ steps, startedAt, streaming }: { steps: LiveStep[]; startedAt?: number | null; streaming?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  /** Milliseconds since the run began; only ticks while the run is live. */
  const [elapsedMs, setElapsedMs] = useState(0);

  // The interval is the only writer: no state update during render, and the
  // line starts as a plain "Thinking" until the first half-second passes.
  useEffect(() => {
    if (!streaming || !startedAt) return;
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => window.clearInterval(id);
  }, [streaming, startedAt]);

  const visible = steps.filter((s) => !isAskTool(s.name));
  if (!visible.length && !startedAt) return null;

  const totalFromSteps = visible.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  // A finished turn reports the time its tools actually took; a live turn adds
  // the wall clock since it started.
  const elapsed = streaming ? Math.max(elapsedMs, totalFromSteps) : totalFromSteps;

  // One row per tool for the whole turn, in the order each tool first ran, so
  // three shell commands read "Ran commands 3" the way the reference does
  // instead of three near-identical rows.
  const groups: Array<{ name: string; label: string; ids: LiveStep[]; status: LiveStep["status"] }> = [];
  const byName = new Map<string, (typeof groups)[number]>();
  for (const step of visible) {
    const existing = byName.get(step.name);
    if (existing) {
      existing.ids.push(step);
      if (step.status === "running") existing.status = "running";
      else if (step.status === "error" && existing.status !== "running") existing.status = "error";
    } else {
      const group = { name: step.name, label: step.label, ids: [step], status: step.status };
      byName.set(step.name, group);
      groups.push(group);
    }
  }

  const headline = streaming
    ? visible.length
      ? "Working"
      : "Thinking"
    : elapsed > 0
      ? `Thought for ${humanDuration(elapsed)}`
      : "Thought";

  return (
    <div className="mb-3 space-y-1">
      <div className="flex items-center gap-1.5 text-[12.5px] text-neutral-500">
        {streaming ? <Spinner size={12} /> : <Icon name="brain" size={13} className="shrink-0" />}
        <span className={cx(streaming && "shimmer-text")}>{headline}</span>
      </div>

      {groups.map((group) => {
        const key = group.ids[0].id;
        const isOpen = open === key;
        const last = group.ids[group.ids.length - 1];
        const ms = group.ids.reduce((sum, s) => sum + (s.ms ?? 0), 0);
        const hasOutput = group.ids.some((s) => s.output?.trim());
        const label = group.ids.length > 1 ? `${group.label.replace(/\s*\d+$/, "")}` : group.label;
        return (
          <div key={key} className="fade-up">
            <button
              type="button"
              onClick={() => hasOutput && setOpen(isOpen ? null : key)}
              aria-expanded={hasOutput ? isOpen : undefined}
              className={cx(
                "flex max-w-full items-center gap-2 rounded-lg py-1 pl-0.5 pr-2 text-left text-[12.5px] transition",
                hasOutput ? "hover:bg-white/[0.04]" : "cursor-default",
              )}
            >
              {hasOutput && (
                <Icon name="chevron" size={10} className={cx("shrink-0 text-neutral-600 transition-transform", isOpen ? "rotate-0" : "-rotate-90")} />
              )}
              {!hasOutput && <span className="w-[10px] shrink-0" />}
              <span className="grid size-4 shrink-0 place-items-center rounded-[5px] border border-white/[0.07] bg-white/[0.04] text-neutral-500">
                <StepIcon name={group.name} />
              </span>
              <span className="truncate text-neutral-400">
                <span className="font-medium text-neutral-300">{TOOL_VERB[group.name] ?? group.label}</span>
                {group.ids.length > 1 && <span className="ml-1 tabular-nums text-neutral-500">{group.ids.length}</span>}
                {group.ids.length === 1 && label !== (TOOL_VERB[group.name] ?? group.label) && (
                  <span className="ml-1.5 truncate text-neutral-600">{label}</span>
                )}
              </span>
              {group.status === "running" ? (
                <Spinner size={11} />
              ) : group.status === "error" ? (
                <Icon name="x" size={11} className="shrink-0 text-[#ff6b7a]" />
              ) : ms >= 1000 ? (
                <span className="shrink-0 tabular-nums text-[11px] text-neutral-600">{humanDuration(ms)}</span>
              ) : null}
            </button>
            {isOpen && (
              <div className="fade-up mb-1 ml-[26px] mt-1 overflow-hidden rounded-xl border border-white/[0.06] bg-[#08080a]">
                {group.ids.map((step, i) => (
                  <div key={step.id} className={cx("p-3 font-mono text-[11.5px] leading-relaxed", i > 0 && "border-t border-white/[0.05]")}>
                    {group.ids.length > 1 && (
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
                        <span className={cx("size-1.5 rounded-full", step.status === "error" ? "bg-[#ff6b7a]" : "bg-emerald-400/70")} />
                        <span className="truncate">{step.label}</span>
                        {step.ms !== undefined && <span className="ml-auto shrink-0 tabular-nums text-neutral-600">{humanDuration(step.ms)}</span>}
                      </div>
                    )}
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-neutral-400">{step.output?.trim() || "(no output)"}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A short, human verb per tool — the row should read like a sentence. */
const TOOL_VERB: Record<string, string> = {
  run_command: "Ran commands",
  read_file: "Read files",
  write_file: "Wrote files",
  click: "Clicked",
  type_text: "Typed text",
  press_key: "Pressed keys",
  open_url: "Opened a page",
  fetch_page: "Read a page",
  web_search: "Searched the web",
  save_artifact: "Made an artifact",
  draft_email: "Drafted an email",
  search_gmail: "Searched mail",
  search_notion: "Searched Notion",
  search_youtube: "Searched YouTube",
  list_github_repositories: "Looked at GitHub",
  list_vercel_projects: "Looked at Vercel",
  list_saved_spotify_tracks: "Looked at Spotify",
  get_current_time: "Checked the time",
  make_lyric_video: "Made a lyric video",
};

function StepIcon({ name }: { name: string }) {
  if (name === "run_command") return <Icon name="terminal" size={10} />;
  if (name === "make_lyric_video") return <Icon name="volume" size={10} />;
  if (name === "save_artifact") return <Icon name="sparkles" size={10} />;
  if (name === "draft_email") return <Icon name="mail" size={10} />;
  if (name === "web_search" || name === "fetch_page" || name === "open_url") return <Icon name="globe" size={10} />;
  if (name === "read_file" || name === "write_file") return <Icon name="file" size={10} />;
  return <Icon name="cursor" size={10} />;
}

export function ChoiceCard({
  choices,
  picked,
  disabled,
  onPick,
}: {
  choices: ChoicesRecord;
  picked?: string;
  disabled: boolean;
  onPick: (opt: string) => void;
}) {
  const opts = choices.options.some((o) => /something else|^other$/i.test(o)) ? choices.options : [...choices.options, "Something else"];
  return (
    /* Full column width, matching the message text above it. At 1440 the old
       640px cap left the card 184px narrower than the paragraph it follows, so
       its edge did not line up with anything. */
    <div className="mt-3 w-full rounded-[22px] border border-white/[0.06] bg-[#101013] p-3 fade-up">
      {choices.action === "privacy" && (
        <div className="mx-1.5 mb-1 mt-1 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-amber-200/70">
          <Icon name="lock" size={11} /> Privacy Mode
        </div>
      )}
      <h3 className="px-2.5 pb-2 pt-1.5 text-[15.5px] font-semibold leading-snug text-white">{choices.question}</h3>
      <div className="flex flex-col gap-0.5">
        {opts.map((o, i) => {
          const isPicked = picked === o;
          return (
            <button
              key={o}
              disabled={disabled}
              onClick={() => onPick(o)}
              className={cx(
                "group flex items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition",
                !disabled && "hover:bg-white/[0.05] active:scale-[0.99]",
                isPicked && "bg-white/[0.06]",
                disabled && !isPicked && "opacity-50",
              )}
            >
              <span className="grid size-[26px] shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-[11.5px] font-medium text-neutral-400 transition group-hover:text-white">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="text-[15px] text-neutral-200">{o}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * How much of a long message to show before the "Show more" control. Uploads
 * send a whole lyrics file with the request, and echoing 40 KB into the
 * transcript buries the conversation.
 */
const BUBBLE_LIMIT = 900;

export function UserBubble({ text, onRetryLyric, retryDisabled = false }: { text: string; onRetryLyric?: () => void; retryDisabled?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > BUBBLE_LIMIT;
  const shown = long && !expanded ? `${text.slice(0, BUBBLE_LIMIT).trimEnd()}…` : text;
  return (
    <div className="ml-auto flex max-w-[82%] flex-col items-end fade-up sm:max-w-[76%]">
      <div className="wrap-anywhere rounded-[22px] rounded-br-[8px] bg-white/[0.09] px-4 py-2.5 text-[15.5px] leading-relaxed text-white whitespace-pre-wrap">
        {shown}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 block text-[12.5px] font-medium text-neutral-400 transition hover:text-white"
          >
            {expanded ? "Show less" : `Show ${Math.ceil((text.length - BUBBLE_LIMIT) / 1000)}k more`}
          </button>
        )}
      </div>
      {onRetryLyric && <button type="button" disabled={retryDisabled} onClick={onRetryLyric} className="mt-1 rounded-lg px-2 py-1 text-[11.5px] text-neutral-400 hover:text-white disabled:opacity-50">Retry lyric video</button>}
      <CopyLink text={text} align="right" />
    </div>
  );
}

export function AssistantBlock({
  text,
  steps,
  choices,
  picked,
  choicesDisabled,
  onPick,
  streaming,
  startedAt,
  avatar,
  artifacts,
  onOpenArtifact,
}: {
  text: string;
  steps: LiveStep[];
  choices: ChoicesRecord | null;
  picked?: string;
  choicesDisabled: boolean;
  onPick: (o: string) => void;
  streaming?: boolean;
  /** When this assistant turn began, for the live "Thought for …" line. */
  startedAt?: number | null;
  avatar?: ReactNode;
  artifacts?: ArtifactRef[];
  onOpenArtifact?: (a: ArtifactRef) => void;
}) {
  return (
    <div className="group flex w-full gap-3 fade-up">
      <div className="w-7 shrink-0 pt-[3px]">{avatar}</div>
      <div className="min-w-0 flex-1">
        <StepList steps={steps} startedAt={startedAt} streaming={streaming} />
        {text.trim() && (
          <>
            <Markdown text={text} />
            <div className="mt-1.5 flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
              <CopyLink text={text} />
            </div>
          </>
        )}
        {artifacts?.map((a) =>
          a.kind === "lyric_video" ? (
            <div key={a.id} className="mt-3">
              <LyricVideoCard artifact={a} />
            </div>
          ) : a.kind === "video_project" ? (
            <div key={a.id} className="mt-3">
              <VideoStudioCard artifact={a} />
            </div>
          ) : a.kind === "audio_project" ? (
            <div key={a.id} className="mt-3">
              <AudioStudioCard artifact={a} />
            </div>
          ) : a.kind === "model_3d" ? (
            <div key={a.id} className="mt-3">
              <ModelCard artifact={a} />
            </div>
          ) : a.kind === "image" ? (
            <div key={a.id} className="mt-3">
              <ImageCard artifact={a} />
            </div>
          ) : a.kind === "email_draft" || a.kind === "sent_email" || a.kind === "email_sending" ? (
            <div key={a.id} className="mt-3">
              <EmailDraftCard artifact={a} />
            </div>
          ) : (
            <div key={a.id} className="mt-3">
              <ArtifactCard artifact={a} onOpen={() => onOpenArtifact?.(a)} />
            </div>
          ),
        )}
        {choices && <ChoiceCard choices={choices} picked={picked} disabled={choicesDisabled} onPick={onPick} />}
      </div>
    </div>
  );
}
