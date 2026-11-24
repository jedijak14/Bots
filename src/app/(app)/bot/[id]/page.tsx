import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { privacySessions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getBot, insertGreeting, listMessages } from "@/lib/bots";
import { ChatView } from "@/components/chat/ChatView";

export const dynamic = "force-dynamic";

/** Tab title follows the bot, the way a chat app should. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const bot = user ? await getBot(user.id, id) : null;
  if (!bot) return { title: "Bots" };
  return { title: bot.name };
}

export default async function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const bot = await getBot(user.id, id);
  // Silently teleporting to the gallery left people wondering whether they had
  // clicked the wrong bot. Say the Bot is gone and let them pick another.
  if (!bot) notFound();
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
