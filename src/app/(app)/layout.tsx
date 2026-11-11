import type { ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { privacySessions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { listBots } from "@/lib/bots";
import { getSettings, publicSettings } from "@/lib/settings";
import { AppProvider } from "@/components/AppProvider";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [bots, settings, activePrivacy] = await Promise.all([
    listBots(user.id),
    getSettings(user.id),
    db.select({ botId: privacySessions.botId }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1).then((rows) => rows[0] ?? null),
  ]);
  return (
    <AppProvider user={user} bots={bots} settings={publicSettings(settings)}>
      <AppShell initialPrivacyMode={!!activePrivacy} privacyBotId={activePrivacy?.botId ?? null}>{children}</AppShell>
    </AppProvider>
  );
}
