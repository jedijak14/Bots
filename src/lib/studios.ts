import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import {
  emptyVideoProject,
  nextFreeSlot,
  projectDuration,
  VIDEO_PRESET_SIZES,
  type VideoClip,
  type VideoPresetName,
  type VideoProjectSpec,
  type VideoTrack,
} from "./video-studio-spec";
import {
  AUDIO_PRESETS,
  audioDuration,
  emptyAudioProject,
  invalidNotes,
  pitchToFrequency,
  secondsPerBeat,
  synthClipSeconds,
  type AudioPresetName,
  type AudioProjectSpec,
  type AudioClip,
  type AudioTrack,
  type Note,
  type SynthClip,
} from "./audio-studio-spec";

/**
 * The two studios, as the Bot operates them.
 *
 * Both are stored as artifacts — a JSON project under `kind: "video_project"` or
 * `kind: "audio_project"` — and both are edited by the same rules: open one by
 * title, add a clip without covering anything already there, and hand the user
 * a project the studio opens. Storing them as artifacts rather than files means
 * they survive a reload, appear in Artifacts, and need no computer.
 *
 * The Bot never renders pixels or samples. It edits the timeline; the browser
 * draws and plays it. That is deliberate — a Bot without a desktop can still
 * build a film, and a render on a server would cost the user real money per
 * frame for something the browser does for free.
 */

const MAX_TEXT = 200_000;

export type StudioResult = { output: string; artifactId?: string };

async function loadProject<T>(
  userId: string,
  botId: string,
  kind: "video_project" | "audio_project",
  title: string,
): Promise<{ id: string; spec: T } | null> {
  const [row] = await db
    .select({ id: artifacts.id, content: artifacts.content })
    .from(artifacts)
    .where(and(eq(artifacts.userId, userId), eq(artifacts.botId, botId), eq(artifacts.kind, kind), eq(artifacts.title, title)))
    .limit(1);
  if (!row) return null;
  try {
    return { id: row.id, spec: JSON.parse(row.content) as T };
  } catch {
    return null;
  }
}

async function saveProject(
  userId: string,
  botId: string,
  kind: "video_project" | "audio_project",
  title: string,
  spec: unknown,
  existingId?: string,
): Promise<string> {
  const content = JSON.stringify(spec);
  if (content.length > MAX_TEXT) throw new Error("That project is too large to store. Split it into two projects.");
  if (existingId) {
    await db.update(artifacts).set({ content }).where(eq(artifacts.id, existingId));
    return existingId;
  }
  const [row] = await db.insert(artifacts).values({ userId, botId, title, kind, content }).returning({ id: artifacts.id });
  return row.id;
}

/** The image and video formats a browser can actually show. */
const VISUAL_SOURCE = /^(?:artifact|data:|https?:\/\/)/;

function describeClip(clip: VideoClip): string {
  const kind = clip.kind === "text" ? `text “${(clip.text?.text ?? "").slice(0, 30)}”` : clip.kind;
  return `${kind} ${clip.start.toFixed(1)}s–${(clip.start + clip.duration).toFixed(1)}s`;
}

/* ---------------------------------- video --------------------------------- */

export async function openVideoStudio(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim().slice(0, 160);
  if (!title) return { output: "Give the project a title, e.g. “Launch teaser”." };

  const existing = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (existing) {
    const total = existing.spec.tracks.reduce((n, t) => n + t.clips.length, 0);
    return {
      output: [
        `Opened “${title}” — ${total} clip${total === 1 ? "" : "s"}, ${projectDuration(existing.spec).toFixed(1)}s, ${existing.spec.width}×${existing.spec.height}.`,
        ...existing.spec.tracks.map((t) => `- ${t.id} (${t.kind}): ${t.clips.length ? t.clips.map(describeClip).join(", ") : "empty"}`),
      ].join("\n"),
      artifactId: existing.id,
    };
  }

  const preset = (Object.keys(VIDEO_PRESET_SIZES).includes(String(a.preset)) ? a.preset : "landscape") as VideoPresetName;
  const spec = emptyVideoProject(title, preset);
  if (a.brief) spec.brief = String(a.brief).slice(0, 500);
  const id = await saveProject(ctx.userId, ctx.botId, "video_project", title, spec);
  return {
    output: `Created “${title}” — ${VIDEO_PRESET_SIZES[preset].label}, ${spec.width}×${spec.height} at ${spec.fps}fps, four tracks (v1 visual, o1 overlay, t1 text, a1 audio). Add clips with video_add.`,
    artifactId: id,
  };
}

