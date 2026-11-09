import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listBots } from "@/lib/bots";
import { getSettings, publicSettings } from "@/lib/settings";
import { AppProvider } from "@/components/AppProvider";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [bots, settings] = await Promise.all([listBots(user.id), getSettings(user.id)]);
  return (
    <AppProvider user={user} bots={bots} settings={publicSettings(settings)}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
