"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import type { ChoicesRecord, StepRecord } from "@/db/schema";
import type { MessageDTO } from "@/lib/bots";
import { useApp } from "../AppProvider";
import { BotAvatar } from "../BotAvatar";
import { Icon } from "../icons";
import { cx } from "../ui";
import { Composer, ComposerMode, type Attachment } from "./Composer";
import { ComputerPanel, type ComputerTab } from "./ComputerPanel";
import { AssistantBlock, UserBubble, type ArtifactRef, type LiveStep } from "./Message";
import { ModelPicker } from "./ModelPicker";
import type { ComputerPhase } from "./useComputer";
import { Menu, placeMenu, type MenuItem, type MenuPosition } from "../Menu";

type Live = { text: string; steps: LiveStep[]; choices: ChoicesRecord | null };
type StreamEvent =
  | { t: "start"; userMessage: { id: string; createdAt: string } }
  | { t: "text"; d: string }
  | { t: "step"; id: string; name: string; label: string }
  | { t: "step_done"; id: string; ok: boolean; output?: string; artifactId?: string }
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
const NO_COMPUTER = new Set(["ask_user", "get_current_time", "draft_email", "save_artifact"]);

const subscribeNothing = () => () => {};
/** False during server rendering and hydration, true afterwards. */
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);
const readPrivacy = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not verify Privacy Mode.");
  return response.json() as Promise<{ status: "active" | "idle" }>;
};

