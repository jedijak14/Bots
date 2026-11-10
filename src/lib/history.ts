/** Search results should show where the match occurred, not just the start of a long artifact. */
export function historyExcerpt(content: string, query: string, radius = 600): string {
  const at = content.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, at - radius);
  const end = Math.min(content.length, Math.max(0, at) + query.length + radius);
  return `${start ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

/** Return bounded slices so a model can retrieve a long saved message in order. */
export function historyPage(content: string, offset: number, size = 6000) {
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const end = Math.min(content.length, start + size);
  return { content: content.slice(start, end), offset: start, nextOffset: end < content.length ? end : null, totalLength: content.length };
}
