/** Find the latest started caption, respecting explicit gaps and end times. Lines must be sorted. */
export function lyricAtTime<T extends { startTimeMs: number; durationMs: number }>(lines: T[], timeMs: number): T | null {
  let lo = 0, hi = lines.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lines[mid].startTimeMs <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  const line = lines[lo - 1];
  if (!line || (line.durationMs > 0 && timeMs >= line.startTimeMs + line.durationMs)) return null;
  return line;
}
