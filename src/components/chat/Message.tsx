"use client";

import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChoicesRecord } from "@/db/schema";
import { Icon, Spinner } from "../icons";
import { cx } from "../ui";
import { ArtifactCard, EmailDraftCard } from "./EmailDraftCard";

export type LiveStep = { id: string; name: string; label: string; status: "running" | "done" | "error"; output?: string; artifactId?: string };

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

export function StepList({ steps }: { steps: LiveStep[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!steps.length) return null;
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
      {steps.map((s) => (
        <div key={s.id} className="fade-up">
          <button
            onClick={() => setOpen(open === s.id ? null : s.id)}
            className="flex max-w-full items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] py-1.5 pl-2.5 pr-3 text-left text-[12px] text-neutral-300 transition hover:bg-white/[0.06]"
          >
            <span className="grid size-4 shrink-0 place-items-center">
              {s.status === "running" ? (
                <Spinner size={13} />
              ) : s.status === "done" ? (
                <Icon name="check" size={13} className="text-emerald-400" />
              ) : (
                <Icon name="x" size={13} className="text-[#ff6b7a]" />
              )}
            </span>
            <span className="truncate font-mono text-[11.5px]">{s.label}</span>
          </button>
          {open === s.id && s.output && (
            <pre className="fade-up mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-[#08080a] p-3 font-mono text-[11.5px] leading-relaxed text-neutral-400">{s.output}</pre>
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
    /* Full column width, matching the message text above it. At 1440 the old
       640px cap left the card 184px narrower than the paragraph it follows, so
       its edge did not line up with anything. */
    <div className="mt-3 w-full rounded-[22px] border border-white/[0.06] bg-[#101013] p-3 fade-up">
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

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto flex max-w-[82%] flex-col items-end fade-up sm:max-w-[76%]">
      <div className="wrap-anywhere rounded-[22px] rounded-br-[8px] bg-white/[0.09] px-4 py-2.5 text-[15.5px] leading-relaxed text-white whitespace-pre-wrap">
        {text}
      </div>
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
  avatar?: ReactNode;
  artifacts?: ArtifactRef[];
  onOpenArtifact?: (a: ArtifactRef) => void;
}) {
  return (
    <div className="group flex w-full gap-3 fade-up">
      <div className="w-7 shrink-0 pt-[3px]">{avatar}</div>
      <div className="min-w-0 flex-1">
        <StepList steps={steps} />
        {text.trim() && (
          <>
            <Markdown text={text} />
            <div className="mt-1.5 flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
              <CopyLink text={text} />
            </div>
          </>
        )}
        {artifacts?.map((a) =>
          a.kind === "email_draft" || a.kind === "sent_email" || a.kind === "email_sending" ? (
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
