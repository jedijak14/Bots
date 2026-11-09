import { handleError, requireUser } from "@/lib/auth";
import { listModels, type ProviderId } from "@/lib/ai/providers";
import { aiConfigFrom, getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; models: string[] }>();

export async function GET() {
  try {
    const user = await requireUser();
    const cfg = aiConfigFrom(await getSettings(user.id));
    if (!cfg) return Response.json({ models: [], provider: null });
    const ck = `${user.id}:${cfg.provider}:${cfg.baseUrl}:${cfg.apiKey.slice(-6)}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < 5 * 60_000) return Response.json({ models: hit.models, provider: cfg.provider });
    let models: string[] = [];
    try {
      models = await listModels(cfg.provider as ProviderId, cfg.apiKey, cfg.baseUrl);
    } catch {
      /* fall through with empty list */
    }
    if (models.length) cache.set(ck, { at: Date.now(), models });
    return Response.json({ models, provider: cfg.provider });
  } catch (e) {
    return handleError(e);
  }
}
