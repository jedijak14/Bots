import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bots, messages, skills } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const b = await db.select().from(bots).where(eq(bots.userId, user.id)).orderBy(asc(bots.createdAt));
    const m = await db.select().from(messages).where(eq(messages.userId, user.id)).orderBy(asc(messages.createdAt));
    const savedSkills = await db.select({ name: skills.name, instructions: skills.instructions }).from(skills).where(eq(skills.userId, user.id));
    const data = {
      exportedAt: new Date().toISOString(),
      email: user.email,
      skills: savedSkills,
      bots: b.map((bot) => ({
        name: bot.name,
        shape: bot.shape,
        color: bot.color,
        instructions: bot.instructions,
        messages: m
          .filter((x) => x.botId === bot.id)
          .map((x) => ({ role: x.role, content: x.content, choices: x.choices, steps: x.steps, archivedAt: x.archivedAt, at: x.createdAt })),
      })),
    };
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="bots-export.json"',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// Clear ALL conversations (keeps bots)
export async function DELETE() {
  try {
    const user = await requireUser();
    await db.delete(messages).where(eq(messages.userId, user.id));
    return Response.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
