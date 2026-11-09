import type { ReactNode } from "react";
import { cookies } from "next/headers";
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
  const [bots, settings, jar] = await Promise.all([listBots(user.id), getSettings(user.id), cookies()]);
  return (
    <AppProvider user={user} bots={bots} settings={publicSettings(settings)}>
      <AppShell initialCollapsed={jar.get(SIDEBAR_COOKIE)?.value === "collapsed"}>{children}</AppShell>
    </AppProvider>
  );
}
