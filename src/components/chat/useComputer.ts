"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Everything the person (or the panel) can ask a bot's computer to do. */
export type ComputerAction =
  | { action: "screenshot" | "start" | "restart" }
  | { action: "navigate"; url: string }
  | { action: "click" | "doubleClick" | "rightClick"; x: number; y: number }
  | { action: "drag"; x: number; y: number; toX: number; toY: number }
  | { action: "scroll"; direction: "up" | "down"; amount: number; x?: number; y?: number }
  | { action: "type"; text: string }
  | { action: "key"; key: string[] };

/**
 * loading      first look at the computer hasn't come back yet
 * asleep       no computer is running for this bot
 * waking       a computer is being started
 * on           the computer is running and we have its screen
 * unreachable  something went wrong talking to it
 */
export type ComputerPhase = "loading" | "asleep" | "waking" | "on" | "unreachable";

type Reply = { active: boolean; image: string | null };

const WATCH_MS = 3000;
const CONTROL_MS = 1500;
const MAX_QUEUE = 24;

async function post(botId: string, body: ComputerAction): Promise<Reply> {
  const res = await fetch(`/api/bots/${botId}/computer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Partial<Reply> & { error?: string };
  if (!res.ok) throw new Error(j.error || "The computer isn't responding.");
  return { active: !!j.active, image: j.image ?? null };
}

/**
 * The connection to one bot's computer: what state it is in, its latest
 * screen, and a queue that sends the person's input one action at a time so
 * clicks and keystrokes always arrive in the order they were made.
 */
export function useComputer({
  botId,
  enabled,
  watching,
  inControl,
  agentBusy,
  externalShot,
  onActionError,
}: {
  botId: string;
  /** False when there is no E2B key: nothing is fetched. */
  enabled: boolean;
  /** True while the screen is actually on show; polling stops otherwise. */
  watching: boolean;
  inControl: boolean;
  agentBusy: boolean;
  /** Screenshots pushed by the bot while it works. */
  externalShot: { n: number; data: string } | null;
  onActionError: (message: string) => void;
}) {
  // Start from the last screenshot the bot sent, if there is one, so reopening the panel is instant.
  const [phase, setPhase] = useState<ComputerPhase>(externalShot ? "on" : "loading");
  const [image, setImage] = useState<string | null>(externalShot?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const queue = useRef<ComputerAction[]>([]);
  const running = useRef(false);
  const looking = useRef(false);
  /** Bumped whenever a newer screen arrives, so a slow poll can't overwrite it. */
  const version = useRef(0);
  const fails = useRef(0);
  const alive = useRef(true);
  const onError = useRef(onActionError);

  useEffect(() => {
    onError.current = onActionError;
  }, [onActionError]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queue.current = [];
    };
  }, []);

  // A screenshot from the bot is always the newest thing we know.
  const [seenShot, setSeenShot] = useState(externalShot?.n ?? 0);
  if (externalShot && externalShot.n !== seenShot) {
    setSeenShot(externalShot.n);
    setImage(externalShot.data);
    setPhase("on");
    setError(null);
  }
  useEffect(() => {
    version.current++;
    fails.current = 0;
  }, [externalShot]);

  /** A quiet look at the screen. Never starts a computer, never shows a spinner. */
  const look = useCallback(async () => {
    if (looking.current || running.current) return;
    looking.current = true;
    const at = version.current;
    try {
      const r = await post(botId, { action: "screenshot" });
      if (!alive.current || at !== version.current || running.current) return;
      fails.current = 0;
      if (!r.active) {
        setImage(null);
        setPhase((p) => (p === "waking" ? p : "asleep"));
      } else if (r.image) {
        setImage(r.image);
        setError(null);
        setPhase((p) => (p === "waking" ? p : "on"));
      } else {
        // Running, but it wouldn't give us a picture.
        setError("The computer is on, but its screen isn't available yet.");
        setPhase((p) => (p === "loading" ? "unreachable" : p));
      }
    } catch (e) {
      if (!alive.current || at !== version.current) return;
      fails.current++;
      const lost = fails.current >= 3;
      setError(e instanceof Error ? e.message : "The computer isn't responding.");
      // One missed poll keeps the last screen; several in a row means it's gone.
      setPhase((p) => (p === "loading" || (p === "on" && lost) ? "unreachable" : p));
    } finally {
      looking.current = false;
    }
  }, [botId]);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    while (queue.current.length && alive.current) {
      const a = queue.current.shift()!;
      try {
        const r = await post(botId, a);
        version.current++;
        fails.current = 0;
        if (!alive.current) break;
        if (r.image) setImage(r.image);
        setError(null);
        setPhase(r.active ? "on" : "asleep");
      } catch (e) {
        version.current++;
        if (!alive.current) break;
        // Anything queued behind a failed action was aimed at a screen we no longer trust.
        queue.current = [];
        const message = e instanceof Error ? e.message : "The computer isn't responding.";
        if (a.action === "start") {
          setError(message);
          setPhase("unreachable");
        } else {
          onError.current(message);
        }
      }
    }
    running.current = false;
    if (alive.current) setBusy(false);
  }, [botId]);

  /** Queue an action. Typing and scrolling that pile up while the computer is busy are merged. */
  const act = useCallback(
    (a: ComputerAction) => {
      const q = queue.current;
      const last = q[q.length - 1];
      if (a.action === "type" && last?.action === "type") {
        last.text += a.text;
      } else if (a.action === "scroll" && last?.action === "scroll" && last.direction === a.direction) {
        last.amount = Math.min(15, last.amount + a.amount);
        last.x = a.x;
        last.y = a.y;
      } else if (q.length < MAX_QUEUE) {
        q.push({ ...a });
      }
      void pump();
    },
    [pump],
  );

  const wake = useCallback(() => {
    setError(null);
    setPhase("waking");
    queue.current = [{ action: "start" }];
    void pump();
  }, [pump]);

  const retry = useCallback(() => {
    setError(null);
    setPhase("loading");
    fails.current = 0;
    void look();
  }, [look]);

  // Look once when the screen comes into view, and again whenever the bot stops working.
  useEffect(() => {
    if (!enabled || !watching) return;
    const t = setTimeout(() => void look(), 0);
    return () => clearTimeout(t);
  }, [enabled, watching, agentBusy, look]);

  // Keep the picture fresh while someone is watching. While the bot works it sends its own screenshots.
  const interval = inControl ? CONTROL_MS : WATCH_MS;
  useEffect(() => {
    if (!enabled || !watching || agentBusy || phase !== "on") return;
    const t = setInterval(() => {
      if (!document.hidden) void look();
    }, interval);
    const onVisible = () => {
      if (!document.hidden) void look();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, watching, agentBusy, phase, interval, look]);

  return { phase, image, error, busy, act, wake, retry, refresh: look };
}

export type Computer = ReturnType<typeof useComputer>;
