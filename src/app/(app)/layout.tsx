import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { privacySessions } from "@/db/schema";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listBots } from "@/lib/bots";
import { getSettings, publicSettings } from "@/lib/settings";
import { AppProvider } from "@/components/AppProvider";
import { SIDEBAR_COOKIE } from "@/lib/ui-state";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [bots, settings, jar, activePrivacy] = await Promise.all([
    listBots(user.id),
    getSettings(user.id),
    cookies(),
    db.select({ botId: privacySessions.botId }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1).then((rows) => rows[0] ?? null),
  ]);
  return (
    <AppProvider user={user} bots={bots} settings={publicSettings(settings)}>
      <AppShell initialCollapsed={jar.get(SIDEBAR_COOKIE)?.value === "collapsed"} initialPrivacyMode={!!activePrivacy} privacyBotId={activePrivacy?.botId ?? null}>{children}</AppShell>
    </AppProvider>
  );
}
