/**
 * The audio project, shared by the browser studio and the server tools.
 *
 * The audio studio is a mixer, not an editor: several tracks, each of which is
 * either a recorded or generated sound, or a part the Bot plays itself from
 * notes. That second kind is what makes it useful to a Bot — it can write a
 * melody, a bass line and a drum pattern as data, layer them, and hand back
 * something that plays, without generating a single byte of audio anywhere.
 */

/** A note in scientific pitch notation plus a beat offset and length. */
export type Note = {
  /** e.g. "C4", "F#3", "Bb5". "rest" leaves silence. */
  pitch: string;
  /** Beats from the start of the clip. */
  at: number;
  /** Length in beats. */
  beats: number;
  /** 0-1. Defaults to 0.8. */
  velocity?: number;
};

/**
 * A part the Bot composes, played by the browser with an oscillator.
 *
 * `wave` maps onto the Web Audio oscillator types, so "sine" is a flute-ish
 * tone, "square" a chiptune lead, "sawtooth" a string pad and "triangle" a
 * soft bell. `attack` and `release` are per-note envelope seconds; without them
 * a square wave clicks.
 */
export type SynthClip = {
  kind: "synth";
  id: string;
  start: number;
  duration: number;
  wave: "sine" | "square" | "sawtooth" | "triangle";
  notes: Note[];
  gain?: number;
  /** A simple lowpass cutoff in Hz; higher is brighter. */
  cutoff?: number;
  label?: string;
};

/** A sound the Bot has as an artifact — recorded audio, or a generated one. */
export type SampleClip = {
  kind: "sample";
  id: string;
  start: number;
  duration: number;
  /** Artifact id of the audio. */
  source: string;
  /** Trim-in offset in seconds. */
  in?: number;
  gain?: number;
  label?: string;
};

export type AudioClip = SynthClip | SampleClip;

export type AudioTrack = {
  id: string;
  name: string;
  clips: AudioClip[];
  gain?: number;
  muted?: boolean;
  /** 0-1, where 0.5 is centre. */
  pan?: number;
};

export type AudioProjectSpec = {
  version: 1;
  title: string;
  /** Beats per minute — the grid every clip's beats are measured against. */
  bpm: number;
  duration: number;
  tracks: AudioTrack[];
  brief?: string;
};

export const AUDIO_PRESETS = {
  beat: { bpm: 90, label: "hip-hop beat" },
  pop: { bpm: 120, label: "pop" },
  cinematic: { bpm: 70, label: "cinematic" },
  chiptune: { bpm: 150, label: "chiptune" },
  ambient: { bpm: 60, label: "ambient" },
} as const;

export type AudioPresetName = keyof typeof AUDIO_PRESETS;

/** The standard four-piece a Bot can start from. */
export function emptyAudioProject(title: string, preset: AudioPresetName = "pop"): AudioProjectSpec {
  return {
    version: 1,
    title,
    bpm: AUDIO_PRESETS[preset].bpm,
    duration: 0,
    tracks: [
      { id: "lead", name: "Lead", clips: [], gain: 0.18 },
      { id: "bass", name: "Bass", clips: [], gain: 0.22 },
      { id: "drums", name: "Drums", clips: [], gain: 0.25 },
      { id: "pad", name: "Pad", clips: [], gain: 0.1 },
    ],
  };
}

/** Seconds per beat at a tempo. */
export function secondsPerBeat(bpm: number): number {
  return 60 / Math.max(20, Math.min(400, bpm));
}

/** How long one composed clip lasts, in seconds, from its notes. */
export function synthClipSeconds(clip: SynthClip, bpm: number): number {
  const spb = secondsPerBeat(bpm);
  const beats = clip.notes.reduce((end, note) => Math.max(end, note.at + note.beats), 0);
  return Math.round(beats * spb * 100) / 100;
}

/** The end of the last clip on any audible track. */
export function audioDuration(project: AudioProjectSpec): number {
  let end = 0;
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  }
  return Math.round(end * 100) / 100;
}

/**
 * Parse a pitch into a frequency in Hz.
 *
 * A4 is 440. Twelve semitones to the octave, and the letter is the note name
 * with `#`/`b` as accidentals. Returns 0 for "rest" so callers can skip it
 * without a special case.
 */
export function pitchToFrequency(pitch: string): number {
  const clean = pitch.trim();
  if (!clean || /^rest$/i.test(clean)) return 0;
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(clean);
  if (!match) return 0;
  const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const semitone = letters[match[1].toUpperCase()];
  if (semitone === undefined) return 0;
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = Number(match[3]);
  const midi = (octave + 1) * 12 + semitone + accidental;
  return Math.round(440 * Math.pow(2, (midi - 69) / 12) * 100) / 100;
}

/** True when every note in a clip parses. The Bot uses this before saving. */
export function invalidNotes(clip: SynthClip): string[] {
  return clip.notes.filter((note) => !/^rest$/i.test(note.pitch) && pitchToFrequency(note.pitch) === 0).map((note) => note.pitch);
}
