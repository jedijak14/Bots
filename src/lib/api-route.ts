import "server-only";

/**
 * Choosing how to get an answer: a plain API, or a browser.
 *
 * A question like "what's the cheapest flight to Denver on Friday" can be
 * answered two ways. A site that publishes a JSON API answers in one cheap
 * request; a site that only has a web page needs a browser to render it, which
 * is seconds rather than milliseconds. The Bot should not have to know which
 * kind of site it is talking to, and it should not pay for a browser when an
 * API would do.
 *
 * API Anything turns a site into a callable operation by learning how its own
 * frontend fetches data. That is the fast path. The slow path — a real browser
 * driving a real page — is what the Bot already has when it has a computer.
 *
 * This module decides, and says why, so the choice is visible in the chat
 * rather than buried in a tool call.
 */

export type Route = "api" | "browser";

export type RouteDecision = {
  route: Route;
  /** One short line the chat can show, e.g. "asking the site's own API". */
  why: string;
  /** What to do instead if the first attempt fails. */
  fallback?: { route: Route; why: string };
};

/** Signals that a page must be rendered: the data is not in the response. */
const RENDER_ONLY =
  /\b(screenshot|screen shots?|visually|look at|see (the|what)|click|log ?in(g|to)?|sign ?in|sign ?up|register|fill (in|out)|submit|captcha|behind a login|dashboard|my account|my (bank|balance)|cart|checkout|upload|download (a|the) file)\b/i;

/** Signals that an answer is a commodity that some site already publishes. */
const API_FRIENDLY =
  /\b(flight|flights|airfare|hotel|hotels|train|bus|weather|forecast|stock|stocks|crypto|price|prices|exchange rate|currency|convert|definition|wiki|translate|translation|lyrics|movie|movies|imdb|shoe|shoes|product|products|review|reviews|recipe|recipes|news|headline|headlines|story|stories|article|articles|paper|papers|arxiv|repo|repository|npm|package|release|score|scores|game|games|odds|poi|restaurant|restaurants|population)\b/i;

/**
 * Decide a route for a request.
 *
 * The rule, in order:
 *  1. Something that only exists in a rendered page goes to the browser. No API
 *     can screenshot a layout or click a button.
 *  2. Something a site publishes as data goes to the API path. It is faster and
 *     it costs the site far less than a headless browser.
 *  3. Anything ambiguous goes to the API path first, because a failure there is
 *     cheap and tells you what to do next. The browser is the fallback, not the
 *     default: it is ten to a hundred times slower and fails in ways that are
 *     hard to explain.
 */
export function decideRoute(request: string, hasComputer: boolean): RouteDecision {
  const text = request.toLowerCase();
  // The reason has to match the branch that actually fired, or the chat reports
  // a decision the code did not make.
  const renderOnly = RENDER_ONLY.test(text);
  const apiFriendly = API_FRIENDLY.test(text);

  if (renderOnly) {
    return {
      route: hasComputer ? "browser" : "api",
      why: hasComputer
        ? "this needs the page itself, so a browser opens it"
        : "this needs a page to be rendered and there is no computer, so it will try the API path",
      fallback: hasComputer ? { route: "api", why: "if the page will not load, ask the site's API" } : undefined,
    };
  }

  if (apiFriendly) {
    return {
      route: "api",
      why: "this is data a site already publishes, so ask for it directly instead of opening a browser",
      fallback: hasComputer ? { route: "browser", why: "if no operation is known, open the page instead" } : undefined,
    };
  }

  return {
    route: "api",
    why: "try the direct call first; it is far cheaper than a browser",
    fallback: hasComputer ? { route: "browser", why: "open the page if no operation is known" } : undefined,
  };
}

/**
 * Read API Anything's own advice out of its answer.
 *
 * It reports a machine-readable `next` action ("retry", "learn", "browser"),
 * which is a better guide than any rule written here: it knows which tier it
 * tried and why that tier failed.
 */
export function nextFromAnswer(raw: string): { action: string; reason: string } {
  const line = raw.trim().split("\n").find((l) => l.trim().startsWith("{"));
  if (!line) return { action: "unknown", reason: "no structured answer" };
  try {
    const parsed = JSON.parse(line) as {
      ok?: boolean;
      class?: string;
      reason?: string;
      next?: string;
      nextCall?: { action?: string };
    };
    if (parsed.ok) return { action: "done", reason: "answered" };
    return {
      action: parsed.nextCall?.action ?? "stop",
      reason: parsed.reason ?? parsed.next ?? "the call failed",
    };
  } catch {
    return { action: "unknown", reason: raw.slice(0, 200) };
  }
}
