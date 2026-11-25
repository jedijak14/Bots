"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { VideoClip, VideoProjectSpec } from "@/lib/video-studio-spec";
import { gradeFilter, previewTime, projectDuration, transitionProgress } from "@/lib/video-studio-spec";
import { Icon } from "../icons";

/**
 * A video project, played in the chat.
 *
 * Not a re-implementation of the editor — an editable timeline is a page, and
 * there is one at /studio/video. This is the part that matters in a
 * conversation: a canvas that draws the timeline frame by frame on a clock, so
 * the Bot's work can be watched without leaving the chat. It plays; to change
 * anything, the Bot edits the project or the user opens the studio.
 *
 * The frame is drawn, not composed from <video> elements, because the clips may
 * be images, text, or trimmed video at different speeds on different layers, and
 * a DOM stack of those cannot be scrubbed reliably. One canvas, one clock.
 */

/** The resolved sources, fetched once so playback does not stall on each frame. */
type Loaded = Map<string, HTMLImageElement | HTMLVideoElement | HTMLAudioElement>;

function fitRect(iw: number, ih: number, cw: number, ch: number) {
  const scale = Math.min(cw / iw, ch / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

export function VideoStudioCard({ artifact }: { artifact: { id: string; title: string; content: string } }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  const rafRef = useRef<number>(0);
  const startedAt = useRef<number>(0);

  const spec = useMemo(() => {
    try {
      const parsed = JSON.parse(artifact.content) as VideoProjectSpec;
      return parsed?.tracks?.length ? parsed : null;
    } catch {
      return null;
    }
  }, [artifact.content]);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [error, setError] = useState("");

  const duration = spec ? projectDuration(spec) : 0;

  // Load every distinct source once. Images decode before playback can start;
  // a missing source is remembered as such so the frame can say so rather than
  // silently drawing nothing.
  const [sources, setSources] = useState<{ loaded: Loaded; missing: string[] }>({ loaded: new Map(), missing: [] });
  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    const loaded: Loaded = new Map();
    const missing: string[] = [];

    // An artifact id resolves through the JSON API, whose `content` is either a
    // data: URI (images, audio) or a page of HTML. A URL is used as it stands.
    async function resolveUrl(clip: VideoClip): Promise<string> {
      if (/^(data:|https?:)/.test(clip.source)) return clip.source;
      const res = await fetch(`/api/artifacts/${clip.source}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const j = (await res.json()) as { content?: string };
      return j.content ?? "";
    }

    (async () => {
      for (const track of spec.tracks) {
        for (const clip of track.clips) {
          if (clip.kind === "text" || !clip.source || loaded.has(clip.source)) continue;
          try {
            const url = await resolveUrl(clip);
            if (clip.kind === "image") {
              const img = new Image();
              img.src = url;
              await img.decode().catch(() => {});
              loaded.set(clip.source, img);
            } else if (clip.kind === "video") {
              const video = document.createElement("video");
              video.src = url;
              video.muted = true;
              video.playsInline = true;
              video.preload = "auto";
              await new Promise<void>((done) => {
                video.onloadeddata = () => done();
                video.onerror = () => done();
                setTimeout(done, 4000);
              });
              loaded.set(clip.source, video);
            } else {
              const audio = document.createElement("audio");
              audio.src = url;
              audio.preload = "auto";
              loaded.set(clip.source, audio);
              audioRefs.current.push(audio);
            }
          } catch {
            missing.push(clip.source);
          }
        }
      }
      if (!cancelled) {
        setSources({ loaded, missing });
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      for (const el of loaded.values()) {
        if (el.tagName === "AUDIO" || el.tagName === "VIDEO") (el as HTMLMediaElement).pause();
      }
      for (const url of Array.from(loaded.values()).map((el) => (el as HTMLImageElement).src)) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      audioRefs.current = [];
    };
  }, [spec]);

  // Draw one frame at `t` seconds.
  const draw = (t: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !spec) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = spec.background ?? "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Bottom track first, so the first track in the array ends up on top.
    for (const track of [...spec.tracks].reverse()) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (t < clip.start || t >= clip.start + clip.duration) continue;
        const local = (t - clip.start) * (clip.speed ?? 1);
        // Fades multiply opacity by how far into the fade we are.
        let alpha = clip.opacity ?? 1;
        if (clip.fadeIn) alpha *= Math.min(1, (t - clip.start) / Math.max(0.01, clip.fadeIn));
        if (clip.fadeOut) alpha *= Math.min(1, (clip.start + clip.duration - t) / Math.max(0.01, clip.fadeOut));
        // An entry effect multiplies the same alpha the fades use, so a clip
        // can fade up and wipe in without one cancelling the other.
        const entry = transitionProgress(clip, t);
        if (entry < 1 && clip.transition?.kind === "flash") alpha *= 1;
        if (entry < 1 && (clip.transition?.kind === "fade" || clip.transition?.kind === "iris")) alpha *= entry;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

        // Grading is a canvas filter, which applies to every draw until reset.
        const filter = gradeFilter(clip.grade);
        if (filter) ctx.filter = filter;

        // Non-fade entries move or mask the clip as it arrives.
        const kind = clip.transition?.kind;
        let restore: (() => void) | null = null;
        if (entry < 1 && kind && kind !== "fade" && kind !== "flash" && kind !== "iris") {
          ctx.save();
          const ease = 1 - Math.pow(1 - entry, 3);
          if (kind === "slide") {
            ctx.translate((1 - ease) * canvas.width, 0);
          } else if (kind === "wipe") {
            // A wipe reveals from the left by clipping to a growing rect.
            const w = canvas.width * ease;
            ctx.beginPath();
            ctx.rect(0, 0, w, canvas.height);
            ctx.clip();
          }
          restore = () => ctx.restore();
        }

        if (clip.kind === "text") {
          const text = clip.text?.text ?? clip.source;
          const style = clip.text?.style ?? "title";
          const size = style === "title" ? canvas.height * 0.085 : style === "subtitle" ? canvas.height * 0.055 : canvas.height * 0.04;
          ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#fff";
          ctx.shadowColor = "rgba(0,0,0,0.55)";
          ctx.shadowBlur = size * 0.35;
          const lines = wrap(ctx, text, canvas.width * 0.86);
          const lineHeight = size * 1.25;
          const top = canvas.height * (style === "caption" ? 0.82 : 0.5) - ((lines.length - 1) * lineHeight) / 2;
          lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, top + i * lineHeight));
          ctx.shadowBlur = 0;
        } else {
          const el = sources.loaded.get(clip.source);
          if (el) {
            if (el.tagName === "VIDEO") {
              const video = el as HTMLVideoElement;
              const target = (clip.in ?? 0) + local;
              if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = Math.min(target, Math.max(0, (video.duration || target) - 0.05));
              if (video.readyState >= 2) drawMedia(ctx, video, canvas, clip);
            } else if ((el as HTMLImageElement).tagName === "IMG" || (el as HTMLImageElement).naturalWidth) {
              drawMedia(ctx, el as HTMLImageElement, canvas, clip);
            }
          } else if (clip.kind === "image" || clip.kind === "video") {
            // Fail visibly: a black frame looks like a broken player.
            ctx.globalAlpha = 1;
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.font = `500 ${canvas.height * 0.035}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(`${clip.kind} unavailable`, canvas.width / 2, canvas.height / 2);
          }
        }
        if (filter) ctx.filter = "none";
        restore?.();
        ctx.globalAlpha = 1;
      }
    }

    // A flash is a pulse at the cut, not a curtain over the clip.
    //
    // Drawn as a separate pass over the whole frame, it whitened everything for
    // the length of the entry window — and because every card rests on frame 0,
    // the first thing the user saw of a project whose first clip flashes was a
    // blank grey rectangle. It now peaks in the first 120ms and is gone.
    for (const track of spec.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.transition?.kind !== "flash") continue;
        const since = t - clip.start;
        if (since < 0 || since > 0.12) continue;
        ctx.save();
        ctx.globalAlpha = (1 - since / 0.12) * 0.9;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }
  };

  // The playback clock. rAF rather than setInterval so a slow frame does not
  // drift the audio, and every frame redraws from the ground truth of elapsed
  // wall-clock time instead of accumulating.
  useEffect(() => {
    if (!playing) return;
    const started = performance.now() - startedAt.current * 1000;
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      if (t >= duration) {
        setPlaying(false);
        startedAt.current = 0;
        setTime(0);
        draw(0);
        for (const a of audioRefs.current) a.pause();
        return;
      }
      setTime(t);
      draw(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, duration]);

  // Follow the clips with `time`, not with a boolean.
  //
  // This used to depend on `time > 0 && playing`, which is false at the very
  // first frame of playback: a sound that starts at 0.0s never began, and the
  // effect did not re-run until the play state itself changed. Depending on the
  // clock means a clip that starts mid-film begins on the frame it is reached.
  useEffect(() => {
    if (!spec) return;
    for (const track of spec.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.kind !== "audio") continue;
        const el = sources.loaded.get(clip.source) as HTMLAudioElement | undefined;
        if (!el) continue;
        const len = clip.duration / (clip.speed ?? 1);
        const shouldPlay = playing && time >= clip.start && time < clip.start + len;
        if (shouldPlay && el.paused) {
          el.currentTime = Math.max(0, (clip.in ?? 0) + (time - clip.start) * (clip.speed ?? 1));
          el.playbackRate = Math.max(0.25, Math.min(4, clip.speed ?? 1));
          void el.play().catch(() => {});
        } else if (!shouldPlay && !el.paused) {
          el.pause();
        }
      }
    }
  }, [time, playing, spec]);

  useEffect(() => {
    if (!ready || !spec) return;
    // Rest past any entry effect, so the card opens on a real frame.
    const rest = previewTime(spec);
    setTime(rest);
    draw(rest);
  }, [ready]);

  if (!spec) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-[13px] text-neutral-400">
        This video project could not be read.
      </div>
    );
  }

  const aspect = spec.width / spec.height;

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-white/90">{spec.title}</span>
          <span className="text-[11px] text-neutral-500">
            {duration.toFixed(1)}s · {spec.width}×{spec.height}
          </span>
        </div>
        <span className="text-[11px] text-neutral-500">{spec.tracks.reduce((n, t) => n + t.clips.length, 0)} clips</span>
      </div>

      <div className="relative bg-black" style={{ aspectRatio: String(aspect) }}>
        <canvas ref={canvasRef} width={spec.width} height={spec.height} className="h-full w-full" />
        {!playing && (
          <button
            type="button"
            onClick={() => {
              startedAt.current = time >= duration - 0.05 ? 0 : time;
              if (startedAt.current === 0) setTime(0);
              setPlaying(true);
            }}
            className="absolute inset-0 grid place-items-center bg-black/25 transition hover:bg-black/10"
            aria-label="Play"
          >
            <span className="grid size-12 place-items-center rounded-full bg-white/90 text-black shadow-lg">
              <Icon name="play" className="size-5" />
            </span>
          </button>
        )}
      </div>

      {error && <p className="px-3 py-1.5 text-[12px] text-[#ff6b7a]">{error}</p>}
      {sources.missing.length > 0 && (
        <p className="px-3 py-1.5 text-[12px] text-amber-400/90">
          {sources.missing.length} clip{sources.missing.length === 1 ? "" : "s"} could not load — the Bot may have used an id that no longer exists.
        </p>
      )}

      {/* The timeline, in miniature: one bar per clip, in its track's row. */}
      <div className="space-y-1 border-t border-white/[0.06] p-2">
        {spec.tracks
          .filter((track) => !track.muted && track.clips.length > 0)
          .map((track) => (
            <div key={track.id} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-neutral-600">{track.id}</span>
              <div className="relative h-1.5 flex-1 rounded-full bg-white/[0.06]">
                {track.clips.map((clip) => (
                  <span
                    key={clip.id}
                    title={clip.label ?? clip.kind}
                    className={[
                      "absolute top-0 h-1.5 rounded-full",
                      clip.kind === "text" ? "bg-sky-400/70" : clip.kind === "audio" ? "bg-emerald-400/70" : clip.kind === "image" ? "bg-amber-400/70" : "bg-violet-400/70",
                    ].join(" ")}
                    style={{ left: `${(clip.start / Math.max(0.1, duration)) * 100}%`, width: `${Math.max(1.5, (clip.duration / Math.max(0.1, duration)) * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

/** Wrap text to a pixel width, already set on the context. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** Draw an image or a video frame, honouring its transform. */
function drawMedia(
  ctx: CanvasRenderingContext2D,
  el: HTMLImageElement | HTMLVideoElement,
  canvas: HTMLCanvasElement,
  clip: VideoClip,
) {
  const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!iw || !ih) return;
  const base = fitRect(iw, ih, canvas.width, canvas.height);
  const scale = clip.transform?.scale ?? 1;
  const dx = clip.transform?.x ?? 0;
  const dy = clip.transform?.y ?? 0;
  const w = base.w * scale;
  const h = base.h * scale;
  ctx.save();
  if (clip.transform?.rotate || dx || dy) {
    ctx.translate(canvas.width / 2 + dx, canvas.height / 2 + dy);
    ctx.rotate(((clip.transform?.rotate ?? 0) * Math.PI) / 180);
    ctx.drawImage(el, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(el, base.x + dx, base.y + dy, w, h);
  }
  ctx.restore();
}
