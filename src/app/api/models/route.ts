import { handleError, requireUser } from "@/lib/auth";
import { listModels, KeyRejectedError, type ProviderId } from "@/lib/ai/providers";
import { isFreeCloudProvider } from "@/lib/ai/free-cloud";
import { aiConfigFrom, getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; models: string[] }>();

export async function GET() {
  try {
    const user = await requireUser();
    const cfg = aiConfigFrom(await getSettings(user.id));
    if (!cfg) return Response.json({ models: [], provider: null });
    // The deployment only promises and pays for its configured model.
    if (cfg.included || isFreeCloudProvider(cfg.provider)) return Response.json({ models: [cfg.defaultModel], provider: cfg.provider });
    const ck = `${user.id}:${cfg.provider}:${cfg.baseUrl}:${cfg.apiKey.slice(-6)}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < 5 * 60_000) return Response.json({ models: hit.models, provider: cfg.provider });
    let models: string[] = [];
    try {
      models = await listModels(cfg.provider as ProviderId, cfg.apiKey, cfg.baseUrl);
    } catch (error) {
      if (error instanceof KeyRejectedError) return Response.json({ models: [], provider: cfg.provider, authError: error.message });
      /* Some providers do not support listing models. */
    }
    if (models.length) cache.set(ck, { at: Date.now(), models });
    return Response.json({ models, provider: cfg.provider });
  } catch (e) {
    return handleError(e);
  }
}
