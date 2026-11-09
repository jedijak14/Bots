"use client";

import { useEffect, useRef, useState } from "react";
import { COLORS, getShape, isColor, isShape, pointsToPath, type Pt, type ShapeId } from "@/lib/shapes";
import { usePrefs } from "./prefs";

/* ------------------------------------------------------------------ *
 * One shared animation loop + one window pointer listener for every
 * avatar on screen. Each avatar registers a tick() that moves its eyes.
 * ------------------------------------------------------------------ */
type Mouse = { x: number; y: number; active: boolean };
type Tick = (now: number, m: Mouse) => void;
const ticks = new Set<Tick>();
const mouse: Mouse = { x: 0, y: 0, active: false };
let raf = 0;
let listening = false;

function loop(now: number) {
  ticks.forEach((t) => t(now, mouse));
  raf = ticks.size ? requestAnimationFrame(loop) : 0;
}

function subscribe(fn: Tick) {
  if (!listening) {
    listening = true;
    window.addEventListener(
      "pointermove",
      (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
      },
      { passive: true },
    );
    document.documentElement.addEventListener("pointerleave", () => (mouse.active = false));
  }
  ticks.add(fn);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    ticks.delete(fn);
  };
}

const easeOutBack = (t: number) => {
  const c1 = 1.35;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

type Eye = { cx: number; cy: number; gap: number };
type Anim = { from: Pt[]; to: Pt[]; fromEye: Eye; toEye: Eye; start: number; dur: number };

type Props = {
  shape: string;
  color: string;
  size?: number;
  working?: boolean;
  /** white ring around the body (used for the "selected" state in pickers) */
  outline?: boolean;
  /** play the burst + pop when first shown */
  celebrate?: boolean;
  follow?: boolean;
  className?: string;
};

const EYE_W = 7.4;
const EYE_H = 15;

export function BotAvatar({ shape, color, size = 40, working = false, outline = false, celebrate = false, follow = true, className }: Props) {
  const prefs = usePrefs();
  const shapeId: ShapeId = isShape(shape) ? shape : "circle";
  const hex = COLORS[isColor(color) ? color : "blue"].hex;

  const [initial] = useState(() => {
    const g = getShape(shapeId);
    return { d: pointsToPath(g.pts), eye: g.eye };
  });

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const leanRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<SVGPathElement>(null);
  const eyeL = useRef<SVGRectElement>(null);
  const eyeR = useRef<SVGRectElement>(null);

  const S = useRef({
    pts: getShape(shapeId).pts as Pt[],
    eye: { ...getShape(shapeId).eye } as Eye,
    anim: null as Anim | null,
    ox: 0,
    oy: 0,
    lx: 0,
    ly: 0,
    sq: 1,
    nx: 0,
    blinkNext: 0,
    blinkStart: -1,
    phase: Math.random() * 10,
    rect: null as DOMRect | null,
    rectAt: 0,
  });
  const live = useRef({ working, follow: follow && prefs.followMouse, animations: prefs.animations });
  live.current = { working, follow: follow && prefs.followMouse, animations: prefs.animations };

  const [fx, setFx] = useState<number | null>(null);

  const playFx = (withPop: boolean) => {
    if (!live.current.animations) return;
    setFx(Date.now());
    if (withPop) {
      wrapRef.current?.animate(
        [
          { transform: "scale(1,1)" },
          { transform: "scale(0.8,1.14)", offset: 0.22 },
          { transform: "scale(1.14,0.88)", offset: 0.5 },
          { transform: "scale(0.96,1.04)", offset: 0.75 },
          { transform: "scale(1,1)" },
        ],
        { duration: 700, easing: "ease-out" },
      );
    }
  };

  // clear the burst after it has played
  useEffect(() => {
    if (fx === null) return;
    const t = setTimeout(() => setFx(null), 950);
    return () => clearTimeout(t);
  }, [fx]);

  // main per-frame loop
  useEffect(() => {
    const s = S.current;
    s.blinkNext = performance.now() + 1200 + Math.random() * 2500;
    const tick: Tick = (now, m) => {
      const p = live.current;
      const svg = svgRef.current;
      if (!svg) return;

      // --- morph
      if (s.anim) {
        const a = s.anim;
        const raw = Math.min(1, (now - a.start) / a.dur);
        const e = raw >= 1 ? 1 : easeOutBack(raw);
        const pts = a.from.map((f, i) => [f[0] + (a.to[i][0] - f[0]) * e, f[1] + (a.to[i][1] - f[1]) * e] as Pt);
        s.pts = pts;
        s.eye = {
          cx: a.fromEye.cx + (a.toEye.cx - a.fromEye.cx) * e,
          cy: a.fromEye.cy + (a.toEye.cy - a.fromEye.cy) * e,
          gap: a.fromEye.gap + (a.toEye.gap - a.fromEye.gap) * e,
        };
        const d = pointsToPath(pts);
        pathRef.current?.setAttribute("d", d);
        ringRef.current?.setAttribute("d", d);
        if (raw >= 1) s.anim = null;
      }

      // --- where to look
      let tx = 0;
      let ty = 0;
      let lx = 0;
      let ly = 0;
      let sq = 1;
      let nx = 0;
      const w = now / 1000;
      if (p.working) {
        tx = Math.sin(w * 2.6 + s.phase) * 6.2;
        ty = -3.2 + Math.sin(w * 4.1) * 2.4;
        ly = Math.sin(w * 7) * 1.6;
        sq = 1 + Math.sin(w * 7 + 1) * 0.035;
        nx = tx / 7;
      } else if (p.follow && m.active) {
        if (!s.rect || now - s.rectAt > 250) {
          s.rect = svg.getBoundingClientRect();
          s.rectAt = now;
        }
        const r = s.rect;
        const dx = m.x - (r.left + r.width / 2);
        const dy = m.y - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        nx = dx / (dist + 70);
        const ny = dy / (dist + 70);
        tx = nx * 7.5;
        ty = ny * 6;
        lx = nx * 2.6;
        ly = ny * 2.2;
      } else {
        tx = Math.sin(w * 0.7 + s.phase) * 3;
        ty = Math.cos(w * 0.5 + s.phase) * 1.6;
      }
      s.ox += (tx - s.ox) * 0.18;
      s.oy += (ty - s.oy) * 0.18;
      s.lx += (lx - s.lx) * 0.12;
      s.ly += (ly - s.ly) * 0.12;
      s.sq += (sq - s.sq) * 0.2;
      s.nx += (nx - s.nx) * 0.18;

      // --- blink
      let blink = 1;
      if (!p.working) {
        if (now > s.blinkNext) {
          s.blinkStart = now;
          s.blinkNext = now + 2400 + Math.random() * 3600;
        }
        if (s.blinkStart > 0 && now - s.blinkStart < 170) {
          blink = 1 - Math.sin(((now - s.blinkStart) / 170) * Math.PI) * 0.92;
        }
      }

      leanRef.current?.setAttribute(
        "transform",
        `translate(${s.lx.toFixed(2)} ${s.ly.toFixed(2)}) translate(50 50) scale(${(1 / s.sq).toFixed(3)} ${s.sq.toFixed(3)}) translate(-50 -50)`,
      );

      const gap = s.eye.gap * (1 - Math.abs(s.nx) * 0.14);
      const cx = s.eye.cx + s.ox;
      const cy = s.eye.cy + s.oy;
      const h = EYE_H * blink;
      const y = (cy - h / 2).toFixed(2);
      const lxp = cx - gap / 2 - EYE_W / 2;
      const rxp = cx + gap / 2 - EYE_W / 2;
      eyeL.current?.setAttribute("x", lxp.toFixed(2));
      eyeL.current?.setAttribute("y", y);
      eyeL.current?.setAttribute("height", h.toFixed(2));
      eyeR.current?.setAttribute("x", rxp.toFixed(2));
      eyeR.current?.setAttribute("y", y);
      eyeR.current?.setAttribute("height", h.toFixed(2));
    };
    const unsub = subscribe(tick);
    return unsub;
  }, []);

  // morph when the shape changes
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return;
    const s = S.current;
    const to = getShape(shapeId);
    if (!live.current.animations) {
      s.anim = null;
      s.pts = to.pts;
      s.eye = { ...to.eye };
      const d = pointsToPath(to.pts);
      pathRef.current?.setAttribute("d", d);
      ringRef.current?.setAttribute("d", d);
      return;
    }
    s.anim = {
      from: s.pts.map((p) => [p[0], p[1]] as Pt),
      to: to.pts,
      fromEye: { ...s.eye },
      toEye: { ...to.eye },
      start: performance.now(),
      dur: 780,
    };
    playFx(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeId]);

  // keep the outline ring in sync if it appears after the shape has changed
  useEffect(() => {
    if (outline && ringRef.current) ringRef.current.setAttribute("d", pointsToPath(S.current.pts));
  }, [outline]);

  // pulse when the color changes
  useEffect(() => {
    if (first.current) return;
    playFx(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  useEffect(() => {
    if (celebrate) playFx(true);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dots = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const dist = size * (0.62 + (i % 3) * 0.12);
    return { dx: Math.cos(a) * dist, dy: Math.sin(a) * dist, s: Math.max(3, size * (0.07 + (i % 2) * 0.04)) };
  });

  return (
    <div
      ref={wrapRef}
      className={`relative inline-block shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {working && (
        <svg
          className="bot-orbit pointer-events-none absolute"
          style={{ inset: -size * 0.16, width: size * 1.32, height: size * 1.32 }}
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <circle cx="50" cy="50" r="47" fill="none" stroke={hex} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="36 260" opacity="0.9" />
          <circle cx="50" cy="50" r="47" fill="none" stroke={hex} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="10 140" strokeDashoffset="-150" opacity="0.5" />
        </svg>
      )}
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden="true"
        className={working ? "bot-wobble" : undefined}
        style={{
          overflow: "visible",
          filter: working ? `drop-shadow(0 0 ${Math.max(4, size * 0.14)}px ${hex}88)` : undefined,
          transition: "filter .4s ease",
        }}
      >
        <g ref={leanRef}>
          {outline && (
            <path
              ref={ringRef}
              d={initial.d}
              fill="none"
              stroke="rgba(255,255,255,0.92)"
              strokeWidth={3.2}
              transform="translate(50 50) scale(1.1) translate(-50 -50)"
              suppressHydrationWarning
            />
          )}
          <path
            ref={pathRef}
            d={initial.d}
            suppressHydrationWarning
            style={{ fill: hex, transition: "fill .55s ease" }}
          />
          <rect ref={eyeL} x={initial.eye.cx - initial.eye.gap / 2 - EYE_W / 2} y={initial.eye.cy - EYE_H / 2} width={EYE_W} height={EYE_H} rx={EYE_W / 2} fill="#0a0a0a" suppressHydrationWarning />
          <rect ref={eyeR} x={initial.eye.cx + initial.eye.gap / 2 - EYE_W / 2} y={initial.eye.cy - EYE_H / 2} width={EYE_W} height={EYE_H} rx={EYE_W / 2} fill="#0a0a0a" suppressHydrationWarning />
        </g>
      </svg>
      {fx !== null && (
        <div key={fx} className="pointer-events-none absolute inset-0" aria-hidden="true">
          <span
            className="absolute rounded-full"
            style={{
              inset: 0,
              border: `2px solid ${hex}`,
              animation: "bot-ring .8s ease-out forwards",
            }}
          />
          {dots.map((d, i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: "50%",
                top: "50%",
                width: d.s,
                height: d.s,
                marginLeft: -d.s / 2,
                marginTop: -d.s / 2,
                background: hex,
                ["--dx" as string]: `${d.dx}px`,
                ["--dy" as string]: `${d.dy}px`,
                animation: `bot-burst ${0.65 + (i % 3) * 0.1}s cubic-bezier(.2,.8,.3,1) ${i * 0.012}s forwards`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
