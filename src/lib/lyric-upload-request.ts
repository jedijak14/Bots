import { isUuid } from "./ids";

export type LyricUploadRequest = { title: string; artist?: string; audioId: string; lyricsId: string; artId?: string; lyricFormat: string };

/** Only recognise the exact draft produced by the lyric upload sheet. Extra user text must go to the model. */
export function parseLyricUploadRequest(content: string): LyricUploadRequest | null {
  const lines = content.trim().replace(/\r\n/g, "\n").split("\n");
  if (lines.length < 3 || lines.length > 4) return null;
  const header = /^Make a lyric video from my uploads\. Title: (.+?)(?:, artist (.+?))?\.$/.exec(lines[0]);
  const audio = /^Audio artifact id: ([a-f0-9-]+)$/i.exec(lines[1]);
  const cover = lines.length === 4 ? /^Cover art artifact id: ([a-f0-9-]+)$/i.exec(lines[2]) : null;
  const lyrics = /^Lyrics artifact id: ([a-f0-9-]+) \((lrc|srt|ttml|qrc|plain)\)$/i.exec(lines[lines.length - 1]);
  if (!header || !audio || !lyrics || (lines.length === 4 && !cover)) return null;
  const title = header[1].trim();
  const artist = header[2]?.trim();
  if (!title || title.length > 160 || (artist && artist.length > 160)) return null;
  if (!isUuid(audio[1]) || !isUuid(lyrics[1]) || (cover && !isUuid(cover[1]))) return null;
  return { title, ...(artist ? { artist } : {}), audioId: audio[1], lyricsId: lyrics[1], ...(cover ? { artId: cover[1] } : {}), lyricFormat: lyrics[2].toLowerCase() };
}
