import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { decrypt, encrypt, keyHint } from "@/lib/crypto";
import {
  detectProvider,
  isProvider,
  KeyRejectedError,
  listModels,
  pickDefaultModel,
  PROVIDERS,
  type ProviderId,
} from "@/lib/ai/providers";
import { getSettings, publicSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Save + verify the AI key. Provider is auto-detected unless `mode` names one.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const current = await getSettings(user.id);
    const b = (await req.json().catch(() => ({}))) as {
      apiKey?: string;
      mode?: string;
      baseUrl?: string;
      model?: string;
    };
    const typed = String(b.apiKey ?? "").trim();
    const apiKey = typed || decrypt(current.aiKeyEnc) || "";
    if (!apiKey) throw new HttpError(400, "Paste your API key first.");
    const mode = b.mode && (b.mode === "auto" || isProvider(b.mode)) ? b.mode : "auto";
    let baseUrl = String(b.baseUrl ?? "").trim();
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new HttpError(400, "Base URL must start with http:// or https://");
    baseUrl = baseUrl.replace(/\/+$/, "");
    if (mode === "custom" && !baseUrl) throw new HttpError(400, "OpenAI-compatible providers need a base URL.");

    let provider: ProviderId;
    let models: string[] = [];
    try {
      if (mode === "auto") {
        ({ provider, models } = await detectProvider(apiKey, baseUrl || null));
      } else {
        provider = mode;
        try {
          models = await listModels(provider, apiKey, baseUrl || null);
        } catch (e) {
          if (e instanceof KeyRejectedError || mode !== "custom") throw e;
        }
      }
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Couldn't verify this key.");
    }

    let model = String(b.model ?? "").trim() || current.defaultModel || "";
    if (models.length && !models.includes(model)) model = pickDefaultModel(provider, models) ?? "";

    await db
      .update(userSettings)
      .set({
        aiKeyEnc: typed ? encrypt(apiKey) : current.aiKeyEnc,
        aiKeyHint: typed ? keyHint(apiKey) : current.aiKeyHint,
        aiProvider: provider,
        aiProviderMode: mode,
        aiBaseUrl: baseUrl || null,
        defaultModel: model || null,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, user.id));

    return Response.json({
      settings: publicSettings(await getSettings(user.id)),
      models,
      detected: PROVIDERS[provider].label,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await db
      .update(userSettings)
      .set({
        aiKeyEnc: null,
        aiKeyHint: null,
        aiProvider: null,
        aiProviderMode: "auto",
        aiBaseUrl: null,
        defaultModel: null,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, user.id));
    return Response.json({ settings: publicSettings(await getSettings(user.id)) });
  } catch (e) {
    return handleError(e);
  }
}
