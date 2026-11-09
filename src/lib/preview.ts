/**
 * Turns a chat message into the single line shown under a bot's name in the
 * sidebar: no code, no markdown punctuation, no table pipes.
 */
export function previewText(raw: string | null | undefined, max = 90): string {
  return (raw ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/gm, " ")
    .replace(/[#*_`>~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
