import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, privacySessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { readLimitedJson } from "@/lib/limited-json";

/** Persist a completed browser-generated exchange; never execute client-supplied tools. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!await getBot(user.id, id)) return Response.json({ error: "Bot not found." }, { status: 404 });
  const [privacy] = await db.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1);
  if (privacy) return Response.json({ error: "Privacy Mode is active." }, { status: 423 });
  const parsed = await readLimitedJson(req, 120_000);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : {};
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!prompt || prompt.length > 6000 || !answer || answer.length > 20000) return Response.json({ error: "Invalid local chat exchange." }, { status: 400 });
  const now = Date.now();
  const saved = await db.transaction(async (tx) => {
    // Match the main chat's lock: Privacy Mode and persistence must not race.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    const [active] = await tx.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1);
    if (active) return null;
    return tx.insert(messages).values([
      { userId: user.id, botId: id, role: "user", content: prompt, createdAt: new Date(now) },
      { userId: user.id, botId: id, role: "assistant", content: answer, createdAt: new Date(now + 1) },
    ]).returning({ id: messages.id, role: messages.role, createdAt: messages.createdAt });
  });
  if (!saved) return Response.json({ error: "Privacy Mode is active." }, { status: 423 });
  const format = (role: string) => {
    const item = saved.find(row => row.role === role)!;
    return { id: item.id, createdAt: item.createdAt.toISOString() };
  };
  return Response.json({ userMessage: format("user"), assistantMessage: format("assistant") });
}
