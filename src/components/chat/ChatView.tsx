"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { ChoicesRecord } from "@/db/schema";
import type { MessageDTO } from "@/lib/bots";
import { useApp } from "../AppProvider";
import { BotAvatar } from "../BotAvatar";
import { Icon } from "../icons";
import { cx } from "../ui";
import { EmailApprovals } from "./EmailApprovals";
import { Composer, type Attachment } from "./Composer";
import { ComputerPanel, type ComputerTab } from "./ComputerPanel";
import { AssistantBlock, UserBubble, type LiveStep } from "./Message";
import { ModelPicker } from "./ModelPicker";
import type { ComputerPhase } from "./useComputer";

type Live = { text: string; steps: LiveStep[]; choices: ChoicesRecord | null };
type StreamEvent =
  | { t: "start"; userMessage: { id: string; createdAt: string } }
  | { t: "text"; d: string }
  | { t: "step"; id: string; name: string; label: string }
  | { t: "step_done"; id: string; ok: boolean; output?: string }
  | { t: "shot"; data: string }
  | { t: "choices"; question: string; options: string[] }
  | { t: "error"; message: string }
  | { t: "done"; message: { id: string; createdAt: string } | null };

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return `Today ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })} ${time}`;
}

/** Tools that don't touch the bot's computer, so they shouldn't bring the Computer panel up. */
const NO_COMPUTER = new Set(["ask_user", "get_current_time", "search_history", "read_history_message", "list_history_artifacts", "request_connection", "search_gmail", "read_gmail_message", "prepare_email", "list_youtube_playlists", "list_github_repos"]);

const subscribeNothing = () => () => {};
/** False during server rendering and hydration, true afterwards. */
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

