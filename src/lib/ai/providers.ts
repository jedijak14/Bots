export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "groq"
  | "xai"
  | "deepseek"
  | "mistral"
  | "together"
  | "fireworks"
  | "cerebras"
  | "nvidia"
  | "sambanova"
  | "hyperbolic"
  | "perplexity"
  | "moonshot"
  | "zhipu"
  | "qwen"
  | "custom";

export type ProviderInfo = {
  label: string;
  baseUrl: string;
  kind: "openai" | "anthropic";
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", kind: "openai" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", kind: "anthropic" },
  google: {
    label: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    kind: "openai",
  },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", kind: "openai" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", kind: "openai" },
  xai: { label: "xAI", baseUrl: "https://api.x.ai/v1", kind: "openai" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", kind: "openai" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", kind: "openai" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", kind: "openai" },
  fireworks: { label: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", kind: "openai" },
  cerebras: { label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", kind: "openai" },
  // NIM is the one most often missed: the key looks like `nvapi-…` and the
  // endpoint is an OpenAI shape, so a plain `sk-` guess never finds it.
  nvidia: { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", kind: "openai" },
  sambanova: { label: "SambaNova", baseUrl: "https://api.sambanova.ai/v1", kind: "openai" },
  hyperbolic: { label: "Hyperbolic", baseUrl: "https://api.hyperbolic.xyz/v1", kind: "openai" },
  perplexity: { label: "Perplexity", baseUrl: "https://api.perplexity.ai", kind: "openai" },
  moonshot: { label: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.ai/v1", kind: "openai" },
  zhipu: { label: "Z.ai (GLM)", baseUrl: "https://api.z.ai/api/paas/v4", kind: "openai" },
  qwen: { label: "Alibaba Qwen", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", kind: "openai" },
  custom: { label: "OpenAI-compatible", baseUrl: "", kind: "openai" },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProvider(v: string): v is ProviderId {
  return v in PROVIDERS;
}

export class KeyRejectedError extends Error {}

export function guessByPrefix(key: string): ProviderId | null {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("AIza")) return "google";
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("xai-")) return "xai";
  if (k.startsWith("csk-")) return "cerebras";
  if (k.startsWith("fw_")) return "fireworks";
  if (k.startsWith("tgp_")) return "together";
  if (k.startsWith("sk-proj-") || k.startsWith("sk-svcacct-") || k.startsWith("sk-admin-")) return "openai";
  // Added because a prefix is the cheapest possible detection and every one of
  // these is unambiguous. A key that matches none of them still gets probed, so
  // this table being incomplete is a latency cost, never a failure.
  if (k.startsWith("nvapi-")) return "nvidia";
  if (k.startsWith("pplx-")) return "perplexity";
  if (k.startsWith("sess-") || k.startsWith("sk-dashscope-")) return "qwen";
  if (k.startsWith("moonshot-")) return "moonshot";
  return null;
}

/**
 * Which providers a key of this shape could belong to, best first.
 *
 * Used when the prefix table has no answer and the app has to ask the provider
 * itself. Plain `sk-` is shared by OpenAI, DeepSeek, Moonshot and several
 * gateways, so it is the one shape that genuinely needs a network probe.
 */
export function candidatesForKey(key: string): ProviderId[] {
  const k = key.trim();
  if (k.startsWith("nvapi-")) return ["nvidia"];
  if (k.startsWith("sk-ant-")) return ["anthropic"];
  if (k.startsWith("sk-or-")) return ["openrouter"];
  if (k.startsWith("AIza")) return ["google"];
  if (k.startsWith("gsk_")) return ["groq"];
  if (k.startsWith("xai-")) return ["xai"];
  if (k.startsWith("csk-")) return ["cerebras"];
  if (k.startsWith("fw_")) return ["fireworks"];
  if (k.startsWith("tgp_")) return ["together"];
  if (k.startsWith("pplx-")) return ["perplexity"];
  if (k.startsWith("sess-") || k.startsWith("sk-dashscope-")) return ["qwen"];
  if (k.startsWith("sk-proj-") || k.startsWith("sk-svcacct-") || k.startsWith("sk-admin-")) return ["openai"];
  const guess = guessByPrefix(k);
  if (guess) return [guess];
  // Order matters: the most common first, since Promise.any takes the first
  // success and every loser is an aborted request the user paid latency for.
  return k.startsWith("sk-")
    ? ["openai", "deepseek", "moonshot", "mistral", "nvidia", "openrouter"]
    : ["openai", "anthropic", "deepseek", "nvidia", "groq", "openrouter", "mistral"];
}

const NON_CHAT =
  /embed|whisper|tts|dall-e|moderation|transcribe|realtime|audio|image|davinci|babbage|rerank|guard|speech|imagen|veo|aqa|omni-moderation|sora|computer-use|search-preview|instruct-0914/i;

export function resolveBase(provider: ProviderId, baseUrl?: string | null): string {
  const base = (baseUrl && baseUrl.trim()) || PROVIDERS[provider].baseUrl;
  return base.replace(/\/+$/, "");
}

function headersFor(provider: ProviderId, key: string): Record<string, string> {
  if (PROVIDERS[provider].kind === "anthropic") {
    return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  }
  return { Authorization: `Bearer ${key}` };
}

export async function listModels(
  provider: ProviderId,
  key: string,
  baseUrl?: string | null,
  timeoutMs = 10_000,
): Promise<string[]> {
  const base = resolveBase(provider, baseUrl);
  if (!base) throw new Error("A base URL is required for OpenAI-compatible providers.");
  const url = PROVIDERS[provider].kind === "anthropic" ? `${base}/models?limit=100` : `${base}/models`;
  const res = await fetch(url, {
    headers: headersFor(provider, key),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new KeyRejectedError(`${PROVIDERS[provider].label} rejected this key.`);
  }
  if (!res.ok) throw new Error(`${PROVIDERS[provider].label} returned ${res.status} when listing models.`);
  const json = (await res.json()) as { data?: { id?: string; name?: string }[]; models?: { name?: string }[] };
  const raw = (json.data ?? []).map((m) => m.id ?? m.name ?? "").filter(Boolean);
  const ids = (raw.length ? raw : (json.models ?? []).map((m) => m.name ?? "").filter(Boolean))
    .map((id) => id.replace(/^models\//, ""))
    .filter((id) => !NON_CHAT.test(id));
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

export type Detection = { provider: ProviderId; models: string[] };

export async function detectProvider(key: string, baseUrl?: string | null): Promise<Detection> {
  const k = key.trim();
  if (baseUrl && baseUrl.trim()) {
    // A base URL override means "OpenAI-compatible", unless it points at Anthropic.
    const provider: ProviderId = /anthropic\.com/i.test(baseUrl) ? "anthropic" : "custom";
    try {
      return { provider, models: await listModels(provider, k, baseUrl) };
    } catch (e) {
      if (e instanceof KeyRejectedError) throw e;
      return { provider, models: [] }; // some compatible servers don't expose /models
    }
  }
  const guess = guessByPrefix(k);
  if (guess) return { provider: guess, models: await listModels(guess, k) };

  // The probe order lives in one place, `candidatesForKey`, so the prefix table
  // and the network probe can never disagree about which vendor a key is for.
  const candidates = candidatesForKey(k);
  try {
    return await Promise.any(
      candidates.map(async (p) => ({ provider: p, models: await listModels(p, k, null, 7000) })),
    );
  } catch {
    throw new Error(
      "Couldn't recognise this key automatically. Choose your provider manually, or use “OpenAI-compatible” with a base URL.",
    );
  }
}

export function pickDefaultModel(provider: ProviderId, models: string[]): string | null {
  if (!models.length) return null;
  const prefs: Partial<Record<ProviderId, RegExp[]>> = {
    openai: [/^gpt-4o-mini$/, /^gpt-4\.1-mini$/, /^gpt-4o$/, /^gpt-/],
    anthropic: [/sonnet/, /haiku/, /./],
    google: [/^gemini-2\.5-flash$/, /gemini.*flash/, /^gemini/],
    groq: [/llama-3\.3-70b/, /llama/],
    xai: [/^grok-/],
    deepseek: [/chat/],
    openrouter: [/^openai\/gpt-4o-mini$/, /^anthropic\/claude.*sonnet/, /./],
  };
  for (const re of prefs[provider] ?? []) {
    const hit = models.find((m) => re.test(m));
    if (hit) return hit;
  }
  return models[0];
}
