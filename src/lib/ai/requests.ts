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
  // `and` before the connector belongs to it: "…lighthouse and also a poem".
  const SEP = /\s*,?\s*(?:(also|plus)\b|(?:and\s+then|,\s*then)\b)\s*,?\s+/i;
  // A sentence that begins with a join continues the message into a new request.
  const OPENER = /^(?:and\s+)?(also|plus|then|and then)\b\s*,?\s*/i;

  const pieces: Piece[] = [];
  // Sentence boundaries do NOT make new requests. "What is 2+2? Just answer
  // briefly." is one request with a style note; splitting it produced a second
  // job ("Just answer briefly.") that no reply can ever address, and the turn
  // ended with a phantom "Not covered yet". A sentence only starts a new
  // request when it opens with an explicit join ("Also…", "Then…", "And what
  // about…").
  text.split(/(?<=[.!?])\s+/).forEach((sentence, index) => {
    let chunk = sentence.trim();
    let kind: Piece["kind"] = "lead";
    if (index > 0) {
      const opener = OPENER.exec(chunk) ?? /^and\s+/i.exec(chunk);
      if (opener) {
        kind = /also|plus/i.test(opener[1] ?? "") ? "also" : "then";
        chunk = chunk.slice(opener[0].length);
      }
    }

    // Joins inside the sentence always begin a new request.
    const bits: Piece[] = [];
    let rest = chunk;
    let current: Piece["kind"] = kind;
    while (rest) {
      const match = SEP.exec(rest);
      if (!match || match.index === 0) break;
      const before = rest
        .slice(0, match.index)
        .replace(/,\s*$/, "")
        .replace(/\s+and$/i, "")
        .trim();
      if (before) bits.push({ text: before, kind: current });
      current = match[1] ? "also" : "then";
      rest = rest.slice(match.index + match[0].length).trim();
    }
    if (rest) bits.push({ text: rest.replace(/^[\s,]+/, "").trim(), kind: current });

    bits.forEach((bit, i) => {
      // The first bit continues the previous request unless the sentence opened
      // with a join; every later bit is a join and starts its own.
      const startsNew = i > 0 || bit.kind !== "lead" || pieces.length === 0;
      if (startsNew) pieces.push({ text: bit.text, kind: bit.kind });
      else pieces[pieces.length - 1].text = `${pieces[pieces.length - 1].text} ${bit.text}`.trim();
    });
  });
  return pieces.filter((piece) => piece.text.length > 0);
}

/**
 * Rejoin sequence scraps.
 *
 * Word count alone cannot tell a step from a job: "add a login button, then
 * make it red" and "summarise this, then email it to Sam" are both a short
 * clause followed by a short clause across a `then`. What separates them is the
 * verb. A step modifies the thing already built — make it red, deploy it, test
 * it — usually through a pronoun. A job introduces a new object: "email it to
 * Sam" is not editing it, it is sending it somewhere.
 *
 * So a `then` clause whose verb modifies its object folds into the clause
 * before it. A clause with its own destination or purpose stands alone. An
 * addition ("also") always stands.
 */
const MODIFYING = /^(?:make|set|change|turn|fix|test|try|check|verify|run|deploy|push|commit|ship|redo|adjust|tweak|update|rename|move|resize)\b[\s\S]*?\b(?:it|this|that|them|those)\b/i;

function mergeScraps(pieces: Piece[]): string[] {
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged[merged.length - 1];
    const short = wordCount(piece.text) < STANDS_ALONE;
    // Two ways to fold a `then` clause. A clause too short to be a request on
    // its own ("home", "a car") belongs to the one before it, whatever verb it
    // has. A longer clause folds only when its verb modifies the existing thing
    // ("deploy it") rather than sending it somewhere ("email it to Sam").
    const scrap = wordCount(piece.text) < 3;
    if (previous && piece.kind === "then" && (scrap || (short && MODIFYING.test(piece.text)))) {
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
    // A reply to "draft an email" shows a Subject line and a Body; it rarely
    // says the word "email" itself.
    "email", "mail", "message", "before", "after", "until", "within",
  ]);
  const missing: string[] = [];
  // Style constraints are not the job: "Keep it under 100 words" and "be brief"
  // are instructions about HOW, and a short reply satisfies them without ever
  // saying the words. Including them made an answered request read as missing.
  const CONSTRAINTS = /\b(?:keep|keeping|under|over|at most|at least|no more than|brief|briefly|short|concise|concise|max|maximum|min|minimum|words?|sentences?|paragraphs?|tone|formal|informal|casual)\b/gi;
  for (const part of parts) {
    const words = [
      ...new Set(
        part
          .replace(CONSTRAINTS, " ")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 3 && !STOP.has(word)),
      ),
    ];
    // No distinctive word at all cannot be checked honestly, so the part is
    // given the benefit of the doubt. One word is enough: "also add a test for
    // it" reduces to just "test", and a reply that never says the word plainly
    // did not mention the test.
    if (words.length < 1) continue;
    // Stem before matching: a request to "summarise" is answered by a reply that
    // says "Summary", and requiring the exact word reported jobs as missing that
    // had plainly been done.
    // Two ways a word counts as answered: the reply contains it, or contains
    // its stem. Both are needed — "summarise" is answered by "Summary", and
    // "draft" by "Drafting" — and neither may be strict, because flagging a job
    // that was plainly done costs the user a correction and costs trust.
    const stem = (word: string) => word.replace(/(?:ise|ize|ing|ed|es|s|e)$/, "");
    const hits = words.filter((word) => said.includes(word) || said.includes(stem(word))).length;
    if (hits / words.length < 0.34) missing.push(part);
  }
  return missing;
}
