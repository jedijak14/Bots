"use client";

import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChoicesRecord } from "@/db/schema";
import { useApp } from "../AppProvider";
import { Icon, Spinner } from "../icons";
import { cx } from "../ui";

export type LiveStep = { id: string; name: string; label: string; status: "running" | "done" | "error"; output?: string };

export function CopyLink({ text }: { text: string }) {
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
      className="px-3 pt-1.5 text-[11.5px] text-neutral-500 transition hover:text-neutral-200"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="group relative my-3">
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ref.current?.innerText ?? "");
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          } catch {}
        }}
        className="absolute right-2 top-2 z-10 rounded-md bg-[#1e1e1e] px-2 py-1 text-[11px] text-neutral-400 opacity-0 transition hover:text-white group-hover:opacity-100 focus:opacity-100"
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

export function StepList({ steps }: { steps: LiveStep[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const app = useApp();
  if (!steps.length) return null;
  return (
    <div className="mb-2 flex flex-col items-start gap-1.5">
      {steps.map((s) => (
        <div key={s.id} className="max-w-full fade-up">
          <button
            onClick={() => setOpen(open === s.id ? null : s.id)}
            className="flex max-w-full items-center gap-2 rounded-full border border-white/[0.06] bg-[#121212] py-1.5 pl-2.5 pr-3.5 text-left text-[12.5px] text-neutral-300 transition hover:bg-[#181818]"
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {s.status === "running" ? (
                <Spinner size={13} />
              ) : s.status === "done" ? (
                <Icon name="check" size={14} className="text-emerald-400" />
              ) : (
                <Icon name="x" size={14} className="text-[#ff6b7a]" />
              )}
            </span>
            <span className="truncate font-mono text-[12px]">{s.label}</span>
          </button>
          {s.name === "request_connection" && s.status === "done" && s.output?.includes("Settings > Connections") && (
            <div className="mt-2 rounded-xl border border-blue-400/20 bg-blue-400/[0.06] p-3 text-sm text-neutral-200">
              <p>Connect through the provider in your own browser. Your password is not entered into the bot desktop or chat.</p>
              <button type="button" onClick={() => app.openSettings("connections")} className="mt-3 rounded-full bg-white px-4 py-2 font-semibold text-black hover:bg-neutral-200">Open Connections</button>
            </div>
          )}
          {open === s.id && s.output && (
            <pre className="fade-up mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-[#0b0b0b] p-3 font-mono text-[12px] leading-relaxed text-neutral-400">{s.output}</pre>
          )}
        </div>
      ))}
    </div>
  );
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
    <div className="mt-3 w-full max-w-[min(740px,100%)] rounded-[24px] border border-white/[0.04] bg-[#121212] p-3.5 fade-up">
      <h3 className="px-2.5 pb-2 pt-1.5 text-[16.5px] font-semibold leading-snug">{choices.question}</h3>
      <div className="flex flex-col gap-0.5">
        {opts.map((o, i) => {
          const isPicked = picked === o;
          return (
            <button
              key={o}
              disabled={disabled}
              onClick={() => onPick(o)}
              className={cx(
                "group flex items-center gap-3.5 rounded-2xl px-2.5 py-2.5 text-left transition",
                !disabled && "hover:bg-[#1d1d1d] active:scale-[0.99]",
                isPicked && "bg-[#1d1d1d]",
                disabled && !isPicked && "opacity-50",
              )}
            >
              <span className="grid size-[26px] shrink-0 place-items-center rounded-lg border border-white/10 bg-[#1b1b1b] text-[11.5px] font-medium text-neutral-400 transition group-hover:text-white">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="text-[15.5px] text-neutral-200">{o}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto flex max-w-[78%] flex-col items-start fade-up">
      <div className="rounded-[24px] bg-[#f1f1f1] px-4.5 py-2.5 text-[15.5px] leading-relaxed text-black [overflow-wrap:anywhere] whitespace-pre-wrap" style={{ paddingInline: 18 }}>
        {text}
      </div>
      <CopyLink text={text} />
    </div>
  );
}

// Only the explicit artifact fence becomes a document; Markdown is rendered without raw HTML.
function AssistantContent({ text }: { text: string }) {
  const parts = text.split(/```artifact\s*\n([\s\S]*?)```/gi);
  return <>{parts.map((part, i) => {
    if (i % 2 === 0) return part.trim() ? <Markdown key={i} text={part} /> : null;
    const [first, ...rest] = part.trim().split("\n");
    const title = first?.replace(/^#+\s*/, "").trim() || "Untitled artifact";
    const body = rest.join("\n").trim();
    return <details key={i} className="my-3 w-full rounded-xl border border-white/15 bg-[#101010] p-4" open>
      <summary className="cursor-pointer font-semibold">Artifact · {title}</summary>
      <div className="mt-3"><Markdown text={body || title} /></div>
    </details>;
  })}</>;
}

export function AssistantBlock({
  text,
  steps,
  choices,
  picked,
  choicesDisabled,
  onPick,
  streaming,
}: {
  text: string;
  steps: LiveStep[];
  choices: ChoicesRecord | null;
  picked?: string;
  choicesDisabled: boolean;
  onPick: (o: string) => void;
  streaming?: boolean;
}) {
  return (
    <div className="flex w-full flex-col items-start fade-up">
      <StepList steps={steps} />
      {text.trim() && (
        <>
          <div className="max-w-[min(760px,100%)] rounded-[24px] border border-white/[0.03] bg-[#151515] px-5 py-3.5">
            <AssistantContent text={text} />
          </div>
          {!streaming && <CopyLink text={text} />}
        </>
      )}
      {choices && <ChoiceCard choices={choices} picked={picked} disabled={choicesDisabled} onPick={onPick} />}
    </div>
  );
}
