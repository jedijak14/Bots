import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { anonymousFreeCloudConfig, isFreeCloudProvider } from "@/lib/ai/free-cloud";
import { includedConfig } from "@/lib/ai/included-config";
import { isLocalBaseUrl, PROVIDERS, resolveBase, type ProviderId } from "@/lib/ai/providers";

export type SettingsRow = typeof userSettings.$inferSelect;

export async function getSettings(userId: string): Promise<SettingsRow> {
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const inserted = await db.insert(userSettings).values({ userId }).onConflictDoNothing().returning();
  if (inserted[0]) return inserted[0];
  return (await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1))[0];
}

export type AiConfig = {
  provider: ProviderId;
  included?: boolean;
  apiKey: string;
  baseUrl: string;
  defaultModel: string | null;
  imageModel?: string | null;
};


// Re-exported so callers of settings do not need a second import; defined in
// providers.ts because the settings dialog (a client component) needs it too
// and this module is server-only.
export { isLocalBaseUrl };

export function aiConfigFrom(s: SettingsRow): AiConfig | null {
  // A local server is usable with no key at all, so the key is not the thing
  // that decides whether this account is configured — the provider and a
  // reachable base URL are.
  if (isFreeCloudProvider(s.aiProvider)) return anonymousFreeCloudConfig(s.aiProvider);
  if (!s.aiProvider && !s.aiKeyEnc) return includedConfig(process.env);
  const apiKey = decrypt(s.aiKeyEnc) ?? (isLocalBaseUrl(s.aiBaseUrl) ? "sk-local" : null);
  if (!apiKey || !s.aiProvider) return null;
  const provider = s.aiProvider as ProviderId;
  if (!(provider in PROVIDERS)) return null;
  return { provider, apiKey, baseUrl: resolveBase(provider, s.aiBaseUrl), defaultModel: s.defaultModel, imageModel: s.imageModel };
}

export function e2bKeyFrom(s: SettingsRow): string | null {
  return decrypt(s.e2bKeyEnc);
}

/** Safe-to-send view of settings (no secrets). */
export function publicSettings(s: SettingsRow) {
  const provider = (s.aiProvider as ProviderId | null) ?? null;
  const included = !s.aiProvider && !s.aiKeyEnc ? includedConfig(process.env) : null;
  const freeCloud = isFreeCloudProvider(s.aiProvider);
  return {
    // Reported as true for a local server, because the question this answers is
    // "can my bots reply", and a keyless Ollama can.
    hasAiKey: freeCloud || !!included || !!s.aiKeyEnc || (!!s.aiProvider && isLocalBaseUrl(s.aiBaseUrl)),
    usingIncludedAi: !!included,
    usingFreeCloud: freeCloud,
    preferOrbitLocal: s.preferOrbitLocal,
    aiKeyHint: s.aiKeyHint,
    aiProvider: provider,
    aiProviderLabel: included ? "Included AI" : provider && provider in PROVIDERS ? PROVIDERS[provider].label : null,
    aiProviderMode: s.aiProviderMode,
    imageModel: s.imageModel,
    aiBaseUrl: s.aiBaseUrl ?? "",
    defaultModel: isFreeCloudProvider(s.aiProvider) ? anonymousFreeCloudConfig(s.aiProvider).defaultModel : included ? included.defaultModel : s.defaultModel,
    hasE2bKey: !!s.e2bKeyEnc,
    e2bKeyHint: s.e2bKeyHint,
    reasoning: (["low", "medium", "high"].includes(s.reasoning) ? s.reasoning : "off") as "off" | "low" | "medium" | "high",
    followMouse: s.followMouse,
    animations: s.animations,
    voiceReplies: s.voiceReplies,
    theme: (s.theme === "light" || s.theme === "system" ? s.theme : "dark") as "dark" | "light" | "system",
  };
}
export type PublicSettings = ReturnType<typeof publicSettings>;
