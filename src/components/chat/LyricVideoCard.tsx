"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LyricVideoSpec } from "@/lib/lyric-video-spec";
import { timePlainLyrics } from "@/lib/lyric-timing";
import { LYRIC_PRESETS } from "@/lib/lyric-video-spec";
import { useApp } from "../AppProvider";
import { Icon } from "../icons";

/** The subset of the Braccato element this card writes to. */
type BraccatoElement = HTMLElement & {
  lyrics: unknown[] | null;
  lyricsOptions: Record<string, unknown>;
  source: HTMLMediaElement | string | null;
  theme: string;
  host: Record<string, unknown>;
};

/**
 * A lyric video.
 *
 * Braccato draws the words: one line at a time, each syllable lighting up as it
 * is sung, leaning on the <audio> clock. The cover art sits behind it as a slow
 * drifting wash so the words always have something to sit on. The player and
 * the parser are imported in the browser only, so the chat bundle stays small
 * until somebody actually opens a lyric video.
 */
export function LyricVideoCard({ artifact }: { artifact: { id: string; title: string; content: string } }) {
  const app = useApp();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lyricsRef = useRef<BraccatoElement | null>(null);
  // The stored JSON is the only input, so parse it during render rather than
  // round-tripping through state in an effect.
  const parsed = useMemo(() => {
    try {
      const spec = JSON.parse(artifact.content) as LyricVideoSpec;
      return spec.audioId && spec.lyrics ? { spec } : { spec: null };
    } catch {
      return { spec: null };
    }
  }, [artifact.content]);
  const spec = parsed.spec;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;

    async function mount(spec: LyricVideoSpec) {
      const [, , parsers] = await Promise.all([
        import("@braccato/core/element"),
        import("@braccato/core/styles/variables.css"),
        import("@braccato/parsers"),
        import("@braccato/core/styles/lyrics.css"),
        import("@braccato/core/styles/instrumental.css"),
      ]);
      if (cancelled) return;
      const host = lyricsRef.current;
      const audio = audioRef.current;
      if (!host || !audio) return;

      const parser = parsers.detectParser(spec.lyrics);
      const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : undefined;
      const parsedLines = parser.parse(spec.lyrics, durationMs);
      const lines = timePlainLyrics(parsedLines, durationMs);
      if (!lines.length) {
        setError("No timed lines were found in that lyrics file.");
        return;
      }
      let songwriters: string[] = [];
      try {
        songwriters = parser.metadata(spec.lyrics).songwriters ?? [];
      } catch {
        songwriters = [];
      }

      // Autoscroll follows this card's own stage rather than the page.
      host.host = { getScrollElement: () => stageRef.current };
      host.lyricsOptions = { songwriters };
      host.lyrics = lines;
      host.theme = themeForSpec(spec);
      host.source = audio;
      setReady(true);
    }

    const audio = audioRef.current;
    const start = () => void mount(spec).catch((reason) => setError(reason instanceof Error ? reason.message : "The player could not start."));
    // Duration is often unknown until metadata arrives, and an LRC without
    // explicit line lengths needs it to size the lines.
    if (audio && audio.readyState < 1) {
      const onError = () => { if (!cancelled) setError("The song could not be loaded. Check that the audio artifact still exists and the file is playable."); };
      audio.addEventListener("error", onError);
      const onMeta = () => {
        audio.removeEventListener("loadedmetadata", onMeta);
        start();
      };
      audio.addEventListener("loadedmetadata", onMeta);
      return () => {
        cancelled = true;
        audio.removeEventListener("loadedmetadata", onMeta);
        audio.removeEventListener("error", onError);
      };
    }
    start();
    return () => {
      cancelled = true;
    };
  }, [spec]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
    };
  }, [spec]);

  if (!spec) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <p className="text-[13px] text-[#ff9aa5]">This lyric video could not be read. Ask the Bot to build it again.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <p className="text-[13px] text-[#ff9aa5]">{error}</p>
        <p className="mt-1 text-[12px] text-neutral-500">Ask the Bot to rebuild it, or upload the song again.</p>
      </div>
    );
  }

  const preset = spec.preset && spec.preset in LYRIC_PRESETS ? (spec.preset as keyof typeof LYRIC_PRESETS) : "aurora";
  const accent = spec.accent || "#ffffff";

  return (
    <div className="lv-stage overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0a0a0d]">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] bg-[#0d0d11] px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-white">{spec.title}</div>
          {spec.artist && <div className="truncate text-[11.5px] text-neutral-500">{spec.artist}</div>}
        </div>
        <span className="shrink-0 rounded-full border border-white/[0.09] bg-white/[0.04] px-2 py-0.5 text-[10.5px] font-medium text-neutral-400">
          interactive preview · not MP4
        </span>
      </div>

      <div ref={stageRef} className="relative isolate aspect-[4/3] max-h-[300px] w-full overflow-hidden sm:aspect-[2/1]">
        {spec.artId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/artifacts/${spec.artId}/raw`}
            alt=""
            className="absolute inset-0 size-full scale-110 object-cover opacity-75 motion-safe:animate-[land-drift_26s_ease-in-out_infinite]"
          />
        ) : (
          <div aria-hidden className="absolute inset-0 opacity-90" style={{ background: LYRIC_PRESETS[preset] }} />
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/20" />
        <div aria-hidden className="absolute inset-0 backdrop-blur-[1px]" />

        <div className="absolute inset-x-0 bottom-[54px] top-0 z-0 overflow-hidden px-5 sm:px-8">
          <braccato-lyrics
            ref={(node) => {
              lyricsRef.current = node as BraccatoElement | null;
            }}
            className="block size-full"
            style={{ ["--blyrics-lyric-active-color" as string]: accent }}
          />
        </div>

        {!ready && (
          <div className="absolute inset-0 z-10 grid place-items-center">
            <span className="rounded-full bg-black/50 px-3 py-1.5 text-[12px] text-white/70 backdrop-blur">Preparing lyrics…</span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-white/[0.08] bg-[#08080a]/80 px-3 py-2.5 backdrop-blur">
          <button
            type="button"
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (audio.paused) void audio.play().catch(() => app.toast("The browser blocked playback — press play again.", "err"));
              else audio.pause();
            }}
            aria-label={playing ? "Pause" : "Play"}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ffffff] text-[#0b0b0e] transition hover:bg-[#e5e5e5] active:scale-95"
          >
            <Icon name={playing ? "pause" : "play"} size={15} />
          </button>
          <Scrubber audioRef={audioRef} />
          <audio ref={audioRef} src={`/api/artifacts/${spec.audioId}/raw`} preload="metadata" className="hidden" />
        </div>
      </div>
    </div>
  );
}

/**
 * A quiet scrubber: elapsed, a seek rail, and the total. Reads the audio clock
 * on `timeupdate`, so it costs nothing while paused.
 */
function Scrubber({ audioRef }: { audioRef: React.RefObject<HTMLAudioElement | null> }) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const read = () => {
      setTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    read();
    audio.addEventListener("timeupdate", read);
    audio.addEventListener("durationchange", read);
    audio.addEventListener("seeked", read);
    return () => {
      audio.removeEventListener("timeupdate", read);
      audio.removeEventListener("durationchange", read);
      audio.removeEventListener("seeked", read);
    };
  }, [audioRef]);

  const clock = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const total = Math.floor(value);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="shrink-0 tabular-nums text-[11px] text-white/55">{clock(time)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.05}
        value={Math.min(time, duration || 0.1)}
        aria-label="Seek"
        onChange={(e) => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.currentTime = Number(e.target.value);
          setTime(Number(e.target.value));
        }}
        className="lv-seek min-w-0 flex-1"
      />
      <span className="shrink-0 tabular-nums text-[11px] text-white/40">{clock(duration)}</span>
    </div>
  );
}

/**
 * The stylesheet Braccato reads. Its only configuration format is comments, so
 * this stays a plain string rather than an object.
 */
function themeForSpec(spec: LyricVideoSpec): string {
  const accent = spec.accent || "#ffffff";
  return `
/* blyrics-target-scroll-pos-ratio = 0.34; */
.blyrics-container {
  --blyrics-font-size: clamp(1.15rem, 2.6vw, 1.95rem);
  --blyrics-line-height: 1.22;
  /* The default 2rem of padding per line leaves the words floating apart. */
  --blyrics-padding: 0.45rem;
  --blyrics-padding-bottom: 4rem;
  --blyrics-lyric-active-color: ${accent};
  --blyrics-lyric-inactive-color: rgb(255 255 255 / 0.28);
  --blyrics-font-family: var(--font-sans, ui-sans-serif, system-ui);
  font-weight: 650;
  letter-spacing: -0.02em;
}
/* Neighbour lines step back so the line being sung is unmistakable. The
   element's own class is \`blyrics--line\` (two hyphens); an earlier version of
   this rule used \`blyrics-line\`, which matched nothing and left all five lines
   at full strength. */
.blyrics--line:not(.blyrics--active) {
  opacity: 0.5;
}
/* Before playback the first line is the active one, so the rest should already
   be receded — otherwise the card opens with every line bright and the first
   line dim, which reads as broken. */
.blyrics-container:not([data-sync="playing"]) .blyrics--line:not(.blyrics--active) {
  opacity: 0.5;
}
`;
}
