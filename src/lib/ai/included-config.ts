/** Deployment-wide inference is opt-in: there is no bundled model or hidden service. */
export function includedConfig(env: Record<string, string | undefined>) {
  const base = env.INCLUDED_AI_BASE_URL?.trim();
  const model = env.INCLUDED_AI_MODEL?.trim();
  if (!base || !model || model.length > 200) return null;
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return { included: true as const, provider: 'custom' as const, baseUrl: url.toString().replace(/\/+$/, ''), defaultModel: model, apiKey: env.INCLUDED_AI_API_KEY?.trim() || 'sk-local' };
  } catch { return null; }
}
