/** Explicit, anonymous cloud routes. Fixed hosts and models; no paid fallback. */
export const FREE_CLOUD_PROVIDER = "kilo-free" as const;
export const FREE_CLOUD_BASE_URL = "https://ai-gateway.kilo.ai/api/v1";
export const FREE_CLOUD_MODEL = "kilo-auto/free";
export const KILO_GEMMA_MODEL = "google/gemma-4-26b-a4b-it:free";
export const OVH_FREE_BASE_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1";
export const OVH_FREE_MODEL = "gpt-oss-20b";
export type FreeCloudProvider = "kilo-free" | "kilo-gemma-free" | "ovh-free";

export function isFreeCloudProvider(value: unknown): value is FreeCloudProvider {
  return value === "kilo-free" || value === "kilo-gemma-free" || value === "ovh-free";
}

export function anonymousFreeCloudConfig(provider: FreeCloudProvider = "kilo-free") {
  if (provider === "ovh-free") return { provider, apiKey: "", baseUrl: OVH_FREE_BASE_URL, defaultModel: OVH_FREE_MODEL };
  return { provider, apiKey: "", baseUrl: FREE_CLOUD_BASE_URL, defaultModel: provider === "kilo-gemma-free" ? KILO_GEMMA_MODEL : FREE_CLOUD_MODEL };
}
