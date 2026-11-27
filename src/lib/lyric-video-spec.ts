/**
 * The lyric video spec, shared by the browser player and the server tool.
 * Kept free of `server-only` so the player can import it.
 */
export type LyricVideoSpec = {
  version: 1;
  title: string;
  artist?: string;
  /** Rendered MP4 artifact, if the user has exported this preview. */
  videoId?: string;
  /** Artifact id of the uploaded song. */
  audioId: string;
  /** Artifact id of the album art, when one was uploaded. */
  artId?: string;
  /** The lyrics source text, in whatever format the person supplied. */
  lyrics: string;
  /** "lrc" | "srt" | "ttml" | "qrc" | "plain" — the player auto-detects anyway. */
  lyricFormat?: string;
  /** A named look from LYRIC_PRESETS. */
  preset?: string;
  accent?: string;
};

export const LYRIC_PRESETS = {
  aurora: "linear-gradient(135deg,#a8c0ff 0%,#c4b5fd 45%,#7dd3fc 100%)",
  ember: "linear-gradient(135deg,#ffd6a5 0%,#ff9aa2 50%,#c9184a 100%)",
  mint: "linear-gradient(135deg,#d9f99d 0%,#6ee7b7 50%,#0ea5e9 100%)",
  mono: "linear-gradient(135deg,#ffffff 0%,#d4d4d8 100%)",
} as const;

export function parseSpec(content: string): LyricVideoSpec | null {
  try {
    const parsed = JSON.parse(content) as LyricVideoSpec;
    if (!parsed || typeof parsed !== "object" || !parsed.audioId || !parsed.title) return null;
    return parsed;
  } catch {
    return null;
  }
}