/** Read a grading object from tool arguments, ignoring anything unknown. */
function parseGrade(value: unknown): VideoClip["grade"] {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const out: NonNullable<VideoClip["grade"]> = {};
  const keys = ["brightness", "contrast", "saturate", "hue", "blur", "sepia", "gray"] as const;
  for (const key of keys) {
    const n = Number(src[key]);
    // `Number(undefined)` is NaN and `Number(null)` is 0, which would silently
    // grayscale or black out a clip the Bot only meant to warm up.
    if (src[key] !== undefined && src[key] !== null && Number.isFinite(n)) out[key] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Read an entry transition from tool arguments. */
function parseTransition(value: unknown): VideoClip["transition"] {
  if (!value) return undefined;
  if (typeof value === "string") {
    const kind = value.toLowerCase();
    if (["fade", "wipe", "flash", "slide", "iris"].includes(kind)) return { kind: kind as "fade" | "wipe" | "flash" | "slide" | "iris", duration: 0.4 };
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const kind = String(src.kind ?? "").toLowerCase();
  if (!["fade", "wipe", "flash", "slide", "iris"].includes(kind)) return undefined;
  return { kind: kind as "fade" | "wipe" | "flash" | "slide" | "iris", duration: Math.max(0.05, Math.min(5, Number(src.duration) || 0.4)) };
}

export async function addVideoClip(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  if (!title) return { output: "Say which project to add to, by its title." };
  const found = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (!found) return { output: `There is no video project called “${title}”. Open one first with video_studio.` };
  const spec = found.spec;

  const kind = String(a.kind ?? "").trim() as VideoClip["kind"];
  if (!["video", "image", "text", "audio"].includes(kind)) {
    return { output: "kind must be one of: video, image, text, audio." };
  }

  // The track is chosen by what the clip is, so a Bot cannot put a title on the
  // visual track and wonder why it is behind the footage.
  const wanted: VideoTrack["kind"] = kind === "text" ? "text" : kind === "audio" ? "audio" : "visual";
  const track = spec.tracks.find((t) => t.kind === wanted && !t.muted) ?? spec.tracks.find((t) => t.kind === wanted);
  if (!track) return { output: `This project has no ${wanted} track.` };

  let source = String(a.source ?? "").trim();
  let text: VideoClip["text"];
  if (kind === "text") {
    const body = String(a.text ?? "").trim();
    if (!body) return { output: "A text clip needs text." };
    source = body;
    text = {
      text: body,
      start: 0,
      end: 0,
      style: (["title", "subtitle", "caption"].includes(String(a.style)) ? a.style : "title") as "title" | "subtitle" | "caption",
    };
  } else if (!source) {
    return { output: `A ${kind} clip needs a source: the artifact id or URL of the ${kind}.` };
  } else if (!VISUAL_SOURCE.test(source)) {
    return { output: `That does not look like media I can show. Give an artifact id from save_artifact, a data: URI, or an https URL — got “${source.slice(0, 40)}”.` };
  }

  const duration = Math.max(0.2, Math.min(3600, Number(a.duration ?? (kind === "image" ? 4 : kind === "text" ? 3 : 5)) || 3));
  // A Bot that does not say where should get the next free slot, not the start:
  // dropping every clip at 0 hides all but the last one and looks like the tool
  // did nothing.
  const requested = a.start === undefined ? nextFreeSlot(track) : Math.max(0, Number(a.start) || 0);

  const clip: VideoClip = {
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    kind,
    source,
    start: Math.round(requested * 100) / 100,
    duration: Math.round(duration * 100) / 100,
    ...(a.speed ? { speed: Math.max(0.1, Math.min(8, Number(a.speed))) } : {}),
    ...(a.opacity !== undefined ? { opacity: Math.max(0, Math.min(1, Number(a.opacity))) } : {}),
    ...(a.fadeIn ? { fadeIn: Math.max(0, Number(a.fadeIn)) } : {}),
    ...(a.fadeOut ? { fadeOut: Math.max(0, Number(a.fadeOut)) } : {}),
    ...(a.speak ? { speak: String(a.speak).slice(0, 2000) } : {}),
    ...(parseGrade(a.grade) ? { grade: parseGrade(a.grade)! } : {}),
    ...(parseTransition(a.transition) ? { transition: parseTransition(a.transition)! } : {}),
    ...(text ? { text } : {}),
    ...(a.label ? { label: String(a.label).slice(0, 80) } : {}),
  };
  track.clips.push(clip);
  spec.duration = projectDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "video_project", title, spec, found.id);

  const end = clip.start + clip.duration;
  return {
    output: `Added ${describeClip(clip)} on ${track.id}. The film is now ${spec.duration.toFixed(1)}s long.`,
    artifactId: found.id,
  };
}

export async function editVideoClip(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (!found) return { output: `There is no video project called “${title}”.` };
  const spec = found.spec;
  const clip = spec.tracks.flatMap((t) => t.clips).find((c) => c.id === String(a.id));
  if (!clip) return { output: `No clip with id “${String(a.id ?? "")}” in “${title}”. Open the project to see the ids.` };

  // Only what was asked for changes. A missing field must never reset a value.
  if (a.start !== undefined) {
    const track = spec.tracks.find((t) => t.clips.includes(clip));
    clip.start = Math.max(0, Number(a.start) || 0);
    if (track) {
      const other = track.clips.find((c) => c !== clip && Math.abs(c.start - clip.start) < 0.01);
      if (other) clip.start = nextFreeSlot(track, clip.start);
    }
  }
  if (a.duration !== undefined) clip.duration = Math.max(0.2, Number(a.duration) || 1);
  if (a.text !== undefined && clip.kind === "text") {
    clip.source = String(a.text);
    clip.text = { ...(clip.text ?? { start: 0, end: 0 }), text: String(a.text) };
  }
  if (a.opacity !== undefined) clip.opacity = Math.max(0, Math.min(1, Number(a.opacity)));
  if (a.speed !== undefined) clip.speed = Math.max(0.1, Math.min(8, Number(a.speed)));
  if (a.in !== undefined) clip.in = Math.max(0, Number(a.in) || 0);
  if (a.fadeIn !== undefined) clip.fadeIn = Math.max(0, Number(a.fadeIn) || 0);
  if (a.fadeOut !== undefined) clip.fadeOut = Math.max(0, Number(a.fadeOut) || 0);
  if (a.grade !== undefined) {
    const grade = parseGrade(a.grade);
    // An explicit empty object clears the grade rather than leaving the old one
    // in place, which is the only way to undo a look the Bot tried.
    if (grade) clip.grade = grade;
    else delete clip.grade;
  }
  if (a.transition !== undefined) {
    const transition = parseTransition(a.transition);
    if (transition) clip.transition = transition;
    else delete clip.transition;
  }
  if (a.text !== undefined && clip.kind === "text" && a.style && ["title", "subtitle", "caption"].includes(String(a.style))) {
    clip.text = { ...(clip.text ?? { text: String(a.text), start: 0, end: 0 }), style: a.style as "title" | "subtitle" | "caption" };
  }
  // Moving a clip to another track is a common fix — a title that ended up on
  // the visual track, say — and it is not expressible by any other field.
  if (a.track !== undefined) {
    const target = spec.tracks.find((t) => t.id === String(a.track));
    const from = spec.tracks.find((t) => t.clips.includes(clip));
    if (target && from && target !== from) {
      from.clips = from.clips.filter((c) => c !== clip);
      target.clips.push(clip);
    }
  }
  spec.duration = projectDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "video_project", title, spec, found.id);
  return { output: `Updated ${describeClip(clip)}. The film is ${spec.duration.toFixed(1)}s long.`, artifactId: found.id };
}

export async function removeVideoClip(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (!found) return { output: `There is no video project called “${title}”.` };
  const spec = found.spec;
  let removed = 0;
  for (const track of spec.tracks) {
    const before = track.clips.length;
    track.clips = track.clips.filter((c) => c.id !== String(a.id));
    removed += before - track.clips.length;
  }
  if (!removed) return { output: `No clip with id “${String(a.id ?? "")}” in “${title}”.` };
  spec.duration = projectDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "video_project", title, spec, found.id);
  return { output: `Removed the clip. The film is now ${spec.duration.toFixed(1)}s long.`, artifactId: found.id };
}

