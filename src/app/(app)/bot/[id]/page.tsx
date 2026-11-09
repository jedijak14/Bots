import { redirect } from "next/navigation";
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
  let messages = await listMessages(user.id, bot.id);
  if (!messages.length) {
    await insertGreeting(user.id, bot.id, bot.name);
    messages = await listMessages(user.id, bot.id);
  }
  return <ChatView key={bot.id} botId={bot.id} initialMessages={messages} />;
}
