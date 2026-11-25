/**
 * The video project, shared by the browser studio and the server tools.
 *
 * A CapCut-style project is a timeline: tracks stacked vertically, clips placed
 * along them, and per-clip trims and effects. This is the data; the studio is a
 * renderer over it. Kept free of `server-only` so both sides import the same
 * types — the shapes are the contract, and a second copy on the client would
 * drift the moment either changed.
 */

/** A text or title clip, the thing a Bot most often needs to add itself. */
export type TextClip = { text: string; start: number; end: number; style?: "title" | "subtitle" | "caption" };

/** One piece of media on the timeline. Times are seconds from the start. */
export type VideoClip = {
  id: string;
  /** What it is, and therefore how it is rendered. */
  kind: "video" | "image" | "text" | "audio";
  /** Artifact id for media, or the literal text for a text clip. */
  source: string;
  /** Where it starts on the timeline. */
  start: number;
  /** How long it occupies the timeline. */
  duration: number;
  /** Seconds into the source where this clip begins — the trim-in point. */
  in?: number;
  /** Playback rate. 2 is double speed; 0.5 is slow motion. */
  speed?: number;
  /** Opacity 0-1, for fades and overlays. */
  opacity?: number;
  /** Fade in and out, in seconds. */
  fadeIn?: number;
  fadeOut?: number;
  /** Simple transform, all optional. Scale is a multiplier of the fit size. */
  transform?: { scale?: number; x?: number; y?: number; rotate?: number };
  /** For text clips: how it looks. */
  text?: TextClip;
  /** A spoken line to synthesise for an audio clip the Bot builds itself. */
  speak?: string;
  label?: string;
};

/** A horizontal lane. Order in the array is stacking order, first on top. */
export type VideoTrack = {
  id: string;
  kind: "visual" | "overlay" | "text" | "audio";
  clips: VideoClip[];
  /** Hidden tracks are kept but not rendered — how a Bot tries something out. */
  muted?: boolean;
};

export type VideoProjectSpec = {
  version: 1;
  title: string;
  /** Whole-canvas seconds. Derived from the clips on save, but stored so the
   *  studio can show a total without recomputing on every keystroke. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  background?: string;
  tracks: VideoTrack[];
  /** A short description of what the video is for, written by the Bot. */
  brief?: string;
};

export const VIDEO_PRESET_SIZES = {
  landscape: { width: 1920, height: 1080, label: "16:9 landscape" },
  portrait: { width: 1080, height: 1920, label: "9:16 vertical" },
  square: { width: 1080, height: 1080, label: "1:1 square" },
  wide: { width: 2560, height: 1080, label: "21:9 cinematic" },
} as const;

export type VideoPresetName = keyof typeof VIDEO_PRESET_SIZES;

/** An empty project a Bot can start from. */
export function emptyVideoProject(title: string, preset: VideoPresetName = "landscape"): VideoProjectSpec {
  const size = VIDEO_PRESET_SIZES[preset];
  return {
    version: 1,
    title,
    duration: 0,
    width: size.width,
    height: size.height,
    fps: 30,
    background: "#000000",
    tracks: [
      { id: "v1", kind: "visual", clips: [] },
      { id: "o1", kind: "overlay", clips: [] },
      { id: "t1", kind: "text", clips: [] },
      { id: "a1", kind: "audio", clips: [] },
    ],
  };
}

/** The end of the last clip, which is the length of the film. */
export function projectDuration(project: VideoProjectSpec): number {
  let end = 0;
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  }
  return Math.round(end * 100) / 100;
}

/** Clips on one track, in play order, with any that overlap pushed apart. */
export function orderedClips(track: VideoTrack): VideoClip[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

/**
 * Find the gap a new clip can drop into at or after `from`.
 *
 * A Bot adding a clip should not have to know what else is on the track, and it
 * must never silently cover existing footage. Returning the first free slot is
 * the behaviour a person would get from dropping a clip at the end.
 */
export function nextFreeSlot(track: VideoTrack, from = 0): number {
  const ordered = orderedClips(track);
  let at = from;
  for (const clip of ordered) {
    if (at + 0.01 < clip.start) break;
    at = Math.max(at, clip.start + clip.duration);
  }
  return Math.round(at * 100) / 100;
}