/**
 * Cut a clip in two at a time on the timeline.
 *
 * A split is the one edit that cannot be expressed as an update to a single
 * clip: it has to exist as a pair. The second half keeps the source in-point
 * moved forward, so the two halves play continuously instead of restarting.
 */
export async function splitVideoClip(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (!found) return { output: `There is no video project called “${title}”.` };
  const spec = found.spec;
  const track = spec.tracks.find((t) => t.clips.some((c) => c.id === String(a.id)));
  const clip = track?.clips.find((c) => c.id === String(a.id));
  if (!track || !clip) return { output: `No clip with id “${String(a.id ?? "")}” in “${title}”. Open the project to see the ids.` };

  const cut = Number(a.at);
  if (!Number.isFinite(cut)) return { output: "Give the split time in seconds, e.g. at 2.5." };
  if (cut <= clip.start + 0.1 || cut >= clip.start + clip.duration - 0.1) {
    return { output: `That split is outside the clip: it runs ${clip.start.toFixed(2)}s to ${(clip.start + clip.duration).toFixed(2)}s.` };
  }

  const speed = clip.speed ?? 1;
  const second: VideoClip = {
    ...clip,
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    start: cut,
    duration: clip.start + clip.duration - cut,
    // The source in-point advances by the timeline amount, scaled by speed: at
    // 2x speed, one second of timeline is two seconds of source.
    in: (clip.in ?? 0) + (cut - clip.start) * speed,
    // Fades belong to the outer edges only; the new join is a hard cut.
    fadeIn: undefined,
  };
  delete second.fadeIn;
  clip.duration = cut - clip.start;
  delete clip.fadeOut;
  track.clips.push(second);
  spec.duration = projectDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "video_project", title, spec, found.id);
  return {
    output: `Split ${describeClip(clip)} at ${cut.toFixed(2)}s. The second half runs to ${(second.start + second.duration).toFixed(2)}s.`,
    artifactId: found.id,
  };
}

/** Copy a clip, landing the copy in the next free slot on the same track. */
export async function duplicateVideoClip(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (!found) return { output: `There is no video project called “${title}”.` };
  const spec = found.spec;
  const track = spec.tracks.find((t) => t.clips.some((c) => c.id === String(a.id)));
  const clip = track?.clips.find((c) => c.id === String(a.id));
  if (!track || !clip) return { output: `No clip with id “${String(a.id ?? "")}” in “${title}”.` };

  const copy: VideoClip = {
    ...clip,
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    start: a.start === undefined ? nextFreeSlot(track) : Math.max(0, Number(a.start) || 0),
  };
  track.clips.push(copy);
  spec.duration = projectDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "video_project", title, spec, found.id);
  return { output: `Duplicated ${describeClip(copy)} on ${track.id} at ${copy.start.toFixed(2)}s.`, artifactId: found.id };
}

