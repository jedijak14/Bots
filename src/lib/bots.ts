import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bots, messages, type ChoicesRecord, type StepRecord } from "@/db/schema";
import { previewText } from "./preview";

export type BotDTO = {
  id: string;
  name: string;
  shape: string;
  color: string;
  instructions: string;
  model: string | null;
  preview: string;
  hasSandbox: boolean;
};

export type MessageDTO = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: StepRecord[] | null;
  choices: ChoicesRecord | null;
  createdAt: string;
};

export async function listBots(userId: string): Promise<BotDTO[]> {
  const rows = await db
    .select({
      bot: bots,
      // `${bots.id}` renders as a bare "id" here, which Postgres resolves to the
      // inner `messages.id` and never matches. The outer table must be named.
      preview: sql<string | null>`(select coalesce(nullif(left(m.content, 600), ''), m.choices->>'question') from ${messages} m where m.bot_id = ${bots}.id and m.archived_at is null order by m.created_at desc limit 1)`,
    })
    .from(bots)
    .where(eq(bots.userId, userId))
    .orderBy(asc(bots.createdAt));
  return rows.map(({ bot, preview }) => toBotDTO(bot, previewText(preview) || "New conversation"));
}

export function toBotDTO(bot: typeof bots.$inferSelect, preview: string): BotDTO {
  return {
    id: bot.id,
    name: bot.name,
    shape: bot.shape,
    color: bot.color,
    instructions: bot.instructions,
    model: bot.model,
    preview,
    hasSandbox: !!bot.sandboxId,
  };
}

export async function getBot(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db
    .select()
    .from(bots)
    .where(and(eq(bots.id, id), eq(bots.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMessages(userId: string, botId: string, limit = 500): Promise<MessageDTO[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.botId, botId), eq(messages.userId, userId), isNull(messages.archivedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse().map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    steps: m.steps ?? null,
    choices: m.choices ?? null,
    createdAt: m.createdAt.toISOString(),
  }));
}

export const greetingText = (name: string) =>
  `Hi, I'm ${name}. Glad to meet you. Tell me what you'd like help with, and I'll get set up for it.`;

/** The sidebar line for a conversation that only holds the greeting. */
export const greetingPreview = (name: string) => previewText(greetingText(name));

export async function insertGreeting(userId: string, botId: string, name: string) {
  await db.insert(messages).values({
    botId,
    userId,
    role: "assistant",
    content: greetingText(name),
    choices: {
      question: "What would you like me to help with first?",
      options: ["Research and information", "Planning and organization", "Writing and content", "Something else"],
    },
  });
}
