/** Untimed text has every line at zero; spread it over the track as an estimate. */
export function timePlainLyrics<T extends { startTimeMs: number; durationMs: number }>(lines: T[], durationMs?: number): T[] {
  if (!lines.length || !durationMs || !Number.isFinite(durationMs) || durationMs <= 0 || lines.some(line => line.startTimeMs !== 0 || line.durationMs > 0)) return lines;
  return lines.map((line, i) => ({ ...line, startTimeMs: durationMs * i / lines.length, durationMs: durationMs / lines.length }));
}
