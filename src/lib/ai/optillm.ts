import "server-only";

/**
 * OptiLLM: more ability from the same model.
 *
 * A weak model answers a hard question in one pass. OptiLLM answers it several
 * ways and compares: chain-of-thought with reflection, best-of-N, a mixture of
 * agents, planning search, a self-consistency vote, a prover-verifier game.
 * Nothing is fine-tuned and no model is swapped — the improvement is bought
 * with extra inference, spent only where it helps.
 *
 * It ships as a separate OpenAI-compatible proxy (`pip install optillm`) rather
 * than a library, because it pulls in torch and transformers for its local
 * inference server. So this module does three things:
 *
 *   1. decides whether a turn is worth the extra compute (`reasoning: low |
 *      medium | high`, off by default);
 *   2. starts and health-checks the proxy, handing it the account's own API key
 *      in its environment, so a request never routes through a key this app did
 *      not give it;
 *   3. rewrites one request into the shape the proxy expects — `model` prefixed
 *      with the technique, which is how OptiLLM selects an approach.
 *
 * The point of prefixing the model name rather than setting a header: it works
 * against a proxy running with its default `auto` approach, needs no
 * configuration on the proxy, and keeps the request a plain OpenAI request.
 */

export type Reasoning = "off" | "low" | "medium" | "high";

export type OptillmConfig = {
  /** Where the proxy believes the real provider is. A key must accompany it. */
  baseUrl: string;
  apiKey: string;
  /** The account's provider, used only for the proxy's environment. */
  provider: string;
  /** The reasoning setting from the account. */
  reasoning: Reasoning;
};

/**
 * Which technique for which level.
 *
 * These are chosen for cost as much as for accuracy, because the bill is the
 * user's. Every step of a multi-step approach is a full priced call.
 *
 *  low    — `re2`: read the query twice. Charges two calls for one answer and
 *           catches the most common failure of a small model, which is
 *           answering a slightly different question than the one asked.
 *  medium — `plansearch&cot_reflection`: plan, then answer with reflection.
 *           Around five calls; the point where reasoning starts to pay.
 *  high   — `moa&bon&self_consistency`: a mixture of agents, best-of-N over the
 *           drafts, then a majority vote across independent attempts. Measured
 *           at eleven upstream calls including the direct first draft — ten
 *           times a plain reply. Reserved for high reasoning for that reason.
 *
 * The `&` matters. In OptiLLM `|` runs approaches in parallel and returns a
 * list — several answers, one per branch — which is not an answer a chat turn
 * can use. `&` feeds one approach into the next and yields a single reply.
 *
 * `off` means the request goes straight to the provider, untouched.
 */
const APPROACH: Record<Exclude<Reasoning, "off">, string> = {
  low: "re2",
  medium: "plansearch&cot_reflection",
  high: "moa&bon&self_consistency",
};

/** A one-line explanation the chat can show, because borrowed time costs money. */
const WHY: Record<Exclude<Reasoning, "off">, string> = {
  low: "reads the question twice before answering",
  medium: "plans, then answers with reflection",
  high: "drafts several answers and keeps the best",
};

export function approachFor(reasoning: Reasoning): string | null {
  return reasoning === "off" ? null : APPROACH[reasoning];
}

export function whyFor(reasoning: Reasoning): string {
  return reasoning === "off" ? "" : WHY[reasoning];
}

/** True when this turn should be routed through the proxy at all. */
export function shouldOptimise(reasoning: Reasoning, hasKey: boolean): boolean {
  return reasoning !== "off" && hasKey;
}

/**
 * The model name the proxy is asked for.
 *
 * OptiLLM reads a technique from the prefix of the model name, so `moa-gpt-4o`
 * means "mixture of agents over gpt-4o". A name that already carries a prefix is
 * left alone: prefixing twice would ask for a technique called `re2-re2-gpt-4o`,
 * which the proxy would pass through as a model name and fail to resolve.
 */