function speak(markdown: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const text = markdown.replace(/```[\s\S]*?```/g, " code block ").replace(/[#*_`>~\[\]()]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 1500)));
}

export function ChatView({ botId, initialMessages }: { botId: string; initialMessages: MessageDTO[] }) {
  const app = useApp();
  const { setWorking, toast } = app;
  const router = useRouter();
  const bot = app.bots.find((b) => b.id === botId);

  const [messages, setMessages] = useState<MessageDTO[]>(initialMessages);
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<ComputerTab>("screen");
  const [expanded, setExpanded] = useState(false);
  const [shot, setShot] = useState<{ n: number; data: string } | null>(null);
  const [computerOn, setComputerOn] = useState(!!bot?.hasSandbox);
  const [shareOpen, setShareOpen] = useState(false);
  const mounted = useHydrated();

  const acc = useRef<Live>({ text: "", steps: [], choices: null });
  const abortRef = useRef<AbortController | null>(null);
  const clearVersion = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const frame = useRef(0);
  const shareRef = useRef<HTMLDivElement>(null);
  /** Set when the person closes the panel mid-run, so the next step doesn't pop it back open. */
  const panelDismissed = useRef(false);

  useEffect(() => {
    if (!bot) router.replace("/");
  }, [bot, router]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      setWorking(null);
    },
    [setWorking],
  );

  useEffect(() => {
    const onClear = (event: Event) => {
      if ((event as CustomEvent<{ botId: string }>).detail?.botId !== botId) return;
      clearVersion.current++;
      abortRef.current?.abort();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      acc.current = { text: "", steps: [], choices: null };
      setMessages([]);
      setLive(null);
      setBusy(false);
      setError(null);
      setWorking(null);
    };
    window.addEventListener("bots:chat-cleared", onClear);
    return () => window.removeEventListener("bots:chat-cleared", onClear);
  }, [botId, setWorking]);

  const closePanel = useCallback(() => {
    panelDismissed.current = true;
    setPanelOpen(false);
    setExpanded(false);
  }, []);
  const toggleExpanded = useCallback(() => setExpanded((e) => !e), []);
  const onComputerPhase = useCallback((p: ComputerPhase) => {
    if (p === "on") setComputerOn(true);
    else if (p === "asleep") setComputerOn(false);
  }, []);
  const onComputerError = useCallback((message: string) => toast(message, "err"), [toast]);

  useEffect(() => {
    if (!shareOpen) return;
    const close = (e: MouseEvent) => {
      if (!shareRef.current?.contains(e.target as Node)) setShareOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [shareOpen]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    // `mounted` is here because the timestamps appear after hydration and push the last message down.
  }, [messages, live, busy, error, mounted]);

  const flush = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setLive({ text: acc.current.text, steps: acc.current.steps.map((s) => ({ ...s })), choices: acc.current.choices });
    });
  }, []);

  const send = useCallback(
    async (raw: string, atts: Attachment[] = []) => {
      if (busy || !bot) return;
      let content = raw.trim();
      for (const a of atts) content += `\n\n[Attached file: ${a.name}]\n\`\`\`\n${a.content}\n\`\`\``;
      content = content.trim();
      if (!content) return;

      setError(null);
      stick.current = true;
      const tmpId = `tmp-${Date.now()}`;
      setMessages((m) => [...m, { id: tmpId, role: "user", content, steps: null, choices: null, createdAt: new Date().toISOString() }]);
      app.setPreview(botId, raw.trim() || content.slice(0, 80));
      acc.current = { text: "", steps: [], choices: null };
      setLive({ text: "", steps: [], choices: null });
      setBusy(true);
      setWorking({ id: botId, label: "Thinking…" });
      panelDismissed.current = false;

      const ac = new AbortController();
      const generation = clearVersion.current;
      abortRef.current = ac;
      let finalized = false;

      const finalize = (info: { id: string; createdAt: string } | null) => {
        if (finalized) return;
        finalized = true;
        if (generation !== clearVersion.current) return;
        if (frame.current) {
          cancelAnimationFrame(frame.current);
          frame.current = 0;
        }
        const a = acc.current;
        if (a.text.trim() || a.steps.length || a.choices) {
          const msg: MessageDTO = {
            id: info?.id ?? `local-${Date.now()}`,
            role: "assistant",
            content: a.text.trim(),
            steps: a.steps.map((s) => ({ id: s.id, name: s.name, label: s.label, ok: s.status !== "error", output: s.output })),
            choices: a.choices,
            createdAt: info?.createdAt ?? new Date().toISOString(),
          };
          if (!msg.steps?.length) msg.steps = null;
          setMessages((m) => [...m, msg]);
          app.setPreview(botId, a.text.trim() || a.choices?.question || "");
          if (app.settings.voiceReplies && a.text.trim()) speak(a.text);
        }
        setLive(null);
        setBusy(false);
        setWorking(null);
      };

      const handle = (ev: StreamEvent) => {
        if (generation !== clearVersion.current) return;
        switch (ev.t) {
          case "start":
            setMessages((m) => m.map((x) => (x.id === tmpId ? { ...x, id: ev.userMessage.id, createdAt: ev.userMessage.createdAt } : x)));
            break;
          case "text":
            acc.current.text += ev.d;
            setWorking({ id: botId, label: "Writing…" });
            flush();
            break;
          case "step":
            acc.current.steps.push({ id: ev.id, name: ev.name, label: ev.label, status: "running" });
            setWorking({ id: botId, label: ev.label });
            // Bring the computer into view the first time the bot reaches for it in this run.
            if (!NO_COMPUTER.has(ev.name) && !panelDismissed.current) setPanelOpen(true);
            flush();
            break;
          case "step_done": {
            const s = acc.current.steps.find((x) => x.id === ev.id);
            if (s) {
              s.status = ev.ok ? "done" : "error";
              s.output = ev.output;
            }
            setWorking({ id: botId, label: "Thinking…" });
            flush();
            break;
          }
          case "shot":
            setShot({ n: Date.now(), data: ev.data });
            setComputerOn(true);
            break;
          case "choices":
            acc.current.choices = { question: ev.question, options: ev.options };
            flush();
            break;
          case "error":
            setError({ message: ev.message });
            break;
          case "done":
            finalize(ev.message);
            break;
        }
      };

      try {
        const res = await fetch(`/api/bots/${botId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, wantShots: app.settings.hasE2bKey }),
          signal: ac.signal,
        });
        if (generation !== clearVersion.current) return;
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          setError({ message: j.error || "Couldn't reach the server.", code: j.code });
          setMessages((m) => m.filter((x) => x.id !== tmpId));
          if (j.code === "no_key") setInput(raw);
          finalized = true;
          setLive(null);
          setBusy(false);
          setWorking(null);
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              handle(JSON.parse(line) as StreamEvent);
            } catch {}
          }
        }
      } catch (e) {
        if (generation === clearVersion.current && !(e instanceof DOMException && e.name === "AbortError")) {
          setError({ message: "The connection was interrupted." });
        }
      } finally {
        finalize(null);
      }
    },
    [app, bot, botId, busy, flush, setWorking],
  );

  const stop = () => abortRef.current?.abort();

  const submit = () => {
    const text = input;
    const atts = attachments;
    if (!text.trim() && !atts.length) return;
    setInput("");
    setAttachments([]);
    send(text, atts);
  };

  const buildMarkdown = () =>
    `# ${bot?.name}\n\n` +
    messages.map((m) => `**${m.role === "user" ? "You" : bot?.name}:**\n\n${m.content}${m.choices ? `\n\n_${m.choices.question}_\n${m.choices.options.map((o) => `- ${o}`).join("\n")}` : ""}`).join("\n\n---\n\n");

  if (!bot) return null;

  const lastUserIdx = messages.reduce((acc2, m, i) => (m.role === "user" ? i : acc2), -1);
  const lastMsg = messages[messages.length - 1];
  const awaiting = lastMsg?.role === "assistant" && !!lastMsg.choices && !busy;
  const placeholder = awaiting ? "Type your answer, or talk about something else" : `Message ${bot.name}`;

  const runningStep = busy ? (live?.steps.filter((x) => x.status === "running").pop() ?? null) : null;
  const usingComputer = !!runningStep && !NO_COMPUTER.has(runningStep.name);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="relative z-10 flex h-[68px] shrink-0 items-center gap-2 px-4">
        <button onClick={() => app.setSidebarOpen(true)} aria-label="Open sidebar" className="grid size-9 shrink-0 place-items-center rounded-full bg-[#1a1a1a] text-neutral-300 md:hidden">
          <Icon name="menu" size={17} />
        </button>
        <button
          onClick={() => app.openBotDialog(bot.id)}
          title="Edit look & name"
          className="flex min-w-0 items-center gap-2.5 rounded-full bg-[#171717] py-2 pl-3 pr-4 transition hover:bg-[#202020] active:scale-[0.97]"
        >
          <BotAvatar shape={bot.shape} color={bot.color} size={22} />
          <span className="truncate text-[15px] font-medium">{bot.name}</span>
        </button>
        <div className="flex-1" />
        <ModelPicker botId={bot.id} />
        <button
          type="button"
          onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}
          aria-pressed={panelOpen}
          aria-label={`Computer${usingComputer ? `, ${bot.name} is using it` : computerOn ? ", on" : ""}`}
          title={usingComputer ? `${bot.name} is using its computer` : computerOn ? `${bot.name}'s computer is on` : `${bot.name}'s computer`}
          className={cx(
            "flex shrink-0 items-center gap-2 rounded-full border border-white/[0.05] px-3.5 py-2 text-[13px] transition active:scale-95",
            panelOpen ? "bg-[#262626] text-white" : "bg-[#141414] text-neutral-200 hover:bg-[#1b1b1b] hover:text-white",
          )}
        >
          {/* The icon lights up while the computer is on, and pulses while the bot is using it. */}
          <Icon name="monitor" size={15} className={cx("transition-colors", computerOn || usingComputer ? "text-emerald-400" : "text-neutral-500", usingComputer && "soft-pulse")} />
          <span className="max-sm:sr-only">Computer</span>
        </button>
        <div ref={shareRef} className="relative hidden sm:block">
          <button onClick={() => setShareOpen((s) => !s)} className="rounded-full bg-[#171717] px-4 py-2 text-[14px] font-medium transition hover:bg-[#202020] active:scale-95">
            Share
          </button>
          {shareOpen && (
            <div className="modal-in absolute right-0 top-[calc(100%+8px)] z-40 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#171717] p-1.5 shadow-2xl">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(buildMarkdown()).catch(() => {});
                  setShareOpen(false);
                  app.toast("Conversation copied.");
                }}
                className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] transition hover:bg-white/[0.07]"
              >
                Copy conversation
              </button>
              <button
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([buildMarkdown()], { type: "text/markdown" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${bot.name}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setShareOpen(false);
                }}
                className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] transition hover:bg-white/[0.07]"
              >
                Download as Markdown
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Not `relative` on purpose: the computer panel's full view is positioned against the whole chat, header included. */}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            }}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-6 pb-6 pt-4">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showTime = mounted && (!prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 30 * 60_000);
                const next = messages[i + 1];
                return (
                  <div key={m.id} className="contents">
                    {showTime && <div className="py-3 text-center text-[12.5px] text-neutral-400">{formatWhen(m.createdAt)}</div>}
                    {m.role === "user" ? (
                      <UserBubble text={m.content} />
                    ) : (
                      <AssistantBlock
                        text={m.content}
                        steps={(m.steps ?? []).map((s) => ({ id: s.id, name: s.name, label: s.label, status: s.ok ? "done" : "error", output: s.output }))}
                        choices={m.choices}
                        picked={next?.role === "user" ? next.content : undefined}
                        choicesDisabled={busy || i < lastUserIdx}
                        onPick={(o) => {
                          if (/something else/i.test(o)) inputRef.current?.focus();
                          else send(o);
                        }}
                        streaming={false}
                      />
                    )}
                  </div>
                );
              })}

              {live && (live.text || live.steps.length || live.choices) && (
                <AssistantBlock text={live.text} steps={live.steps} choices={live.choices} choicesDisabled onPick={() => {}} streaming />
              )}

              {(messages.length > 0 || busy) && <div className="flex items-center gap-4 pb-2 pl-1 pt-5">
                <BotAvatar shape={bot.shape} color={bot.color} size={52} working={busy} />
                {busy && (
                  <span className="shimmer-text text-[14px] font-medium">
                    {(() => {
                      const run = live?.steps.filter((s) => s.status === "running").pop();
                      return run ? run.label : live?.text ? "Writing…" : "Thinking…";
                    })()}
                  </span>
                )}
              </div>}

              {error && (
                <div role="alert" className="fade-up flex max-w-[min(740px,100%)] items-start gap-3 rounded-2xl border border-[#4a1c22] bg-[#241013] px-4 py-3 text-[13.5px] text-[#ff9aa6]">
                  <span className="flex-1 leading-relaxed">{error.message}</span>
                  {(error.code === "no_key" || error.code === "no_model" || /api key|rejected/i.test(error.message)) && (
                    <button onClick={() => app.openSettings("ai")} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-white/20">
                      Open settings
                    </button>
                  )}
                  <button onClick={() => setError(null)} aria-label="Dismiss" className="shrink-0 text-neutral-400 hover:text-white">
                    <Icon name="close" size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-[1200px]">
            {!app.settings.hasAiKey && (
              <div className="mx-6 mb-1 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-2.5 text-[13px] text-amber-200">
                <span>{bot.name} needs an API key to reply.</span>
                <button onClick={() => app.openSettings("ai")} className="rounded-full bg-amber-300 px-3.5 py-1.5 text-[12.5px] font-semibold text-black transition hover:bg-amber-200">
                  Add key
                </button>
              </div>
            )}
            <EmailApprovals botId={botId} busy={busy} />
            <Composer
              value={input}
              onChange={setInput}
              onSend={submit}
              onStop={stop}
              busy={busy}
              placeholder={placeholder}
              voiceOn={app.settings.voiceReplies}
              onToggleVoice={() => {
                const v = !app.settings.voiceReplies;
                app.patchSettings({ voiceReplies: v });
                app.toast(v ? "Replies will be read aloud." : "Voice replies off.");
                if (!v && "speechSynthesis" in window) window.speechSynthesis.cancel();
              }}
              attachments={attachments}
              setAttachments={setAttachments}
              inputRef={inputRef}
              onError={(m) => app.toast(m, "err")}
            />
          </div>
        </section>

        {panelOpen && (
          <ComputerPanel
            bot={bot}
            hasE2b={app.settings.hasE2bKey}
            tab={tab}
            onTab={setTab}
            agentBusy={busy}
            activity={usingComputer ? runningStep.label : null}
            externalShot={shot}
            expanded={expanded}
            onToggleExpand={toggleExpanded}
            onClose={closePanel}
            onOpenSettings={() => app.openSettings("computer")}
            onPhase={onComputerPhase}
            onError={onComputerError}
          />
        )}
      </div>
    </div>
  );
}
