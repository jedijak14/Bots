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
  type Note,
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

/* ---------------------------------- audio --------------------------------- */

/** A drum pattern, written as notes, so the Bot can compose one. */
function drumPattern(style: string, bars: number, bpm: number): { clip: Extract<AudioClip, { kind: "synth" }>; description: string } {
  // Drum sounds are synthesised noise and clicks at these pitches; the names
  // map to the kit the studio plays, not to real drums.
  const beatsPerBar = 4;
  const total = bars * beatsPerBar;
  const notes: Note[] = [];
  const kick = "C2";
  const snare = "D2";
  const hat = "F#2";
  const laid = style === "laidback";
  for (let beat = 0; beat < total; beat++) {
    // Kick on 1 and 3, plus a pickup before the bar when the style is busy.
    if (beat % beatsPerBar === 0 || beat % beatsPerBar === 2) notes.push({ pitch: kick, at: beat, beats: 0.4, velocity: 1 });
    if (beat % beatsPerBar === (laid ? 2 : 2)) notes.push({ pitch: snare, at: beat, beats: 0.4, velocity: 0.8 });
    // Hats on every eighth; a laid-back pattern skips every other one.
    if (!laid || beat % 2 === 0) notes.push({ pitch: hat, at: beat, beats: 0.2, velocity: 0.35 });
  }
  const clip: Extract<AudioClip, { kind: "synth" }> = {
    kind: "synth",
    id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
    start: 0,
    duration: 0,
    wave: "square",
    notes,
    gain: 0.25,
    label: `${bars} bar ${style} drums`,
  };
  clip.duration = synthClipSeconds(clip, bpm);
  return { clip, description: `${bars} bar${bars === 1 ? "" : "s"} of ${style} drums` };
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
    const style = /laid|loose|slow/i.test(String(a.style ?? a.label ?? "")) ? "laidback" : "driving";
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
  }

  spec.duration = audioDuration(spec);
  await saveProject(ctx.userId, ctx.botId, "audio_project", title, spec, found.id);
  const bits = [
    a.bpm !== undefined ? `tempo is now ${spec.bpm} BPM` : "",
    track && a.muted !== undefined ? `${track.id} is ${track.muted ? "muted" : "unmuted"}` : "",
    track && a.gain !== undefined ? `${track.id} gain ${track.gain}` : "",
  ].filter(Boolean);
  return { output: `${bits.length ? bits.join(", ") + ". " : ""}The piece is ${spec.duration.toFixed(1)}s long.`, artifactId: found.id };
}

/** A short summary of a project, for a tool that needs to describe it. */
export function describeAudio(project: AudioProjectSpec): string {
  const spb = secondsPerBeat(project.bpm);
  return [
    `${project.title}: ${project.bpm} BPM (${spb.toFixed(2)}s per beat), ${audioDuration(project).toFixed(1)}s.`,
    ...project.tracks.map((t) => {
      const parts = t.clips.map((c) =>
        c.kind === "synth" ? `${c.notes.length} notes ${c.wave} @${c.start.toFixed(1)}s` : `sample @${c.start.toFixed(1)}s`,
      );
      return `- ${t.id}${t.muted ? " (muted)" : ""}: ${parts.join(", ") || "empty"}`;
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