export function optimisedModel(model: string, reasoning: Reasoning): string {
  const approach = approachFor(reasoning);
  if (!approach) return model;
  const first = model.split("-")[0];
  const known = new Set(["re2", "moa", "bon", "mcts", "cepo", "mars", "z3", "rstar", "leap", "rto", "pvg", "plansearch", "self_consistency", "cot_reflection"]);
  if (known.has(first)) return model;
  // `|` and `&` mean parallel and sequential in OptiLLM, and both are legal in
  // a model name, so the compound approaches go through unchanged.
  return `${approach}-${model}`;
}

/** The environment the proxy is started with, carrying the account's key. */
export function proxyEnv(cfg: OptillmConfig): Record<string, string> {
  // OptiLLM picks its downstream client from whichever key is present. The
  // account's own key goes in under the names it recognises; anything else is
  // left out rather than filled with a placeholder that could silently bill the
  // proxy's own account instead of the user's.
  // Deliberately NOT set: OPTILLM_API_KEY. In OptiLLM that variable does two
  // things, and both are wrong here — it enables a bearer-token gate that would
  // reject the account's own key, and, worse, it makes the proxy construct its
  // local inference client instead of a client for the real provider, so every
  // request would silently go to a model nobody selected.
  //
  // OPENAI_API_KEY is set because it is what makes the proxy build an
  // OpenAI-shaped client pointed at OPENAI_BASE_URL. Without it OptiLLM falls
  // back to a LiteLLM wrapper that needs vendor-prefixed model names, and a
  // plain model name then fails.
  const env: Record<string, string> = {
    OPENAI_API_KEY: cfg.apiKey,
    OPENAI_BASE_URL: cfg.baseUrl,
  };
  switch (cfg.provider) {
    case "anthropic":
      env.ANTHROPIC_API_KEY = cfg.apiKey;
      // Keep OPENAI_API_KEY too: the proxy only takes its OpenAI-client branch,
      // and LiteLLM reads the Anthropic key for `anthropic/…` model names. A
      // bare `claude-…` name is prefixed by the caller instead.
      break;
    case "google":
      env.GEMINI_API_KEY = cfg.apiKey;
      break;
    case "groq":
      env.GROQ_API_KEY = cfg.apiKey;
      break;
    case "cerebras":
      env.CEREBRAS_API_KEY = cfg.apiKey;
      break;
    case "openrouter":
      env.OPENROUTER_API_KEY = cfg.apiKey;
      // OpenRouter is OpenAI-shaped, and OptiLLM's litellm path wants the
      // vendor prefix on an openrouter model, so the generic key stays too.
      env.OPENAI_API_KEY = cfg.apiKey;
      env.OPENAI_BASE_URL = cfg.baseUrl;
      break;
    default:
      break;
  }
  return env;
}

/**
 * Work out where the proxy is, if it is anywhere.
 *
 * A user can point at one they already run (OptiLLM on a home server, or the
 * Docker image on a VPS). Otherwise this app starts one itself where it can.
 */
export function proxyUrlFrom(override: string | null | undefined): string {
  const trimmed = (override ?? "").trim();
  if (trimmed) return trimmed.replace(/\/+$/, "");
  return "http://127.0.0.1:8000/v1";
}

export type Health = { up: boolean; detail: string };

/**
 * Is the proxy answering?
 *
 * It has a dedicated `/health` route. Do not probe `/v1/models`: that path is
 * forwarded upstream and answered 500 against a perfectly healthy proxy, which
 * would read as "down" and quietly disable the feature.
 */
export async function checkHealth(url: string, signal?: AbortSignal, timeoutMs = 2500): Promise<Health> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // `url` is the caller-facing /v1 root; /health lives one level above it.
    const root = url.replace(/\/v1$/, "");
    const res = await fetch(`${root}/health`, {
      // No auth header: the proxy runs without OPTILLM_API_KEY precisely so the
      // account's own key is the one that flows through to the provider.
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) return { up: false, detail: `the proxy answered ${res.status}` };
    return { up: true, detail: "ready" };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "no answer";
    return { up: false, detail: /abort/i.test(reason) ? "timed out" : reason.slice(0, 120) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