function speak(markdown: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const text = markdown.replace(/```[\s\S]*?```/g, " code block ").replace(/[#*_`>~[\]()]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 1500)));
}

/** Prompt suggestions on the empty conversation, one per thing a bot is good at. */
const SUGGESTIONS: Array<{ title: string; hint: string; prompt: string; icon: "search" | "sparkles" | "mail" | "monitor" }> = [
  { title: "Research something", hint: "Search the web and summarise it", prompt: "Research a topic for me: ", icon: "search" },
  { title: "Plan my day", hint: "Turn a messy list into a schedule", prompt: "Help me plan my day. Here's what I have: ", icon: "sparkles" },
  { title: "Draft an email", hint: "Write it, then send it from here", prompt: "Draft an email for me. ", icon: "mail" },
  { title: "Use the computer", hint: "Watch it work on a live desktop", prompt: "Open a browser and show me what you can do.", icon: "monitor" },
];

export function ChatView({ botId, initialMessages, initialPrivacyMode = false }: { botId: string; initialMessages: MessageDTO[]; initialPrivacyMode?: boolean }) {
  const app = useApp();
  const { setWorking, toast } = app;
  const router = useRouter();
  const bot = app.bots.find((b) => b.id === botId);
  const { data: privacyState } = useSWR("/api/privacy", readPrivacy, { fallbackData: initialPrivacyMode ? { status: "active" as const } : undefined, revalidateOnFocus: true });
  const privacyActive = privacyState?.status === "active" || (initialPrivacyMode && privacyState?.status !== "idle");

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
  const [share, setShare] = useState<{ position: MenuPosition; trigger: HTMLElement } | null>(null);
  const [botMenu, setBotMenu] = useState<{ position: ReturnType<typeof placeMenu>; trigger: HTMLElement } | null>(null);
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactRef>>({});
  const mounted = useHydrated();

  const acc = useRef<Live>({ text: "", steps: [], choices: null });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const frame = useRef(0);

  /** Set when the person closes the panel mid-run, so the next step doesn't pop it back open. */
  const panelDismissed = useRef(false);

  /* ---------- artifacts referenced by steps ---------- */
  const wanted = (() => {
    const ids = new Set<string>();
    for (const m of messages) for (const s of m.steps ?? []) if (s.artifactId) ids.add(s.artifactId);
    for (const s of live?.steps ?? []) if (s.artifactId) ids.add(s.artifactId);
    return [...ids].filter((id) => !artifacts[id]);
  })();
  const wantedKey = wanted.join(",");

  useEffect(() => {
    if (!wantedKey) return;
    let alive = true;
    for (const id of wantedKey.split(",")) {
      fetch(`/api/artifacts/${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((a: ArtifactRef | null) => {
          if (alive && a?.id) setArtifacts((prev) => ({ ...prev, [a.id]: a }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [wantedKey]);

  const artifactRefs = (steps: Array<{ artifactId?: string }> | null | undefined): ArtifactRef[] =>
    (steps ?? []).map((s) => (s.artifactId ? artifacts[s.artifactId] : undefined)).filter((a): a is ArtifactRef => !!a);

  useEffect(() => {
    if (privacyActive) abortRef.current?.abort();
  }, [privacyActive]);

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

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    // `mounted` is here because the timestamps appear after hydration and push the last
    // message down; `artifacts` because a draft card arrives after the message is painted.
  }, [messages, live, busy, error, mounted, artifacts]);

  const flush = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setLive({ text: acc.current.text, steps: acc.current.steps.map((s) => ({ ...s })), choices: acc.current.choices });
    });
  }, []);

  const send = useCallback(
    async (raw: string, atts: Attachment[] = []) => {
      if (busy || !bot || privacyActive) return;
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
      abortRef.current = ac;
      let finalized = false;

      const finalize = (info: { id: string; createdAt: string } | null) => {
        if (finalized) return;
        finalized = true;
        if (frame.current) {
          cancelAnimationFrame(frame.current);
          frame.current = 0;
        }
        const a = acc.current;
        if (privacyActive) {
          setLive(null);
          setBusy(false);
          setWorking(null);
          return;
        }
        if (a.text.trim() || a.steps.length || a.choices) {
          const msg: MessageDTO = {
            id: info?.id ?? `local-${Date.now()}`,
            role: "assistant",
            content: a.text.trim(),
            steps: a.steps.map((s) => ({ id: s.id, name: s.name, label: s.label, ok: s.status !== "error", output: s.output, artifactId: s.artifactId })),
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
              if (ev.artifactId) s.artifactId = ev.artifactId;
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
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError({ message: "The connection was interrupted." });
        }
      } finally {
        finalize(null);
      }
    },
    [app, bot, botId, busy, flush, privacyActive, setWorking],
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

  /** A conversation that only holds the greeting gets the full welcome screen. */
  const empty = messages.length <= 1 && messages.every((m) => m.role === "assistant") && !busy;

  const openArtifacts = () => app.openSettings("artifacts");
  /**
   * Starts the conversation over. The old one is archived by the server first, so
   * "clear" never means "lose" — it is in Settings → History if it's wanted back.
   */
  const clearConversation = async () => {
    if (busy) return;
    const ok = await app.confirm({
      title: "Start a new chat?",
      body: `This conversation moves to History and ${bot?.name ?? "the bot"} says hello again.`,
      confirmLabel: "New chat",
    });
    if (!ok) return;
    try {
      const response = await fetch(`/api/bots/${botId}/messages`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as { greeting?: string };
      if (!response.ok) throw new Error("Couldn't clear this conversation.");
      setLive(null);
      setError(null);
      setMessages([
        {
          id: `greeting-${Date.now()}`,
          role: "assistant",
          content: result.greeting ?? "Hi — ready when you are. What should we work on?",
          steps: null,
          choices: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      // Keep the sidebar line in step with the conversation that is now on screen.
      if (result.greeting) app.setPreview(botId, result.greeting);
      app.toast("New chat started.");
    } catch (reason) {
      app.toast(reason instanceof Error ? reason.message : "Couldn't clear this conversation.", "err");
    }
  };

  const botMenuItems: MenuItem[] = [
    { label: "New chat", icon: "plus", onSelect: () => void clearConversation() },
    { label: "Edit look & name", icon: "pencil", onSelect: () => app.openBotDialog(bot.id) },
    { label: "Artifacts", icon: "file", onSelect: openArtifacts },
    { label: "Conversation history", icon: "chat", onSelect: () => app.openSettings("history") },
    { label: "Bot settings", icon: "gear", onSelect: () => app.openSettings("skills") },
  ];

  const copyConversation = async () => {
    await navigator.clipboard.writeText(buildMarkdown()).catch(() => {});
    app.toast("Conversation copied.");
  };
  const downloadConversation = () => {
    const url = URL.createObjectURL(new Blob([buildMarkdown()], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bot.name}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const shareItems: MenuItem[] = [
    { label: "Copy conversation", icon: "copy", onSelect: () => void copyConversation() },
    { label: "Download as Markdown", icon: "download", onSelect: downloadConversation },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="relative z-20 flex h-16 shrink-0 items-center gap-2 px-3 sm:px-4">
        <button onClick={() => app.setSidebarOpen(true)} aria-label="Open sidebar" className="grid size-9 shrink-0 place-items-center rounded-full text-neutral-300 transition hover:bg-white/[0.07] md:hidden">
          <Icon name="menu" size={18} />
        </button>

        {/* Bot identity + menu */}
        <div className="relative min-w-0">
          <button
            onClick={(e) => {
              if (botMenu) return setBotMenu(null);
              setBotMenu({ position: placeMenu(e.currentTarget.getBoundingClientRect(), botMenuItems.length, { align: "start" }), trigger: e.currentTarget });
            }}
            aria-haspopup="menu"
            aria-expanded={!!botMenu}
            aria-label={`${bot.name} options`}
            className="group flex min-w-0 items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-2.5 transition hover:bg-white/[0.06] active:scale-[0.98]"
          >
            <BotAvatar shape={bot.shape} color={bot.color} size={26} />
            <span className="max-w-[38vw] truncate text-[14.5px] font-medium sm:max-w-[200px]">{bot.name}</span>
            <Icon name="chevron" size={13} className="shrink-0 text-neutral-500 transition group-hover:text-neutral-300" />
          </button>
        </div>

        <div className="flex-1" />
        <div className="relative">
          <button
            onClick={(e) => {
              if (share) return setShare(null);
              setShare({ position: placeMenu(e.currentTarget.getBoundingClientRect(), shareItems.length, { align: "end" }), trigger: e.currentTarget });
            }}
            aria-haspopup="menu"
            aria-expanded={!!share}
            aria-label="Share"
            className={cx(
              "grid size-9 place-items-center rounded-full transition active:scale-95 max-md:text-neutral-300",
              share ? "bg-white/[0.1] text-white" : "text-neutral-400 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            <Icon name="external" size={16} />
          </button>
        </div>
        {share && <Menu label="Share" items={shareItems} position={share.position} trigger={share.trigger} onClose={() => setShare(null)} />}
        {botMenu && <Menu label={`${bot.name} options`} items={botMenuItems} position={botMenu.position} trigger={botMenu.trigger} onClose={() => setBotMenu(null)} />}
      </header>

      {/* Not `relative` on purpose: the computer panel's full view is positioned against the whole chat, header included. */}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          {empty ? (
            <EmptyChat
              botId={bot.id}
              name={bot.name}
              shape={bot.shape}
              color={bot.color}
              hasComputer={app.settings.hasE2bKey}
              onPick={(prompt) => void send(prompt)}
            />
          ) : (
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
              }}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-4 pb-8 pt-2 sm:px-6">
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const showTime = mounted && (!prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 30 * 60_000);
                  const next = messages[i + 1];
                  return (
                    <div key={m.id} className="contents">
                      {showTime && <div className="py-3 text-center text-[11.5px] text-neutral-600">{formatWhen(m.createdAt)}</div>}
                      {m.role === "user" ? (
                        <UserBubble text={m.content} />
                      ) : (
                        <AssistantBlock
                          text={m.content}
                          steps={(m.steps ?? []).map((s) => ({ id: s.id, name: s.name, label: s.label, status: s.ok ? "done" : "error", output: s.output, artifactId: s.artifactId }))}
                          artifacts={artifactRefs(m.steps)}
                          choices={m.choices}
                          picked={next?.role === "user" ? next.content : undefined}
                          choicesDisabled={busy || i < lastUserIdx}
                          onPick={(o) => {
                            if (/something else/i.test(o)) inputRef.current?.focus();
                            else send(o);
                          }}
                          streaming={false}
                          avatar={<BotAvatar shape={bot.shape} color={bot.color} size={26} follow={false} />}
                          onOpenArtifact={openArtifacts}
                        />
                      )}
                    </div>
                  );
                })}

                {live && (live.text || live.steps.length || live.choices) && (
                  <AssistantBlock
                    text={live.text}
                    steps={live.steps}
                    artifacts={artifactRefs(live.steps)}
                    choices={live.choices}
                    choicesDisabled
                    onPick={() => {}}
                    streaming
                    avatar={<BotAvatar shape={bot.shape} color={bot.color} size={26} follow={false} />}
                    onOpenArtifact={openArtifacts}
                  />
                )}

                {busy && (
                  <div className="flex items-center gap-3 pl-10">
                    <BotAvatar shape={bot.shape} color={bot.color} size={22} working />
                    <span className="shimmer-text text-[13px] font-medium">
                      {(() => {
                        const run = live?.steps.filter((s) => s.status === "running").pop();
                        return run ? run.label : live?.text ? "Writing…" : "Thinking…";
                      })()}
                    </span>
                  </div>
                )}

                {error && (
                  <div role="alert" className="fade-up flex max-w-[min(740px,100%)] items-start gap-3 rounded-2xl border border-[#4a1c22] bg-[#241013] px-4 py-3 text-[13px] text-[#ff9aa6]">
                    <span className="flex-1 leading-relaxed">{error.message}</span>
                    {(error.code === "no_key" || error.code === "no_model" || /api key|rejected/i.test(error.message)) && (
                      <button onClick={() => app.openSettings("ai")} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-white/20">
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
          )}

          <div className="mx-auto w-full max-w-[820px]">
            {!app.settings.hasAiKey && (
              <div className="mx-4 mb-1 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-2.5 text-[12.5px] text-amber-200 sm:mx-6">
                <span>{bot.name} needs an API key to reply.</span>
                <button onClick={() => app.openSettings("ai")} className="shrink-0 rounded-full bg-amber-300 px-3.5 py-1.5 text-[12px] font-semibold text-black transition hover:bg-amber-200">
                  Add key
                </button>
              </div>
            )}
            <Composer
              value={input}
              onChange={setInput}
              onSend={submit}
              onStop={stop}
              busy={busy}
              placeholder={placeholder}
              attachments={attachments}
              setAttachments={setAttachments}
              inputRef={inputRef}
              onError={(m) => app.toast(m, "err")}
              modes={
                <>
                  <ModelPicker botId={bot.id} variant="chip" />
                  <ComposerMode
                    active={panelOpen}
                    onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}
                    icon={<Icon name="monitor" size={14} />}
                    label="Show the bot's computer"
                  >
                    <span className="max-sm:hidden">Computer</span>
                  </ComposerMode>
                  <ComposerMode
                    active={app.settings.voiceReplies}
                    onClick={() => {
                      const v = !app.settings.voiceReplies;
                      app.patchSettings({ voiceReplies: v });
                      app.toast(v ? "Replies will be read aloud." : "Voice replies off.");
                      if (!v && "speechSynthesis" in window) window.speechSynthesis.cancel();
                    }}
                    icon={<Icon name="volume" size={14} />}
                    label={app.settings.voiceReplies ? "Voice replies on" : "Read replies aloud"}
                  >
                    <span className="max-sm:hidden">Voice</span>
                  </ComposerMode>
                </>
              }
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

/** The welcome screen: who you're talking to and four ways to start. */
function EmptyChat({
  name,
  shape,
  color,
  hasComputer,
  onPick,
}: {
  botId: string;
  name: string;
  shape: string;
  color: string;
  hasComputer: boolean;
  onPick: (prompt: string) => void;
}) {
  const suggestions = SUGGESTIONS.filter((s) => hasComputer || s.icon !== "monitor");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-4 pt-6">
      <div className="relative">
        <div aria-hidden className="absolute inset-0 -z-10 scale-[2.4] rounded-full bg-[radial-gradient(closest-side,rgba(124,140,255,0.22),transparent)] blur-2xl" />
        <div className="glow-in">
          <BotAvatar shape={shape} color={color} size={88} />
        </div>
      </div>
      <h1 className="mt-6 text-center text-[28px] font-semibold tracking-[-0.035em] text-white sm:text-[34px]">Hey, I&apos;m {name}.</h1>
      <p className="mt-1.5 text-[14.5px] text-neutral-500">What can I do for you?</p>

      <div className="mt-8 grid w-full max-w-[600px] grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="group flex items-start gap-3 rounded-[18px] border border-white/[0.07] bg-white/[0.02] p-3.5 text-left transition hover:border-white/[0.16] hover:bg-white/[0.05] active:scale-[0.99]"
          >
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-neutral-300 transition group-hover:border-white/[0.14] group-hover:text-white">
              <Icon name={s.icon} size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium text-neutral-200">{s.title}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-neutral-500">{s.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
