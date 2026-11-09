import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { PROVIDERS, resolveBase, type ProviderId } from "@/lib/ai/providers";

export type SettingsRow = typeof userSettings.$inferSelect;

export async function getSettings(userId: string): Promise<SettingsRow> {
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const inserted = await db.insert(userSettings).values({ userId }).onConflictDoNothing().returning();
  if (inserted[0]) return inserted[0];
  return (await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1))[0];
}

export type AiConfig = { provider: ProviderId; apiKey: string; baseUrl: string; defaultModel: string | null };

export function aiConfigFrom(s: SettingsRow): AiConfig | null {
  const apiKey = decrypt(s.aiKeyEnc);
  if (!apiKey || !s.aiProvider) return null;
  const provider = s.aiProvider as ProviderId;
  if (!(provider in PROVIDERS)) return null;
  return { provider, apiKey, baseUrl: resolveBase(provider, s.aiBaseUrl), defaultModel: s.defaultModel };
}

export function e2bKeyFrom(s: SettingsRow): string | null {
  return decrypt(s.e2bKeyEnc);
}

/** Safe-to-send view of settings (no secrets). */
export function publicSettings(s: SettingsRow) {
  const provider = (s.aiProvider as ProviderId | null) ?? null;
  return {
    hasAiKey: !!s.aiKeyEnc,
    aiKeyHint: s.aiKeyHint,
    aiProvider: provider,
    aiProviderLabel: provider ? PROVIDERS[provider].label : null,
    aiProviderMode: s.aiProviderMode,
    aiBaseUrl: s.aiBaseUrl ?? "",
    defaultModel: s.defaultModel,
    hasE2bKey: !!s.e2bKeyEnc,
    e2bKeyHint: s.e2bKeyHint,
    followMouse: s.followMouse,
    animations: s.animations,
    voiceReplies: s.voiceReplies,
  };
}
export type PublicSettings = ReturnType<typeof publicSettings>;
