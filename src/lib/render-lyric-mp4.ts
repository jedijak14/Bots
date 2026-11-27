import type { LyricVideoSpec } from "./lyric-video-spec";
import { timePlainLyrics } from "./lyric-timing";
import { lyricAtTime } from "./lyric-render-timing";
import { fetchMediaBlob } from "./media-client";

const WIDTH = 640, HEIGHT = 360, FPS = 10, MAX_SECONDS = 600;
const colors: Record<string, [string, string]> = {
  aurora: ["#475f9c", "#33245b"], ember: ["#bd5f54", "#53162c"],
  mint: ["#3c957a", "#16415e"], mono: ["#66666e", "#1c1c20"],
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Render the audio and captions into a real H.264/AAC MP4 in the user's browser. */
export async function renderLyricMp4(spec: LyricVideoSpec, duration: number, signal: AbortSignal, progress: (message: string) => void): Promise<Blob> {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) throw new Error("MP4 rendering supports songs up to 10 minutes with a known duration.");
  const [media, parsers] = await Promise.all([import("mediabunny"), import("@braccato/parsers")]);
  if (!await media.canEncodeVideo("avc", { width: WIDTH, height: HEIGHT, bitrate: 320_000 })) throw new Error("This browser cannot encode H.264 video. Try an up-to-date Chrome, Edge, or Safari on a supported device.");
  if (!await media.canEncodeAudio("aac")) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }
  const abort = () => { if (signal.aborted) throw new DOMException("Rendering cancelled.", "AbortError"); };
  progress("Loading song and artwork…");
  const audioBlob = await fetchMediaBlob(spec.audioId, signal);
  let image: ImageBitmap | null = null;
  if (spec.artId) image = await createImageBitmap(await fetchMediaBlob(spec.artId, signal));
  const audioContext = new AudioContext();
  let output: InstanceType<typeof media.Output> | undefined;
  try {
    abort();
    const audio = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
    if (audio.duration <= 0 || audio.duration > MAX_SECONDS || audio.numberOfChannels > 2) throw new Error("MP4 rendering supports mono or stereo songs up to 10 minutes.");
    const lines = timePlainLyrics(parsers.detectParser(spec.lyrics).parse(spec.lyrics, audio.duration * 1000), audio.duration * 1000).filter(line => line.words.trim()).sort((a, b) => a.startTimeMs - b.startTimeMs);
    if (!lines.length) throw new Error("No lyric lines could be rendered.");
    if (lines.some(line => line.words.length > 1000)) throw new Error("A lyric line is too long to render. Please split it into shorter lines.");
    const canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot create the video canvas.");
    const target = new media.BufferTarget();
    output = new media.Output({ format: new media.Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const video = new media.CanvasSource(canvas, { codec: "avc", bitrate: 320_000 });
    const sound = new media.AudioBufferSource({ codec: "aac", bitrate: 96_000 });
    output.addVideoTrack(video, { frameRate: FPS }); output.addAudioTrack(sound);
    await output.start();
    const check = () => { abort(); };
    const draw = (time: number) => {
      if (image) {
        const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
        const w = image.width * scale, h = image.height * scale;
        ctx.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      } else {
        const [first, second] = colors[spec.preset || "aurora"] || colors.aurora;
        const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT); grad.addColorStop(0, first); grad.addColorStop(1, second);
        ctx.fillStyle = grad; ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
      ctx.fillStyle = "rgba(0,0,0,0.58)"; ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.65)"; ctx.font = "600 16px sans-serif";
      ctx.fillText([spec.title, spec.artist].filter(Boolean).join(" — ").slice(0, 100), WIDTH / 2, 38, WIDTH - 50);
      const active = lyricAtTime(lines, time * 1000);
      if (!active) return;
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(spec.accent || "") ? spec.accent! : "#ffffff";
      let size = 30, text: string[];
      do { ctx.font = `700 ${size}px sans-serif`; text = wrap(ctx, active.words, WIDTH - 80); if (text.length * size * 1.25 <= 260 || size <= 10) break; size -= 2; } while (true);
      if (text.length * size * 1.25 > 260) throw new Error("A lyric line is too long to fit in the video. Please split it into shorter lines.");
      text.forEach((line, i) => ctx.fillText(line, WIDTH / 2, HEIGHT / 2 + (i - (text.length - 1) / 2) * size * 1.25, WIDTH - 80));
    };
    progress("Rendering MP4… 0%");
    // Feed both tracks concurrently: the muxer applies backpressure to keep them synchronized.
    await Promise.all([
      (async () => {
        for (let offset = 0; offset < audio.length; offset += audio.sampleRate) {
          check();
          const length = Math.min(audio.sampleRate, audio.length - offset);
          const part = audioContext.createBuffer(audio.numberOfChannels, length, audio.sampleRate);
          for (let c = 0; c < audio.numberOfChannels; c++) part.copyToChannel(audio.getChannelData(c).subarray(offset, offset + length), c);
          await sound.add(part);
        }
        sound.close();
      })(),
      (async () => {
        const frames = Math.ceil(audio.duration * FPS);
        for (let i = 0; i < frames; i++) {
          check(); draw(i / FPS);
          await video.add(i / FPS, Math.min(1 / FPS, audio.duration - i / FPS));
          if (i % FPS === 0) progress(`Rendering MP4… ${Math.floor(i / frames * 100)}%`);
        }
        video.close();
      })(),
    ]);
    check(); progress("Finishing MP4…");
    await output.finalize();
    if (!target.buffer?.byteLength) throw new Error("The MP4 encoder produced an empty file.");
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    if (output && output.state === "started") await output.cancel().catch(() => {});
    throw error;
  } finally {
    image?.close();
    await audioContext.close().catch(() => {});
  }
}