/** Close every gap on a track, so clips play back to back. */
export async function tightenVideoTrack(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (!found) return { output: `There is no video project called “${title}”.` };
  const spec = found.spec;
  const tracks = a.track ? spec.tracks.filter((t) => t.id === String(a.track)) : spec.tracks.filter((t) => t.kind !== "audio");
  if (!tracks.length) return { output: `No track called “${String(a.track)}”. The tracks are ${spec.tracks.map((t) => t.id).join(", ")}.` };

  let moved = 0;
  let saved = 0;
  for (const track of tracks) {
    let at = 0;
    for (const clip of [...track.clips].sort((x, y) => x.start - y.start)) {
      if (Math.abs(clip.start - at) > 0.005) {
        saved += clip.start - at;
        clip.start = Math.round(at * 100) / 100;
        moved++;
      }
      at = clip.start + clip.duration;
    }
  }
  spec.duration = projectDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "video_project", title, spec, found.id);
  return {
    output: moved
      ? `Closed the gaps on ${tracks.map((t) => t.id).join(", ")} — ${moved} clip${moved === 1 ? "" : "s"} moved, ${saved.toFixed(2)}s removed. The film is now ${spec.duration.toFixed(1)}s long.`
      : `There were no gaps to close on ${tracks.map((t) => t.id).join(", ")}.`,
    artifactId: found.id,
  };
}

/**
 * Read a video project as text.
 *
 * The Bot needs this to edit what it cannot see: without it, a follow-up like
 * "shorten the second title" has no ids to work from and no idea what exists.
 */
export async function readVideoProject(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<VideoProjectSpec>(ctx.userId, ctx.botId, "video_project", title);
  if (!found) return { output: `There is no video project called “${title}”.` };
  const spec = found.spec;
  const lines = [
    `“${spec.title}” — ${spec.width}×${spec.height} at ${spec.fps}fps, ${projectDuration(spec).toFixed(2)}s long.${spec.brief ? ` ${spec.brief}` : ""}`,
  ];
  for (const track of spec.tracks) {
    lines.push(`${track.id} (${track.kind}${track.muted ? ", muted" : ""}):`);
    if (!track.clips.length) {
      lines.push("  empty");
      continue;
    }
    for (const clip of [...track.clips].sort((x, y) => x.start - y.start)) {
      const bits = [
        `  ${clip.id} ${clip.kind}`,
        `${clip.start.toFixed(2)}–${(clip.start + clip.duration).toFixed(2)}s`,
        `“${clip.kind === "text" ? (clip.text?.text ?? clip.source).slice(0, 40) : (clip.label ?? clip.source.slice(0, 24))}”`,
      ];
      if (clip.speed && clip.speed !== 1) bits.push(`${clip.speed}x`);
      if (clip.opacity !== undefined && clip.opacity !== 1) bits.push(`opacity ${clip.opacity}`);
      if (clip.fadeIn || clip.fadeOut) bits.push(`fade ${clip.fadeIn ?? 0}/${clip.fadeOut ?? 0}`);
      if (clip.grade) bits.push(`grade ${Object.entries(clip.grade).map(([k, v]) => `${k} ${v}`).join(" ")}`);
      if (clip.transition) bits.push(`${clip.transition.kind} ${clip.transition.duration}s`);
      lines.push(bits.join(" · "));
    }
  }
  return { output: lines.join("\n"), artifactId: found.id };
}

/* ---------------------------------- audio --------------------------------- */

