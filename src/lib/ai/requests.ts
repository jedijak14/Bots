/**
 * Splitting one message into the separate requests inside it.
 *
 * "Write the subject line, also draft the body, and remind me to attach the
 * invoice" contains three jobs. A small model reliably does the first and
 * forgets the rest, and nothing in the app noticed: the reply looked finished
 * because it ended. This finds the parts so the Bot can be told, in the same
 * turn, exactly what they were.
 *
 * Deliberately conservative. A false alarm — telling a Bot that "make it red"
 * was a request it forgot — is worse than missing a subtle second job, because
 * it spends the turn apologising for something nobody asked for. So only two
 * shapes count: a list (each item is a job by construction), and an explicit
 * addition between two clauses that are each long enough to stand alone.
 */

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** "make it red" is a step inside a request; "draft the body" is the request. */
const STANDS_ALONE = 4;

/**
 * Split on the connectors people use to add a second job.
 *
 * Two kinds, because they behave differently:
 *
 * - an **addition** (`also`, `plus`) introduces another job outright, however
 *   short — "make me a logo, also a banner" is two pieces of work;
 * - a **sequence** (`then`, `and then`) joins steps that may be one job —
 *   "make it red and then test it" is a single request with two steps — so its
 *   pieces are merged back unless each is long enough to stand alone.
 *
 * A bare "then" with no comma before it is left alone: that is grammar
 * ("research three competitors then write the table"), not a boundary.
 */
type Piece = { text: string; kind: "lead" | "also" | "then" };

function splitConnectors(text: string): Piece[] {
  const pieces: Piece[] = [];
  // `and` before the connector belongs to it: "…lighthouse and also a poem".
  // "then" needs the comma, or "and then". Without punctuation it is grammar:
  // "research three competitors then write the table" is one request.
  const SEP = /\s*,?\s*(?:(also|plus)\b|(?:and\s+then|,\s*then)\b)\s*,?\s+/i;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    let rest = sentence.trim();
    let kind: Piece["kind"] = "lead";
    while (rest) {
      const match = SEP.exec(rest);
      if (!match || match.index === 0) break;
      // "…lighthouse and also a poem" — the "and" belongs to the connector, not
      // to the end of the job.
      const before = rest
        .slice(0, match.index)
        .replace(/,\s*$/, "")
        .replace(/\s+and$/i, "")
        .trim();
      if (before) pieces.push({ text: before, kind });
      kind = match[1] ? "also" : "then";
      rest = rest.slice(match.index + match[0].length).trim();
    }
    if (rest) pieces.push({ text: rest.replace(/^[\s,]+/, "").trim(), kind });
  }
  return pieces.filter((piece) => piece.text.length > 0);
}

/**
 * Rejoin sequence scraps. An addition always stands as its own job; a step
 * after "then" only does if it is long enough to be one.
 */
function mergeScraps(pieces: Piece[]): string[] {
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    const short = wordCount(piece.text) < STANDS_ALONE;
    const previousShort = previous ? wordCount(previous.text) < STANDS_ALONE : false;
    // Only fold a *following* step into its predecessor. Folding a short lead
    // into the job after it swallowed real requests: "research three
    // competitors then write the table" became one, and "add a login button,
    // then make it red" lost its first step.
    if (previous && piece.kind === "then" && (short || previousShort)) {
      previous.text = `${previous.text}, ${piece.text}`;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged.map((piece) => piece.text);
}

/**
 * Split a message into its separate requests.
 *
 * Returns one entry for an ordinary single-request message, so the caller can
 * use `parts.length > 1` without a special case.
 */
export function splitRequests(message: string): string[] {
  const text = message.trim();
  if (!text) return [];

  // A list is unambiguous: every item is a job by construction.
  const isItem = (line: string) => /^(?:[-*•]|\d+[.)])\s+/.test(line);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const items = lines
    .filter(isItem)
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((item) => item.length > 2);
  if (items.length >= 2) {
    const intro = lines.filter((line) => !isItem(line)).join(" ").trim();
    return intro ? [intro, ...items] : items;
  }

  const parts = mergeScraps(splitConnectors(text)).filter((part) => part.trim().length > 0);
  return parts.length > 1 ? parts : [text];
}

/**
 * Which parts the reply shows no sign of addressing.
 *
 * Forgotten on purpose: a part counts as handled if a good share of its
 * distinctive words appear anywhere in the reply or in what the tools returned.
 * This catches a job dropped completely; it does not grade prose.
 */
export function unansweredParts(parts: string[], reply: string, opts: { steps?: string } = {}): string[] {
  const said = `${reply}\n${opts.steps ?? ""}`.toLowerCase();
  const STOP = new Set([
    "the", "and", "for", "with", "that", "this", "have", "from", "your", "you",
    "please", "could", "would", "should", "make", "also", "then", "into", "about",
    "them", "they", "will", "what", "when", "some", "just", "like", "want", "need",
    "remind", "write", "draft", "give", "send", "find", "tell", "show", "help",
    "here", "there", "them", "over", "these", "those",
  ]);
  const missing: string[] = [];
  for (const part of parts) {
    const words = [
      ...new Set(
        part
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 3 && !STOP.has(word)),
      ),
    ];
    // Fewer than two distinctive words cannot be checked honestly, so the part
    // is given the benefit of the doubt rather than reported as missing.
    if (words.length < 2) continue;
    const hits = words.filter((word) => said.includes(word)).length;
    if (hits / words.length < 0.34) missing.push(part);
  }
  return missing;
}
