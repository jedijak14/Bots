import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { privacySessions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getBot, insertGreeting, listMessages } from "@/lib/bots";
import { ChatView } from "@/components/chat/ChatView";

export const dynamic = "force-dynamic";

export default async function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const bot = await getBot(user.id, id);
  if (!bot) redirect("/");
  const [activePrivacy] = await db.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1);
  let messages = await listMessages(user.id, bot.id);
  if (!messages.length) {
    await insertGreeting(user.id, bot.id, bot.name);
    messages = await listMessages(user.id, bot.id);
  }
  // Keyed on the first message too, so clearing a conversation (which starts a
  // new one with a fresh greeting) remounts the chat on the next refresh.
  return <ChatView key={`${bot.id}:${messages[0]?.id ?? ""}`} botId={bot.id} initialMessages={messages} initialPrivacyMode={!!activePrivacy} />;
}