/** A drum pattern, written as notes, so the Bot can compose one. */
function drumPattern(style: string, bars: number, bpm: number): { clip: Extract<AudioClip, { kind: "synth" }>; description: string } {
  // A waltz is three beats to the bar. Treating it as a 4/4 pattern with fewer
  // hits puts every bar after the first out of phase with the count.
  const name0 = style.toLowerCase();
  const beatsPerBar = name0 === "waltz" ? 3 : 4;
  const notes: Note[] = [];
  // Pitch names, corresponding to the kit the studio plays.
  const K = "C2", S = "D2", H = "F#2", OH = "A#2", CL = "C#2", T = "D3", R = "F2", CR = "A3", SH = "G2";
  const hit = (pitch: string, at: number, velocity = 0.8, beats = 0.25) => notes.push({ pitch, at, beats, velocity });

  /**
   * Each style is a bar pattern, not a tempo.
   *
   * The old generator had one rock beat with a "laidback" switch, so every
   * genre came out the same. These are the actual idioms: house puts the kick
   * on every beat and the hat on the off-beats, trap rolls the hats in
   * triplets, bossa has no backbeat at all.
   */
  const name = style.toLowerCase();
  for (let bar = 0; bar < bars; bar++) {
    const b = bar * beatsPerBar;
    if (name === "house" || name === "four-on-the-floor") {
      for (let i = 0; i < 4; i++) hit(K, b + i, 1);
      hit(CL, b + 1, 0.5); hit(CL, b + 3, 0.5);
      for (let i = 0; i < 8; i++) hit(H, b + i * 0.5, i % 2 ? 0.5 : 0.28);
      if (bar % 2) hit(OH, b + 3.5, 0.4);
    } else if (name === "trap") {
      hit(K, b, 1); hit(K, b + 1.5, 0.9); hit(K, b + 2.75, 0.8);
      hit(S, b + 2, 0.85); hit(CL, b + 2, 0.4);
      // Triplet rolls are the signature; a straight eighth note grid cannot
      // express them, which is why the beat count is fractional.
      for (let i = 0; i < 12; i++) hit(H, b + i / 3, i % 3 === 0 ? 0.45 : 0.22, 0.2);
    } else if (name === "bossa" || name === "bossa nova") {
      for (let i = 0; i < 4; i++) hit(K, b + i, i === 0 ? 0.9 : 0.55);
      for (const at of [0.5, 1.5, 2.5, 3.5]) hit(R, b + at, 0.4);
      for (const at of [1, 3]) hit(SH, b + at, 0.3);
      hit(T, b + 2.5, 0.5);
    } else if (name === "waltz") {
      hit(K, b, 1); hit(R, b + 1, 0.35); hit(R, b + 2, 0.35);
      hit(SH, b + 0.5, 0.22); hit(SH, b + 1.5, 0.22); hit(SH, b + 2.5, 0.22);
    } else if (name === "trap-halftime" || name === "halftime") {
      hit(K, b, 1); hit(K, b + 2.5, 0.8); hit(S, b + 2, 0.9);
      for (let i = 0; i < 8; i++) hit(H, b + i * 0.5, 0.3);
    } else if (name === "rock" || name === "driving") {
      hit(K, b, 1); hit(K, b + 2, 0.95); hit(S, b + 1, 0.9); hit(S, b + 3, 0.9);
      for (let i = 0; i < 8; i++) hit(H, b + i * 0.5, i % 2 ? 0.4 : 0.25);
    } else if (name === "lofi" || name === "laidback" || name === "laid-back") {
      hit(K, b, 0.95); hit(K, b + 2.5, 0.7); hit(S, b + 1, 0.7); hit(S, b + 3, 0.75);
      for (let i = 0; i < 4; i++) hit(SH, b + i + 0.5, 0.28);
      if (bar % 4 === 3) hit(CR, b, 0.35);
    } else if (name === "break" || name === "breaks") {
      hit(K, b, 1); hit(K, b + 2.5, 0.85); hit(S, b + 1, 0.9); hit(S, b + 3, 0.9);
      for (let i = 0; i < 16; i++) hit(H, b + i * 0.25, i % 4 === 0 ? 0.4 : 0.2, 0.15);
      hit(S, b + 3.75, 0.5);
    } else {
      // Pop: kick on 1 and 3, snare on 2 and 4, hats on eighths.
      hit(K, b, 1); hit(K, b + 2, 0.9); hit(S, b + 1, 0.85); hit(S, b + 3, 0.85);
      for (let i = 0; i < 8; i++) hit(H, b + i * 0.5, i % 2 ? 0.42 : 0.26);
      if (bar === bars - 1) hit(CL, b + 3.5, 0.4);
    }
  }

  const clip: Extract<AudioClip, { kind: "synth" }> = {
    kind: "synth",
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    start: 0,
    duration: 0,
    wave: "square",
    notes,
    gain: 0.5,
    label: name === "pop" ? "Drums" : `Drums (${name})`,
  };
  clip.duration = synthClipSeconds(clip, bpm);
  return { clip, description: `${notes.length} hits, ${bars} bar${bars === 1 ? "" : "s"} of ${name === "pop" ? "pop" : name}` };
}

export async function openAudioStudio(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim().slice(0, 160);
  if (!title) return { output: "Give the project a title, e.g. “Podcast intro”." };

  const existing = await loadProject<AudioProjectSpec>(ctx.userId, ctx.botId, "audio_project", title);
  if (existing) {
    return {
      output: [
        `Opened “${title}” — ${existing.spec.bpm} BPM, ${audioDuration(existing.spec).toFixed(1)}s, ${existing.spec.tracks.length} tracks.`,
        ...existing.spec.tracks.map((t) => `- ${t.id} (${t.name}): ${t.clips.length ? t.clips.map((c) => `${c.label ?? c.kind} ${c.start.toFixed(1)}s`).join(", ") : "empty"}`),
      ].join("\n"),
      artifactId: existing.id,
    };
  }
  const preset = (Object.keys(AUDIO_PRESETS).includes(String(a.preset)) ? a.preset : "pop") as AudioPresetName;
  const spec = emptyAudioProject(title, preset);
  if (a.brief) spec.brief = String(a.brief).slice(0, 500);
  const id = await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec);
  return {
    output: `Created “${title}” — ${spec.bpm} BPM (${AUDIO_PRESETS[preset].label}) with four tracks: lead, bass, drums, pad. Add parts with audio_add.`,
    artifactId: id,
  };
}

