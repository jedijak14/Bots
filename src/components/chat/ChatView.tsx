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
import { BriefCard } from "./BriefCard";
import type { IconName } from "../icons";
import type { ComputerPhase } from "./useComputer";
import { Menu, placeMenu, type MenuItem, type MenuPosition } from "../Menu";

type Live = { text: string; steps: LiveStep[]; choices: ChoicesRecord | null };
/** Whether this turn was optimised, and what to tell the user about that. */
type OptimiseNote = { state: "on" | "off" | "failed"; level: string; why: string };
type LiveHelper = { id: string; name: string; state: "working" | "done" | "failed" };

/** Total time of a finished assistant turn, from the stored per-tool timings. */
const stepsElapsed = (steps: Array<{ ms?: number }>) => steps.reduce((sum, s) => sum + (s.ms ?? 0), 0);
type StreamEvent =
  | { t: "start"; userMessage: { id: string; createdAt: string } }
  | { t: "text"; d: string }
  | { t: "step"; id: string; name: string; label: string }
  | { t: "step_done"; id: string; ok: boolean; output?: string; ms?: number; artifactId?: string }
  | { t: "shot"; data: string }
  | { t: "packs"; packs: Array<{ id: string; title: string }> }
  | { t: "helper"; helper: LiveHelper }
  | { t: "optimise"; state: "on" | "off" | "failed"; level: string; why: string }
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

