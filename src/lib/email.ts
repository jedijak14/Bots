/**
 * Email helpers shared by the agent tool, the send route and the UI.
 * Kept free of server-only imports so it can be unit-tested directly.
 */

/** Matches a bare address: local part, @, a domain with at least one dot and a 2+ char TLD. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Extracts the address from “a@x.com” or “Name <a@x.com>”, or null when malformed. */
export function parseRecipient(value: string): string | null {
  const v = value.trim();
  if (!v || /[\r\n]/.test(v)) return null;
  const m = /^(.*)<([^<>]+)>\s*$/.exec(v);
  const addr = (m ? m[2] : v).trim();
  return EMAIL_RE.test(addr) ? addr : null;
}

/** True when the whole string is a valid recipient (bare or display-name form). */
export function isValidEmailRecipient(value: string): boolean {
  return parseRecipient(value) !== null;
}

/**
 * Splits a comma/newline separated list of recipients into valid addresses.
 * Returns `{ ok, invalid }` so callers can show which entries were rejected.
 */
export function splitRecipients(value: string): { ok: string[]; invalid: string[] } {
  const ok: string[] = [];
  const invalid: string[] = [];
  for (const part of value.split(/[\n,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const addr = parseRecipient(p);
    if (addr) ok.push(addr);
    else invalid.push(p);
  }
  return { ok, invalid };
}