export async function addAudioPart(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<AudioProjectSpec>(ctx.userId, ctx.botId, "audio_project", title);
  if (!found) return { output: `There is no audio project called “${title}”. Open one first with audio_studio.` };
  const spec = found.spec;
  const trackId = String(a.track ?? "lead");
  const track = spec.tracks.find((t) => t.id === trackId) ?? spec.tracks.find((t) => t.name.toLowerCase() === trackId.toLowerCase());
  if (!track) return { output: `No track “${trackId}”. This project has: ${spec.tracks.map((t) => t.id).join(", ")}.` };

  const start = a.start === undefined ? Math.max(0, ...track.clips.map((c) => c.start + c.duration), 0) : Math.max(0, Number(a.start) || 0);
  const kind = String(a.kind ?? "notes");

  if (kind === "drums" || /drum/i.test(String(a.label ?? ""))) {
    // The style is whatever was asked for. This used to collapse every input to
    // "laidback" or "driving", so the nine idioms in drumPattern were reachable
    // only by calling it directly — "house" arrived as "driving".
    const requested = String(a.style ?? "").trim().toLowerCase();
    const style = requested || (/laid|loose|slow/i.test(String(a.label ?? "")) ? "lofi" : "pop");
    const bars = Math.max(1, Math.min(64, Number(a.bars ?? 4) || 4));
    const { clip, description } = drumPattern(style, bars, spec.bpm);
    clip.start = start;
    track.clips.push(clip);
    spec.duration = audioDuration(spec);
    await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
    return { output: `Added ${description} to ${track.id} at ${start.toFixed(1)}s — ${clip.notes.length} hits, ${clip.duration.toFixed(1)}s long. The piece is now ${spec.duration.toFixed(1)}s.`, artifactId: found.id };
  }

  if (kind === "sample") {
    const source = String(a.source ?? "").trim();
    if (!source) return { output: "A sample clip needs a source: the artifact id of the audio." };
    const duration = Math.max(0.2, Number(a.duration ?? 4) || 4);
    track.clips.push({ kind: "sample", id: `c${Date.now().toString(36)}`, start, duration, source, gain: 0.8, label: a.label ? String(a.label) : undefined });
    spec.duration = audioDuration(spec);
    await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
    return { output: `Placed a ${duration}s sample on ${track.id} at ${start.toFixed(1)}s. The piece is now ${spec.duration.toFixed(1)}s.`, artifactId: found.id };
  }

  // A composed part. Notes arrive as "C4:0:1" (pitch:beat:length) or as the
  // explicit list, because a small model writes the compact form reliably and
  // the list form is easy to read back.
  const raw = String(a.notes ?? "").trim();
  let notes: Note[] = [];
  if (raw) {
    notes = raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((token, i) => {
        const [pitch, at, beats] = token.split(":");
        return { pitch: pitch || "C4", at: Number(at ?? i) || 0, beats: Math.max(0.05, Number(beats ?? 1) || 1) };
      });
  } else if (Array.isArray(a.noteList)) {
    notes = (a.noteList as unknown[]).map((n) => {
      const o = (n ?? {}) as Record<string, unknown>;
      return { pitch: String(o.pitch ?? "C4"), at: Number(o.at ?? 0) || 0, beats: Math.max(0.05, Number(o.beats ?? 1) || 1) };
    });
  }
  if (!notes.length) {
    return { output: "Give the part notes, as “C4:0:1 E4:1:1 G4:2:2” — pitch:beat:length — or a noteList of {pitch, at, beats}." };
  }

  const wave = (["sine", "square", "sawtooth", "triangle"].includes(String(a.wave)) ? a.wave : trackId === "bass" ? "triangle" : trackId === "pad" ? "sawtooth" : "square") as "sine" | "square" | "sawtooth" | "triangle";
  const clip: AudioClip = {
    kind: "synth",
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    start,
    duration: 0,
    wave,
    notes,
    gain: Math.max(0, Math.min(1, Number(a.gain ?? 0.18))),
    ...(a.cutoff !== undefined ? { cutoff: Number(a.cutoff) } : {}),
    label: a.label ? String(a.label).slice(0, 80) : undefined,
  };
  const bad = invalidNotes(clip);
  if (bad.length) {
    return { output: `These pitches are not readable: ${bad.slice(0, 6).join(", ")}. Use scientific pitch such as C4, F#3, Bb5, or “rest”.` };
  }
  clip.duration = synthClipSeconds(clip, spec.bpm);
  track.clips.push(clip);
  spec.duration = audioDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);

  const beatsPlayed = notes.reduce((end, n) => Math.max(end, n.at + n.beats), 0);
  return {
    output: `Added a ${notes.length}-note ${wave} part to ${track.id} at ${start.toFixed(1)}s — ${beatsPlayed.toFixed(1)} beats, ${clip.duration.toFixed(1)}s at ${spec.bpm} BPM. The piece is now ${spec.duration.toFixed(1)}s.`,
    artifactId: found.id,
  };
}

