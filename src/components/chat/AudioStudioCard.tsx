"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioProjectSpec, SynthClip } from "@/lib/audio-studio-spec";
import { audioDuration, secondsPerBeat } from "@/lib/audio-studio-spec";
import { Icon } from "../icons";

/**
 * An audio project, played in the chat.
 *
 * Composed parts are synthesised here with Web Audio, which is why a Bot can
 * write a bass line as notes and have it sound — no audio file is generated
 * anywhere, and nothing is uploaded. Sample clips are <audio> elements started
 * on the same clock.
 *
 * Drum hits are the one special case: the studio's pattern writes C2 / D2 /
 * F#2 for kick, snare and hat, and those three pitches become a pitch-swept
 * sine (kick), a noise burst (snare) and a shorter, brighter noise burst (hat).
 * Using the same note data as everything else keeps the project one format.
 */

/**
 * The kit, addressed by pitch.
 *
 * Each name is a different synthesis recipe, not a different sample — a tom is
 * a pitched sine with a shorter tail than a kick, a clap is three noise bursts
 * a few milliseconds apart, and an open hat is the same noise as a closed one
 * with a slower decay. Low pitches are drums and mid ones are cymbals, so a Bot
 * writing notes can pick a piece of the kit the same way it picks a note.
 */
type DrumKind = "kick" | "snare" | "hat" | "openhat" | "clap" | "tom" | "rim" | "crash" | "shaker" | "cowbell";

const DRUM_PITCHES: Record<string, DrumKind> = {
  C2: "kick",
  D2: "snare",
  "F#2": "hat",
  "A#2": "openhat",
  "C#2": "clap",
  D3: "tom",
  "F2": "rim",
  A3: "crash",
  G2: "shaker",
  C3: "cowbell",
};

/** The list, for the tool description and the read-back. */
export const DRUM_NAMES: { pitch: string; kind: DrumKind }[] = Object.entries(DRUM_PITCHES).map(([pitch, kind]) => ({ pitch, kind }));

/** A burst of filtered noise with an exponential decay — the basis of every
 *  cymbal, snare and shaker in the kit. */
function noiseBurst(ctx: AudioContext, dest: AudioNode, at: number, seconds: number, filter: { type: BiquadFilterType; frequency: number; q?: number }, gainValue: number, decay: number) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // Noise with an exponential shaping: a hit, not a hiss.
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, decay);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter.type;
  biquad.frequency.value = filter.frequency;
  if (filter.q) biquad.Q.value = filter.q;
  const gain = ctx.createGain();
  gain.gain.value = gainValue;
  src.connect(biquad).connect(gain).connect(dest);
  src.start(at);
}

/** Percussion is a shape, not a note: build it from an oscillator or noise. */
function scheduleDrum(ctx: AudioContext, dest: AudioNode, kind: DrumKind, at: number, velocity: number) {
  if (kind === "tom") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, at);
    osc.frequency.exponentialRampToValueAtTime(110, at + 0.18);
    gain.gain.setValueAtTime(0.7 * velocity, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    osc.connect(gain).connect(dest);
    osc.start(at);
    osc.stop(at + 0.32);
    return;
  }
  if (kind === "rim") {
    // A short pitched click: a stick on a rim.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1700;
    gain.gain.setValueAtTime(0.18 * velocity, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    osc.connect(gain).connect(dest);
    osc.start(at);
    osc.stop(at + 0.05);
    return;
  }
  if (kind === "clap") {
    // Three bursts a few milliseconds apart: one burst is a snare, three is a
    // room of hands.
    for (let i = 0; i < 3; i++) {
      noiseBurst(ctx, dest, at + i * 0.011, 0.09, { type: "bandpass", frequency: 1400, q: 0.8 }, 0.28 * velocity, 3);
    }
    noiseBurst(ctx, dest, at + 0.033, 0.16, { type: "bandpass", frequency: 1200, q: 0.7 }, 0.18 * velocity, 2);
    return;
  }
  if (kind === "crash") {
    noiseBurst(ctx, dest, at, 1.1, { type: "highpass", frequency: 4200 }, 0.3 * velocity, 1.6);
    return;
  }
  if (kind === "shaker") {
    noiseBurst(ctx, dest, at, 0.06, { type: "highpass", frequency: 6500 }, 0.16 * velocity, 3);
    return;
  }
  if (kind === "cowbell") {
    // Two square waves a fifth apart, which is the whole joke of a cowbell.
    for (const hz of [540, 800]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.11 * velocity, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.28);
      osc.connect(gain).connect(dest);
      osc.start(at);
      osc.stop(at + 0.3);
    }
    return;
  }
  if (kind === "openhat") {
    noiseBurst(ctx, dest, at, 0.34, { type: "highpass", frequency: 7000 }, 0.2 * velocity, 2.2);
    return;
  }
  if (kind === "kick") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    gain.gain.setValueAtTime(0.9 * velocity, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
    osc.connect(gain).connect(dest);
    osc.start(at);
    osc.stop(at + 0.26);
    return;
  }
  const seconds = kind === "snare" ? 0.19 : 0.055;
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // Noise with an exponential decay: a hit, not a hiss.
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, kind === "snare" ? 2.4 : 5);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = kind === "snare" ? "bandpass" : "highpass";
  filter.frequency.value = kind === "snare" ? 1800 : 7000;
  const gain = ctx.createGain();
  gain.gain.value = (kind === "snare" ? 0.5 : 0.22) * velocity;
  src.connect(filter).connect(gain).connect(dest);
  src.start(at);
}

