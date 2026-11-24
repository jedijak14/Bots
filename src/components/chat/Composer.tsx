"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Icon, StopIcon, WaveIcon } from "../icons";
import { cx } from "../ui";

export type Attachment = { name: string; content: string };

type SpeechRec = {
  start(): void;
  stop(): void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

/**
 * The message box. One rounded surface: attach + write + dictate + send on the
 * first line, then the mode chips (computer, voice, …) on the second.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
  attachments,
  setAttachments,
  inputRef,
  onError,
  modes,
  hint = "Enter to send · Shift + Enter for a new line",
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  attachments: Attachment[];
  setAttachments: (a: Attachment[]) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onError: (m: string) => void;
  /** Extra controls rendered in the chip row (computer, voice, …). */
  modes?: ReactNode;
  hint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const baseRef = useRef("");
  const [listening, setListening] = useState(false);
  const subscribeNothing = () => () => {};
  const canDictate = useSyncExternalStore(
    subscribeNothing,
    () => {
      const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
      return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
    },
    () => false,
  );

  useEffect(() => () => recRef.current?.stop(), []);

  // auto-grow
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value, inputRef]);

  function toggleDictation() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return onError("Dictation isn't supported in this browser.");
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    baseRef.current = value;
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      onChange((baseRef.current ? baseRef.current.trimEnd() + " " : "") + t.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      onError("Couldn't access the microphone.");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      onError("Couldn't start dictation.");
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const next = [...attachments];
    for (const f of Array.from(files)) {
      if (f.size > 200_000) {
        onError(`${f.name} is too large (max 200 KB of text).`);
        continue;
      }
      const text = await f.text();
      if (text.includes("\u0000")) {
        onError(`${f.name} doesn't look like a text file.`);
        continue;
      }
      next.push({ name: f.name, content: text });
    }
    setAttachments(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  const hasText = value.trim().length > 0 || attachments.length > 0;

  let action: ReactNode;
  if (busy) {
    action = (
      <button
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-neutral-200 active:scale-90"
      >
        <StopIcon size={13} />
      </button>
    );
  } else if (listening) {
    action = (
      <button
        onClick={toggleDictation}
        aria-label="Stop dictation"
        title="Stop dictation"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-400 text-black transition hover:bg-amber-300 active:scale-90"
      >
        <WaveIcon animate size={18} />
      </button>
    );
  } else {
    action = (
      <button
        onClick={onSend}
        aria-label="Send"
        title="Send"
        disabled={!hasText}
        className={cx(
          "fade-in grid size-9 shrink-0 place-items-center rounded-full transition active:scale-90",
          hasText ? "bg-white text-black hover:bg-neutral-200" : "bg-white/[0.06] text-neutral-600",
        )}
      >
        <Icon name="send" size={17} strokeWidth={2.4} />
      </button>
    );
  }

  return (
    <div className="px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {attachments.map((a, i) => (
            <span key={i} className="fade-up flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.04] py-1.5 pl-3 pr-1.5 text-[12px] text-neutral-300">
              <Icon name="file" size={13} className="text-neutral-500" />
              <span className="max-w-[180px] truncate">{a.name}</span>
              <button onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`} className="grid size-5 place-items-center rounded-full hover:bg-white/10">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-[26px] border border-white/[0.09] bg-[#101013] shadow-[0_18px_50px_rgba(0,0,0,0.45)] transition focus-within:border-white/[0.18]">
        <div className="flex items-end gap-1 p-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept="text/*,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.html,.css,.yml,.yaml,.xml,.sql,.sh,.log,.txt"
            onChange={(e) => onFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a text file"
            title="Attach a text file"
            className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white active:scale-90"
          >
            <Icon name="plus" size={19} />
          </button>
          <textarea
            ref={inputRef}
            value={value}
            rows={2}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!busy && hasText) onSend();
              }
            }}
            placeholder={placeholder}
            aria-label="Message"
            className="max-h-[168px] min-h-[60px] flex-1 resize-none bg-transparent py-2.5 text-[15.5px] leading-[22px] text-white outline-none placeholder:text-neutral-600"
          />
          {canDictate && (
            <button
              onClick={toggleDictation}
              aria-label={listening ? "Stop dictation" : "Dictate"}
              title="Dictate"
              className={cx(
                "mb-0.5 grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-white/10 active:scale-90",
                listening ? "text-amber-400" : "text-neutral-400 hover:text-white",
              )}
            >
              <Icon name="mic" size={18} />
            </button>
          )}
          <span className="mb-0.5">{action}</span>
        </div>

        <div className="flex min-h-[38px] items-center gap-1 px-2 pb-2 pl-3">
          {modes}
          <div className="flex-1" />
          <span className="hidden pr-2 text-[11px] text-neutral-600 md:block">{hint}</span>
        </div>
      </div>
    </div>
  );
}

/** A mode chip for the composer's second row. */
export function ComposerMode({
  active,
  onClick,
  icon,
  children,
  label,
  pulse,
}: {
  active?: boolean;
  onClick?: () => void;
  icon: ReactNode;
  children: ReactNode;
  label: string;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cx(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition active:scale-95",
        active ? "border-white/[0.16] bg-white/[0.1] text-white" : "border-transparent text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200",
      )}
    >
      <span className={cx(pulse && "soft-pulse")}>{icon}</span>
      {children}
    </button>
  );
}