export async function editAudioTrack(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<AudioProjectSpec>(ctx.userId, ctx.botId, "audio_project", title);
  if (!found) return { output: `There is no audio project called “${title}”.` };
  const spec = found.spec;

  if (a.bpm !== undefined) {
    const bpm = Math.max(20, Math.min(400, Number(a.bpm) || spec.bpm));
    // Notes are measured in beats, so a tempo change re-times every composed
    // clip — which is what a person means by "make it faster".
    spec.bpm = bpm;
    for (const track of spec.tracks) {
      for (const clip of track.clips) {
        if (clip.kind === "synth") clip.duration = synthClipSeconds(clip, bpm);
      }
    }
  }

  const track = spec.tracks.find((t) => t.id === String(a.track));
  if (track) {
    if (a.muted !== undefined) track.muted = !!a.muted;
    if (a.gain !== undefined) track.gain = Math.max(0, Math.min(1, Number(a.gain)));
    if (a.pan !== undefined) track.pan = Math.max(0, Math.min(1, Number(a.pan)));
    if (a.name !== undefined) track.name = String(a.name).slice(0, 40);
  }

  // A part's sound, as opposed to its notes: wave, envelope, cutoff, detune,
  // echo and vibrato all live on the clip. `parts` says which, and `clip` picks
  // one; without an id every clip on the named track is changed.
  const clip = findAudioClip(spec, a.clip ?? a.id, a.track);
  const clips = clip ? [clip.clip] : String(a.track ?? "") ? spec.tracks.filter((t) => t.id === String(a.track)).flatMap((t) => t.clips) : [];
  const touched = new Set<string>();
  for (const c of clips) {
    if (c.kind !== "synth") continue;
    if (a.wave !== undefined && ["sine", "square", "sawtooth", "triangle"].includes(String(a.wave))) {
      c.wave = a.wave as SynthClip["wave"];
      touched.add("wave");
    }
    if (a.cutoff !== undefined) {
      c.cutoff = Math.max(80, Math.min(18_000, Number(a.cutoff) || 4200));
      touched.add("cutoff");
    }
    if (a.attack !== undefined) {
      c.attack = Math.max(0, Math.min(4, Number(a.attack) || 0));
      touched.add("attack");
    }
    if (a.release !== undefined) {
      c.release = Math.max(0, Math.min(8, Number(a.release) || 0));
      touched.add("release");
    }
    if (a.detune !== undefined) {
      c.detune = Math.max(0, Math.min(50, Number(a.detune) || 0));
      touched.add("detune");
    }
    if (a.gain !== undefined && clip) {
      c.gain = Math.max(0, Math.min(1, Number(a.gain)));
      touched.add("gain");
    }
    if (a.echo !== undefined) {
      const echo = a.echo as Record<string, unknown>;
      const time = Math.max(0.05, Math.min(3, Number(echo.time ?? 0.33) || 0.33));
      const mix = Math.max(0, Math.min(1, Number(echo.mix ?? 0.3)));
      if (mix === 0) delete c.echo;
      else c.echo = { time, feedback: Math.max(0, Math.min(0.9, Number(echo.feedback ?? 0.3))), mix };
      touched.add("echo");
    }
    if (a.vibrato !== undefined) {
      const vib = a.vibrato as Record<string, unknown>;
      const depth = Math.max(0, Math.min(100, Number(vib.depth ?? 12)));
      if (depth === 0) delete c.vibrato;
      else c.vibrato = { rate: Math.max(0.1, Math.min(14, Number(vib.rate ?? 5))), depth };
      touched.add("vibrato");
    }
  }

  spec.duration = audioDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
  const bits = [
    a.bpm !== undefined ? `tempo is now ${spec.bpm} BPM` : "",
    track && a.muted !== undefined ? `${track.id} is ${track.muted ? "muted" : "unmuted"}` : "",
    track && a.gain !== undefined && !clip ? `${track.id} gain ${track.gain}` : "",
    touched.size ? `${[...touched].join(", ")} changed on ${clip ? "that part" : `every part on ${String(a.track ?? "the piece")}`}` : "",
  ].filter(Boolean);
  return { output: `${bits.length ? bits.join(", ") + ". " : ""}The piece is ${spec.duration.toFixed(1)}s long.`, artifactId: found.id };
}

/** Locate a clip by id, optionally restricted to a track. */
function findAudioClip(
  spec: AudioProjectSpec,
  id: unknown,
  trackId?: unknown,
): { track: AudioTrack; clip: AudioClip } | null {
  if (id === undefined || id === null || id === "") return null;
  const tracks = trackId ? spec.tracks.filter((t) => t.id === String(trackId)) : spec.tracks;
  for (const track of tracks) {
    const clip = track.clips.find((c) => c.id === String(id));
    if (clip) return { track, clip };
  }
  return null;
}

/** Add a track to a project, so a Bot can write a counter-melody or a vocal. */
export async function addAudioTrack(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<AudioProjectSpec>(ctx.userId, ctx.botId, "audio_project", title);
  if (!found) return { output: `There is no audio project called “${title}”.` };
  const spec = found.spec;
  const name = String(a.name ?? a.track ?? "").trim() || `Part ${spec.tracks.length + 1}`;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `t${spec.tracks.length + 1}`;
  if (spec.tracks.some((t) => t.id === id)) return { output: `There is already a track called “${id}”. The tracks are ${spec.tracks.map((t) => t.id).join(", ")}.` };
  spec.tracks.push({
    id,
    name,
    clips: [],
    gain: Math.max(0, Math.min(1, Number(a.gain ?? 0.18))),
    ...(a.pan !== undefined ? { pan: Math.max(0, Math.min(1, Number(a.pan))) } : {}),
    ...(a.muted ? { muted: true } : {}),
  });
  await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
  return { output: `Added a track “${id}” (${name}). Write into it with audio_add track ${id}.`, artifactId: found.id };
}