/** Schedule one composed part. Returns when its last note ends. */
function scheduleSynth(ctx: AudioContext, dest: AudioNode, clip: SynthClip, bpm: number, at: number): number {
  const spb = secondsPerBeat(bpm);
  const gain = ctx.createGain();
  gain.gain.value = clip.gain ?? 0.18;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clip.cutoff ?? 4200;

  // Echo is a send: the dry signal still reaches the output at full level, and
  // a delay line feeds a little of each repeat back into itself. Wiring the
  // whole part through the delay instead would make it sound distant, not wide.
  if (clip.echo && clip.echo.mix > 0) {
    const delay = ctx.createDelay(4);
    delay.delayTime.value = Math.max(0.01, Math.min(3, clip.echo.time));
    const feedback = ctx.createGain();
    feedback.gain.value = Math.max(0, Math.min(0.9, clip.echo.feedback));
    const wet = ctx.createGain();
    wet.gain.value = Math.max(0, Math.min(1, clip.echo.mix));
    filter.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(dest);
    filter.connect(gain);
    gain.connect(dest);
  } else {
    gain.connect(filter).connect(dest);
  }

  let last = at;
  for (const note of clip.notes) {
    const drum = DRUM_PITCHES[note.pitch.toUpperCase()];
    const start = at + note.at * spb;
    const length = Math.max(0.05, note.beats * spb);
    last = Math.max(last, start + length);
    if (drum) {
      scheduleDrum(ctx, filter, drum, start, note.velocity ?? 0.8);
      continue;
    }
    if (/^rest$/i.test(note.pitch)) continue;
    const hz = pitchOf(note.pitch);
    if (!hz) continue;
    // Two oscillators when detuned: one at pitch, one a few cents off. The beat
    // between them is the width, and it is why a pad sounds like several
    // players rather than one.
    const voices = clip.detune ? [0, clip.detune] : [0];
    for (const cents of voices) {
      const osc = ctx.createOscillator();
      osc.type = clip.wave;
      osc.frequency.value = hz;
      if (cents) osc.detune.value = cents;
      if (clip.vibrato && clip.vibrato.depth > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = Math.max(0.1, clip.vibrato.rate);
        const depth = ctx.createGain();
        depth.gain.value = clip.vibrato.depth;
        lfo.connect(depth).connect(osc.detune);
        lfo.start(start);
        lfo.stop(start + length + 0.05);
      }
      const env = ctx.createGain();
      // A short attack and release: a bare gate on a square wave clicks. The
      // clip can override both, which is how a pad becomes a pad.
      const attack = Math.min(clip.attack ?? 0.03, length / 2);
      const release = Math.min(clip.release ?? 0.12, length / 2);
      const peak = (note.velocity ?? 0.8) / voices.length;
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.max(0.005, attack));
      env.gain.setValueAtTime(Math.max(0.0002, peak), start + Math.max(attack, length - release));
      env.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(env).connect(gain);
      osc.start(start);
      osc.stop(start + length + 0.02);
    }
  }
  return last;
}

