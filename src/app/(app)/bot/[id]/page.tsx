import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getBot, listMessages } from "@/lib/bots";
import { ChatView } from "@/components/chat/ChatView";

export const dynamic = "force-dynamic";

export default async function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const bot = await getBot(user.id, id);
  if (!bot) redirect("/");
  const messages = await listMessages(user.id, bot.id);
  // Clearing archives the first message, changing this key and remounting the
  // client with an empty conversation. Greetings are created only for new bots.
  return <ChatView key={`${bot.id}:${messages[0]?.id ?? ""}`} botId={bot.id} initialMessages={messages} />;
}