/** Remove a track, or one part from it. */
export async function removeAudioPart(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<AudioProjectSpec>(ctx.userId, ctx.botId, "audio_project", title);
  if (!found) return { output: `There is no audio project called “${title}”.` };
  const spec = found.spec;

  if (a.track && !a.id && !a.clip) {
    const before = spec.tracks.length;
    spec.tracks = spec.tracks.filter((t) => t.id !== String(a.track));
    if (spec.tracks.length === before) return { output: `No track called “${String(a.track)}”. The tracks are ${spec.tracks.map((t) => t.id).join(", ")}.` };
    spec.duration = audioDuration(spec);
    await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
    return { output: `Removed the track “${String(a.track)}”. ${spec.tracks.length} left.`, artifactId: found.id };
  }

  const hit = findAudioClip(spec, a.id ?? a.clip, a.track);
  if (!hit) {
    const ids = spec.tracks.flatMap((t) => t.clips.map((c) => c.id));
    return { output: ids.length ? `No part with that id. The parts are ${ids.join(", ")}.` : "There are no parts to remove yet." };
  }
  hit.track.clips = hit.track.clips.filter((c) => c !== hit.clip);
  spec.duration = audioDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
  return { output: `Removed ${hit.clip.id} from ${hit.track.id}. The piece is ${spec.duration.toFixed(1)}s long.`, artifactId: found.id };
}

/** Move a part along its track, or onto another one. */
export async function moveAudioPart(
  ctx: { userId: string; botId: string },
  a: Record<string, unknown>,
): Promise<StudioResult> {
  const title = String(a.title ?? "").trim();
  const found = await loadProject<AudioProjectSpec>(ctx.userId, ctx.botId, "audio_project", title);
  if (!found) return { output: `There is no audio project called “${title}”.` };
  const spec = found.spec;
  const hit = findAudioClip(spec, a.id ?? a.clip, a.track);
  if (!hit) {
    const ids = spec.tracks.flatMap((t) => t.clips.map((c) => c.id));
    return { output: ids.length ? `No part with that id. The parts are ${ids.join(", ")}.` : "There are no parts to move yet." };
  }
  let moved = "";
  if (a.start !== undefined) {
    hit.clip.start = Math.max(0, Number(a.start) || 0);
    moved = `to ${hit.clip.start.toFixed(2)}s`;
  }
  if (a.to && String(a.to) !== hit.track.id) {
    const dest = spec.tracks.find((t) => t.id === String(a.to));
    if (!dest) return { output: `No track called “${String(a.to)}”. The tracks are ${spec.tracks.map((t) => t.id).join(", ")}.` };
    hit.track.clips = hit.track.clips.filter((c) => c !== hit.clip);
    dest.clips.push(hit.clip);
    moved = [moved, `onto ${dest.id}`].filter(Boolean).join(" ");
  }
  spec.duration = audioDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
  return { output: `Moved ${hit.clip.id} ${moved || "(nothing changed)"}.`, artifactId: found.id };
}

/** A short summary of a project, for a tool that needs to describe it. */
export function describeAudio(project: AudioProjectSpec): string {
  const spb = secondsPerBeat(project.bpm);
  return [
    `${project.title}: ${project.bpm} BPM (${spb.toFixed(2)}s per beat), ${audioDuration(project).toFixed(1)}s.`,
    ...project.tracks.map((t) => {
      // The id comes first: audio_move and audio_remove address a part by id, so
      // a summary without one left the Bot able to read a project and unable to
      // change it.
      const parts = t.clips.map((c) => {
        const sound =
          c.kind === "synth"
            ? `${c.notes.length} notes ${c.wave}`
            : `sample ${c.label ?? c.source.slice(0, 12)}`;
        const extras = [
          `${c.start.toFixed(1)}s+${c.duration.toFixed(1)}s`,
          c.kind === "synth" && c.detune ? `detune ${c.detune}` : "",
          c.kind === "synth" && c.echo ? "echo" : "",
          c.kind === "synth" && c.cutoff ? `cutoff ${c.cutoff}` : "",
        ].filter(Boolean);
        return `${c.id} ${sound} (${extras.join(", ")})`;
      });
      return `- ${t.id}${t.muted ? " (muted)" : ""}, gain ${t.gain ?? 0.2}${t.pan !== undefined ? `, pan ${t.pan}` : ""}: ${parts.join("; ") || "empty"}`;
    }),
  ].join("\n");
}

/** Tool-facing wrapper so the audio desk can read a project without editing. */
export async function readAudioProject(
  ctx: { userId: string; botId: string },
  title: string,
): Promise<StudioResult> {
  const found = await loadProject<AudioProjectSpec>(ctx.userId, ctx.botId, "audio_project", title);
  if (!found) return { output: `There is no audio project called “${title}”.` };
  return { output: describeAudio(found.spec), artifactId: found.id };
}

/** Frequencies for a part, so the studio's synth and any checks agree. */
export function frequenciesFor(notes: Note[]): { pitch: string; hz: number }[] {
  return notes.map((n) => ({ pitch: n.pitch, hz: pitchToFrequency(n.pitch) }));
}