/** Mirrors pitchToFrequency, without importing the server module. */
function pitchOf(pitch: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(pitch.trim());
  if (!m) return 0;
  const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const midi = (Number(m[3]) + 1) * 12 + letters[m[1].toUpperCase()] + acc;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function AudioStudioCard({ artifact }: { artifact: { id: string; title: string; content: string } }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const samplesRef = useRef<Map<string, AudioBuffer>>(new Map());
  const nodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const attemptRef = useRef(0);
  const startingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const spec = useMemo(() => {
    try {
      const parsed = JSON.parse(artifact.content) as AudioProjectSpec;
      return parsed?.tracks?.length ? parsed : null;
    } catch {
      return null;
    }
  }, [artifact.content]);

  const duration = spec ? audioDuration(spec) : 0;

  // Sample clips are fetched once, decoded, and kept as AudioBuffers. Decoding
  // needs a context, so this runs on first play rather than on mount — a chat
  // full of projects must not open an AudioContext each.
  async function loadSamples(ctx: AudioContext, attempt: number) {
    if (!spec) return;
    for (const track of spec.tracks) {
      for (const clip of track.clips) {
        if (attemptRef.current !== attempt) return;
        if (clip.kind !== "sample" || samplesRef.current.has(clip.source)) continue;
        let url = clip.source;
        if (!/^(data:|https?:)/.test(url)) {
          const res = await fetch(`/api/artifacts/${encodeURIComponent(clip.source)}`);
          if (!res.ok) throw new Error(`Could not load the sample (${res.status}).`);
          url = ((await res.json()) as { content?: string }).content ?? "";
        }
        if (!url) throw new Error("The sample has no audio data.");
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load the sample (${response.status}).`);
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (attemptRef.current !== attempt) return;
        samplesRef.current.set(clip.source, buffer);
      }
    }
  }

  async function play() {
    if (!spec || startingRef.current) return;
    startingRef.current = true;
    const attempt = ++attemptRef.current;
    setLoading(true);
    setError("");
    try {
      const ctx = (ctxRef.current ??= new AudioContext());
      await ctx.resume();
      await loadSamples(ctx, attempt);
      if (attemptRef.current !== attempt) return;
      const startAt = ctx.currentTime + 0.08;

      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      for (const track of spec.tracks) {
        if (track.muted) continue;
        // Per-track gain and pan, so a mixer move is audible.
        const trackGain = ctx.createGain();
        trackGain.gain.value = track.gain ?? 0.2;
        const pan = ctx.createStereoPanner();
        pan.pan.value = ((track.pan ?? 0.5) - 0.5) * 2;
        trackGain.connect(pan).connect(master);

        for (const clip of track.clips) {
          const at = startAt + clip.start;
          if (clip.kind === "synth") {
            scheduleSynth(ctx, trackGain, clip, spec.bpm, at);
          } else {
            const buffer = samplesRef.current.get(clip.source);
            if (!buffer) continue;
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const g = ctx.createGain();
            g.gain.value = clip.gain ?? 0.8;
            src.connect(g).connect(trackGain);
            src.start(at, clip.in ?? 0, Math.max(0.05, clip.duration));
            nodesRef.current.push(src);
          }
        }
      }

      setPlaying(true);
      const tick = () => {
        const t = Math.max(0, ctx.currentTime - startAt);
        if (t >= duration) {
          stop();
          return;
        }
        setTime(t);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      if (attemptRef.current === attempt) {
        void ctxRef.current?.close().catch(() => {});
        ctxRef.current = null;
        setError(e instanceof Error ? e.message : "Audio could not be played.");
      }
    } finally {
      if (attemptRef.current === attempt) {
        startingRef.current = false;
        setLoading(false);
      }
    }
  }

  const rafRef = useRef(0);

  function stop() {
    attemptRef.current++;
    startingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    for (const node of nodesRef.current) {
      try {
        node.stop();
      } catch {
        /* already ended */
      }
    }
    nodesRef.current = [];
    // Scheduled oscillators cannot be cancelled by stopping their sources
    // alone once they are playing, so the context is replaced on the next play.
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setPlaying(false);
    setTime(0);
  }

  useEffect(() => () => {
    attemptRef.current++;
    startingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    for (const node of nodesRef.current) {
      try { node.stop(); } catch { /* already ended */ }
    }
    nodesRef.current = [];
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  if (!spec) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-[13px] text-neutral-400">
        This audio project could not be read.
      </div>
    );
  }

  const tracks = spec.tracks.filter((t) => !t.muted && t.clips.length > 0);

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => (playing ? stop() : void play())}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-white/85 disabled:opacity-50"
          aria-label={playing ? "Stop" : "Play"}
          disabled={loading}
        >
          <Icon name={playing ? "pause" : "play"} className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13px] font-medium text-white/90">{spec.title}</span>
            <span className="shrink-0 text-[11px] text-neutral-500">
              {spec.bpm} BPM · {duration.toFixed(1)}s
            </span>
          </div>
          {/* A progress line with the playhead, so a long piece has somewhere to look. */}
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-100" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="space-y-1 border-t border-white/[0.06] px-3 py-2">
        {tracks.map((track) => (
          <div key={track.id} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[10px] uppercase tracking-wide text-neutral-600">{track.name}</span>
            <div className="relative h-1 flex-1 rounded-full bg-white/[0.05]">
              {track.clips.map((clip) => (
                <span
                  key={clip.id}
                  title={clip.label ?? clip.kind}
                  className="absolute top-0 h-1 rounded-full bg-emerald-400/70"
                  style={{
                    left: `${(clip.start / Math.max(0.1, duration)) * 100}%`,
                    width: `${Math.max(1.5, (clip.duration / Math.max(0.1, duration)) * 100)}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="px-3 pb-2 text-[12px] text-[#ff6b7a]">{error}</p>}
      {loading && <p className="px-3 pb-2 text-[12px] text-neutral-500">Loading samples…</p>}
    </div>
  );
}
