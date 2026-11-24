"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BotAvatar } from "@/components/BotAvatar";
import { cx } from "@/components/ui";

/**
 * Reveals children the first time they scroll near the viewport. Uses one
 * IntersectionObserver per element and disconnects after the reveal, so the
 * landing page costs nothing once it has been read.
 */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // No observer (very old browser, or scripting restricted): the CSS
    // `scripting: none` fallback and this attribute both keep the content
    // visible rather than stuck at opacity 0.
    if (typeof IntersectionObserver === "undefined") {
      node.dataset.shown = "true";
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          // Write straight to the DOM: one attribute flip does not need a
          // re-render, and this keeps the effect free of a state update.
          if (node) node.dataset.shown = "true";
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-shown={false}
      className={cx("land-reveal", className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Cycles through phrases in the headline. The slot is measured from the word
 * that is about to show, then animated to that width, so a short word does not
 * leave a hole the size of the longest one. The full list is exposed to screen
 * readers once, and the animated copy is hidden from them.
 */
export function RotatingWord({ words, label }: { words: readonly string[]; label: string }) {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState<number | null>(null);
  const measure = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (words.length < 2) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % words.length), 3000);
    return () => window.clearInterval(id);
  }, [words.length]);

  // Measure synchronously on mount so the slot is already the right size on
  // the first frame — otherwise the longest word starts in a slot sized for
  // the shortest and spills across the rest of the headline.
  useLayoutEffect(() => {
    const node = measure.current;
    if (!node) return;
    const next = node.getBoundingClientRect().width;
    if (next > 0) setWidth((current) => (current === null ? Math.ceil(next) : current));
  }, []);

  // Growing the slot is safe; shrinking it is not. The visible word is already
  // full size on the frame the slot starts shrinking, so for the length of the
  // width transition it covers whatever follows the word — "research" printed
  // straight over "done". Hold the widest word and let the extra space sit at
  // the end of the line instead.
  useLayoutEffect(() => {
    const node = measure.current;
    if (!node) return;
    const next = Math.ceil(node.getBoundingClientRect().width);
    if (next > 0) setWidth((current) => (current === null || next > current ? next : current));
  }, [index]);

  return (
    <>
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className="relative inline-block whitespace-nowrap align-baseline"
        style={{ width: width ?? undefined, transition: "width 420ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        {/* Establishes the line box: both the measurer and the visible word are
            out of flow, so without this the slot would have zero height and the
            gradient text would be clipped away entirely. */}
        <span aria-hidden className="invisible select-none">
          &#8203;
        </span>
        <span
          ref={measure}
          className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap"
        >
          {words[index]}
        </span>
        <span className="land-word absolute inset-y-0 left-0 max-w-full overflow-hidden whitespace-nowrap bg-gradient-to-r from-[#a8c0ff] via-[#c4b5fd] to-[#7dd3fc] bg-clip-text text-transparent">
          {words[index]}
        </span>
      </span>
    </>
  );
}

/** Two rows of Bot faces drifting in opposite directions. */
export function BotMarquee({ rows }: { rows: Array<Array<{ shape: string; color: string; name: string }>> }) {
  return (
    <div className="relative overflow-hidden py-2 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)] [-webkit-mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className="space-y-4">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="land-marquee-track flex gap-4">
            {[0, 1].map((copy) => (
              <div key={copy} aria-hidden={copy === 1} className="flex shrink-0 gap-4">
                {row.map((bot, i) => (
                  <div
                    key={`${copy}-${i}`}
                    className="flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5 backdrop-blur"
                    style={{ animationDirection: rowIndex % 2 ? "reverse" : "normal" }}
                  >
                    <BotAvatar shape={bot.shape} color={bot.color} size={26} follow={false} />
                    <span className="whitespace-nowrap text-[12.5px] font-medium text-neutral-300">{bot.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A pointer-tracked spotlight for the hero: the glow follows the cursor with a
 * CSS variable instead of re-rendering React on every move.
 */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = node.getBoundingClientRect();
        node.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
        node.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
        node.style.setProperty("--spot-on", "1");
      });
    };
    node.addEventListener("pointermove", onMove as EventListener, { passive: true });
    return () => {
      node.removeEventListener("pointermove", onMove as EventListener);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={cx("relative", className)} style={{ "--spot-on": 0 } as React.CSSProperties}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[var(--spot-on)] transition-opacity duration-500 [background:radial-gradient(320px_circle_at_var(--spot-x,50%)_var(--spot-y,40%),rgba(124,155,255,0.16),transparent_70%)]"
      />
      {children}
    </div>
  );
}
