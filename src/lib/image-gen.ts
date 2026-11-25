import "server-only";
import { PROVIDERS, type ProviderId } from "./ai/providers";

/**
 * Image generation, on whatever provider the account already has.
 *
 * There is no single image endpoint across providers, so this tries the shapes
 * that exist, in order, and reports which one worked. Every attempt returns
 * bytes or a clear reason; nothing here invents an image when it failed.
 */

export type ImageRequest = {
  prompt: string;
  /** Square by default: most places these land are square or 4:3. */
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "512x512";
  /** Providers that understand it use this to vary the result. */
  negativePrompt?: string;
  seed?: number;
};

export type ImageResult =
  | { ok: true; data: Buffer; mime: string; via: string }
  | { ok: false; reason: string };

export type ImageConfig = {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  /** A model name the account set aside for images, when its provider needs one. */
  imageModel?: string | null;
};

/** Image models worth trying, by provider. First match wins. */
const IMAGE_MODELS: Partial<Record<ProviderId, string[]>> = {
  custom: [],
  openai: ["gpt-image-1", "dall-e-3"],
  google: ["imagen-4.0-generate-001", "imagen-3.0-generate-002"],
  together: ["black-forest-labs/FLUX.1-schnell", "black-forest-labs/FLUX.1-dev"],
  fireworks: ["accounts/fireworks/models/flux-1-schnell"],
  xai: ["grok-2-image-1212"],
  openrouter: ["google/gemini-2.5-flash-image-preview"],
};

/** A model the user explicitly named, tried before the defaults. */
export function imageModelsFor(provider: ProviderId, override?: string | null): string[] {
  const configured = (override ?? "").trim();
  const defaults = IMAGE_MODELS[provider] ?? [];
  return configured && !defaults.includes(configured) ? [configured, ...defaults] : defaults;
}

async function attempt(url: string, init: RequestInit, label: string, signal: AbortSignal): Promise<ImageResult> {
  try {
    const response = await fetch(url, { ...init, signal, cache: "no-store" });
    if (!response.ok) {
      let detail = "";
      try {
        const text = await response.text();
        detail = (JSON.parse(text)?.error?.message ?? text).slice(0, 200);
      } catch {
        /* the body was not JSON; the status is enough */
      }
      return { ok: false, reason: `${label} ${response.status}${detail ? `: ${detail}` : ""}` };
    }
    const type = response.headers.get("content-type") ?? "";
    // Some endpoints return the bytes directly, others wrap them in JSON.
    if (type.startsWith("image/")) {
      return { ok: true, data: Buffer.from(await response.arrayBuffer()), mime: type.split(";")[0], via: label };
    }
    const json = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      images?: Array<{ b64_json?: string; bytesBase64Encoded?: string; url?: string }>;
      predictions?: Array<{ bytesBase64Encoded?: string }>;
      artifacts?: Array<{ base64?: string }>;
    };
    const b64 =
      json.data?.[0]?.b64_json ??
      json.images?.[0]?.b64_json ??
      json.images?.[0]?.bytesBase64Encoded ??
      json.predictions?.[0]?.bytesBase64Encoded ??
      json.artifacts?.[0]?.base64;
    if (b64) return { ok: true, data: Buffer.from(b64, "base64"), mime: "image/png", via: label };
    const remote = json.data?.[0]?.url ?? json.images?.[0]?.url;
    if (remote) {
      const downloaded = await fetch(remote, { signal, cache: "no-store" });
      if (!downloaded.ok) return { ok: false, reason: `${label} returned an image URL that could not be fetched.` };
      return {
        ok: true,
        data: Buffer.from(await downloaded.arrayBuffer()),
        mime: (downloaded.headers.get("content-type") ?? "image/png").split(";")[0],
        via: label,
      };
    }
    return { ok: false, reason: `${label} returned no image data.` };
  } catch (error) {
    if (signal.aborted) return { ok: false, reason: "Cancelled." };
    return { ok: false, reason: `${label} failed: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}

/** Try each model in turn and keep the first real image. */
export async function generateImage(cfg: ImageConfig, req: ImageRequest, signal: AbortSignal, modelOverride?: string | null): Promise<ImageResult> {
  const models = imageModelsFor(cfg.provider, modelOverride ?? cfg.imageModel);
  if (!models.length) {
    return {
      ok: false,
      reason: `No image model is configured for ${PROVIDERS[cfg.provider].label}. Add one in Settings, or use the built-in SVG route (draw_asset), which needs no extra service.`,
    };
  }
  const size = req.size ?? "1024x1024";
  const reasons: string[] = [];

  for (const model of models) {
    const label = `${PROVIDERS[cfg.provider].label} · ${model}`;
    let result: ImageResult;

    if (cfg.provider === "google") {
      // Imagen uses its own predict endpoint, not the OpenAI-compatible one.
      result = await attempt(
        `${cfg.baseUrl.replace(/\/openai$/, "")}/models/${model}:predict?key=${encodeURIComponent(cfg.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: req.prompt }],
            parameters: { sampleCount: 1, aspectRatio: size === "1536x1024" ? "16:9" : size === "1024x1536" ? "9:16" : "1:1" },
          }),
        },
        label,
        signal,
      );
    } else {
      // The OpenAI-compatible shape: most providers use it or a close variant.
      result = await attempt(
        `${cfg.baseUrl}/images/generations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model,
            prompt: req.prompt,
            n: 1,
            size,
            ...(req.seed !== undefined ? { seed: req.seed } : {}),
            ...(cfg.provider === "openai" && model.startsWith("dall-e-3") ? { response_format: "b64_json" } : {}),
          }),
        },
        label,
        signal,
      );
    }

    if (result.ok) return result;
    reasons.push(result.reason);
    if (signal.aborted) break;
  }

  return {
    ok: false,
    reason: `No image came back. ${reasons.slice(0, 2).join(" · ")}. You can still produce an SVG with draw_asset — it needs no image service.`,
  };
}