/** Narrow screens get the short form of long placeholder copy (see the composer). */
function useNarrow(query = "(max-width: 639px)") {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
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

/**
 * What this Bot can do, shown under the greeting.
 *
 * These used to be four full-width cards; four stacked cards read as a quiz.
 * They are now chips — a capability line, not a questionnaire — and the middle
 * of the screen stays open for whatever the person actually came to say.
 */
const CAPABILITIES: Array<{ label: string; prompt: string; icon: IconName }> = [
  { label: "Plan my day", prompt: "Look at my open goals and plan my day. Tell me what to do first and why.", icon: "target" },
  { label: "Catch me up", prompt: "Catch me up: what did we work on recently, and what is still outstanding?", icon: "clock" },
  { label: "Research the web", prompt: "Research a topic for me: ", icon: "search" },
  { label: "Draft an email", prompt: "Draft an email for me. ", icon: "mail" },
  { label: "Write it down", prompt: "Save this to my artifacts: ", icon: "archive" },
  { label: "Use the computer", prompt: "Open a browser and show me what you can do.", icon: "monitor" },
];

export function ChatView({ botId, initialMessages, initialPrivacyMode = false }: { botId: string; initialMessages: MessageDTO[]; initialPrivacyMode?: boolean }) {
  const app = useApp();
  const { setWorking, toast } = app;
  const router = useRouter();
  const bot = app.bots.find((b) => b.id === botId);
  const { data: privacyState, mutate: mutatePrivacy } = useSWR("/api/privacy", readPrivacy, { fallbackData: initialPrivacyMode ? { status: "active" as const } : undefined, revalidateOnFocus: true });
  const privacyActive = privacyState?.status === "active" || (initialPrivacyMode && privacyState?.status !== "idle");

  const [messages, setMessages] = useState<MessageDTO[]>(initialMessages);
  const [live, setLive] = useState<Live | null>(null);
  const [liveHelpers, setLiveHelpers] = useState<LiveHelper[]>([]);
  /** Packs the server loaded for this turn — shown so the choice is visible. */
  const [livePacks, setLivePacks] = useState<Array<{ id: string; title: string }>>([]);
  /** Set when this run starts, so the reasoning line can count up. */
  const [liveStart, setLiveStart] = useState<number | null>(null);
  const [optimise, setOptimise] = useState<OptimiseNote | null>(null);
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
  // Hooks must stay above the `if (!bot) return null` below.
  const narrow = useNarrow();

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

  /**
   * The artifacts a message produced, one of each.
   *
   * Every step that touched a project carries its id — opening it, adding a
   * clip, editing it — so these were rendered once per step. A six-step music
   * build showed the same card six times, each a live player. The first
   * appearance is the one that stays, so the card sits where the work began.
   */
  const artifactRefs = (steps: Array<{ artifactId?: string }> | null | undefined): ArtifactRef[] => {
    const seen = new Set<string>();
    const out: ArtifactRef[] = [];
    for (const step of steps ?? []) {
      if (!step.artifactId || seen.has(step.artifactId)) continue;
      const artifact = artifacts[step.artifactId];
      if (!artifact) continue;
      seen.add(step.artifactId);
      out.push(artifact);
    }
    return out;
  };

  useEffect(() => {
    if (privacyActive) abortRef.current?.abort();
  }, [privacyActive]);

  useEffect(() => {
    if (!bot) router.replace("/bots");
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

  /**
   * The Bot offers Privacy Mode in chat rather than the app offering a button.
   * Choosing the privacy option opens the session for this Bot and refreshes
   * the state that pauses tools, without leaving the conversation.
   */
  const openPrivacy = useCallback(async () => {
    try {
      const response = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "take_control", botId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Could not open Privacy Mode.");
      await mutatePrivacy();
      app.toast("Privacy Mode is on — the Bot cannot see the screen.");
    } catch (reason) {
      app.toast(reason instanceof Error ? reason.message : "Could not open Privacy Mode.", "err");
    }
  }, [botId, app, mutatePrivacy]);

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
      setLiveHelpers([]);
      setOptimise(null);
      setLivePacks([]);
      setLive({ text: "", steps: [], choices: null });
      setLiveStart(Date.now());
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
              s.ms = ev.ms;
              if (ev.artifactId) s.artifactId = ev.artifactId;
            }
            setWorking({ id: botId, label: "Thinking…" });
            flush();
            break;
          }
          case "packs":
            setLivePacks(ev.packs);
            break;
          case "helper":
            setLiveHelpers((list) => {
              const next = list.filter((h) => h.id !== ev.helper.id);
              return [...next, ev.helper];
            });
            break;
          case "optimise":
            setOptimise({ state: ev.state, level: ev.level, why: ev.why });
            break;
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
  const empty = messages.length <= 1 && messages.every((m) => m.role === "assistant") && !busy;
  // Only when the question is actually on screen: with a lone greeting,
  // `lastMsg` is the welcome message, and asking the composer for an answer to a
  // question the person can't see reads as a bug.
  const awaiting = lastMsg?.role === "assistant" && !!lastMsg.choices && !busy && !empty;
  // 44 characters does not fit a 228px field at 390 without dropping below a
  // readable size, so narrow screens get a short form rather than a wrapped one.
  const placeholder = awaiting ? (narrow ? "Answer, or ask something else" : "Type your answer, or talk about something else") : `Message ${bot.name}`;

  const runningStep = busy ? (live?.steps.filter((x) => x.status === "running").pop() ?? null) : null;
  const usingComputer = !!runningStep && !NO_COMPUTER.has(runningStep.name);

  /** A conversation that only holds the greeting gets the full welcome screen (see `empty` above). */

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
            <BotAvatar shape={bot.shape} color={bot.color} size={26} working={busy} />
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
                          steps={(m.steps ?? []).map((s) => ({ id: s.id, name: s.name, label: s.label, status: s.ok ? "done" : "error", output: s.output, ms: s.ms, artifactId: s.artifactId }))}
                          artifacts={artifactRefs(m.steps)}
                          choices={m.choices}
                          picked={next?.role === "user" ? next.content : undefined}
                          choicesDisabled={busy || i < lastUserIdx}
                          onPick={(o) => {
                            if (/something else/i.test(o)) inputRef.current?.focus();
                            else if (m.choices?.action === "privacy" && o === m.choices.options[0]) {
                              void openPrivacy();
                              send(o);
                            } else send(o);
                          }}
                          streaming={false}
                          startedAt={m.steps?.length ? stepsElapsed(m.steps) : null}
                          avatar={<BotAvatar shape={bot.shape} color={bot.color} size={26} follow={false} />}
                          onOpenArtifact={openArtifacts}
                        />
                      )}
                    </div>
                  );
                })}

                {/* One chip, and only when reasoning is doing something worth
                    saying: on, failed, or unavailable after being asked for. A
                    silent "off" is the normal case and needs no furniture. */}
                {optimise && optimise.state !== "off" ? (
                  <div className="mb-2 ml-0 flex max-w-[min(740px,100%)] flex-wrap items-center gap-1.5">
                    <span
                      className={cx(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                        optimise.state === "on"
                          ? "border-white/[0.08] bg-white/[0.03] text-neutral-400"
                          : "border-amber-400/25 bg-amber-400/[0.06] text-amber-200/90",
                      )}
                      title={optimise.why}
                    >
                      <span aria-hidden className={cx("size-1.5 rounded-full", optimise.state === "on" ? "bg-emerald-400" : "bg-amber-400")} />
                      {optimise.state === "on" ? `Reasoning: ${optimise.level} — ${optimise.why}` : `Reasoning unavailable: ${optimise.why}`}
                    </span>
                  </div>
                ) : null}

                {liveHelpers.length > 0 && (
                  <div className="mb-3 ml-0 flex max-w-[min(740px,100%)] flex-wrap gap-1.5">
                    {livePacks.map((pack) => (
                      <span
                        key={pack.id}
                        className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-neutral-400"
                      >
                        {pack.title}
                      </span>
                    ))}
                    {liveHelpers.map((helper) => (
                      <span
                        key={helper.id}
                        className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-neutral-400"
                      >
                        <span
                          aria-hidden
                          className={cx(
                            "size-1.5 rounded-full",
                            helper.state === "done" ? "bg-emerald-400" : helper.state === "failed" ? "bg-rose-400" : "animate-pulse bg-[#7c9bff]",
                          )}
                        />
                        Helper · {helper.name}
                      </span>
                    ))}
                  </div>
                )}

                {live && (live.text || live.steps.length || live.choices) && (
                  <AssistantBlock
                    text={live.text}
                    steps={live.steps}
                    artifacts={artifactRefs(live.steps)}
                    choices={live.choices}
                    choicesDisabled
                    onPick={() => {}}
                    streaming
                    startedAt={liveStart}
                    avatar={<BotAvatar shape={bot.shape} color={bot.color} size={26} follow={false} working />}
                    onOpenArtifact={openArtifacts}
                  />
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
              botId={bot.id}
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
  const capabilities = CAPABILITIES.filter((c) => hasComputer || c.icon !== "monitor");
  return (
    // The floor height keeps the middle of the screen from feeling empty on a
    // tall viewport while still letting the block scroll on a short one.
    <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-4 pt-6">
      <div className="relative">
        <div aria-hidden className="absolute inset-0 -z-10 scale-[2.4] rounded-full bg-[radial-gradient(closest-side,rgba(124,140,255,0.22),transparent)] blur-2xl" />
        <div className="glow-in">
          <BotAvatar shape={shape} color={color} size={64} />
        </div>
      </div>
      <h1 className="mt-6 text-center text-[28px] font-semibold tracking-[-0.035em] text-white sm:text-[34px]">Hi, I&apos;m {name}.</h1>
      <p className="mt-1.5 text-[14.5px] text-neutral-500">What are we working on?</p>

      <BriefCard />

      <div className="mt-7 flex max-w-[560px] flex-wrap items-center justify-center gap-1.5">
        {capabilities.map((c, i) => (
          <button
            key={c.label}
            onClick={() => onPick(c.prompt)}
            style={{ animationDelay: `${i * 55}ms` }}
            className="fade-up flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] py-1.5 pl-2.5 pr-3 text-[12.5px] text-neutral-400 transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white active:scale-[0.98]"
          >
            <Icon name={c.icon} size={12} className="text-neutral-500" />
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
