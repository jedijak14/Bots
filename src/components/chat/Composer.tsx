"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
  voiceOn,
  onToggleVoice,
  attachments,
  setAttachments,
  inputRef,
  onError,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  voiceOn: boolean;
  onToggleVoice: () => void;
  attachments: Attachment[];
  setAttachments: (a: Attachment[]) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onError: (m: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const baseRef = useRef("");
  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setCanDictate(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recRef.current?.stop();
  }, []);

  // auto-grow
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
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

  let action: React.ReactNode;
  if (busy) {
    action = (
      <button onClick={onStop} aria-label="Stop" title="Stop" className="grid size-[34px] place-items-center rounded-full bg-white text-black transition hover:bg-neutral-200 active:scale-90">
        <StopIcon />
      </button>
    );
  } else if (listening) {
    action = (
      <button onClick={toggleDictation} aria-label="Stop dictation" title="Stop dictation" className="grid size-[34px] place-items-center rounded-full bg-[#b9873a] text-white transition active:scale-90">
        <WaveIcon animate size={19} />
      </button>
    );
  } else if (hasText) {
    action = (
      <button onClick={onSend} aria-label="Send" title="Send" className="fade-up grid size-[34px] place-items-center rounded-full bg-white text-black transition hover:bg-neutral-200 active:scale-90">
        <Icon name="send" size={17} strokeWidth={2.4} />
      </button>
    );
  } else {
    action = (
      <button
        onClick={onToggleVoice}
        aria-label={voiceOn ? "Voice replies on" : "Voice replies off"}
        aria-pressed={voiceOn}
        title={voiceOn ? "Voice replies on — click to turn off" : "Read replies aloud"}
        className={cx("grid size-[34px] place-items-center rounded-full transition active:scale-90", voiceOn ? "bg-[#b9873a] text-white" : "bg-[#242424] text-neutral-300 hover:bg-[#2c2c2c]")}
      >
        <WaveIcon size={19} />
      </button>
    );
  }

  return (
    <div className="px-6 pb-5 pt-2">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span key={i} className="fade-up flex items-center gap-2 rounded-full bg-[#1a1a1a] py-1.5 pl-3 pr-1.5 text-[12.5px] text-neutral-300">
              <Icon name="file" size={13} />
              <span className="max-w-[180px] truncate">{a.name}</span>
              <button onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`} className="grid size-5 place-items-center rounded-full hover:bg-white/10">
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-[28px] border border-white/[0.07] bg-[#0f0f0f] py-1.5 pl-1.5 pr-1.5 transition focus-within:border-white/20">
        <input ref={fileRef} type="file" multiple hidden accept="text/*,.md,.json,.csv,.js,.ts,.tsx,.jsx,.py,.html,.css,.yml,.yaml,.xml,.sql,.sh,.log,.txt" onChange={(e) => onFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} aria-label="Attach a text file" title="Attach a text file" className="grid size-[34px] shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white active:scale-90">
          <Icon name="plus" size={19} />
        </button>
        <textarea
          ref={inputRef}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy && hasText) onSend();
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-40 min-h-[34px] flex-1 resize-none bg-transparent py-[7px] text-[15.5px] leading-[20px] text-white outline-none placeholder:text-neutral-500"
        />
        {canDictate && (
          <button
            onClick={toggleDictation}
            aria-label={listening ? "Stop dictation" : "Dictate"}
            title="Dictate"
            className={cx("grid size-[34px] shrink-0 place-items-center rounded-full transition hover:bg-white/10 active:scale-90", listening ? "text-[#e0a24a]" : "text-neutral-400 hover:text-white")}
          >
            <Icon name="mic" size={18} />
          </button>
        )}
        {action}
      </div>
    </div>
  );
}
