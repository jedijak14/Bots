import { and, desc, eq, gte, sql } from "drizzle-orm";
import { handleError, requireUser } from "@/lib/auth";
import { db } from "@/db";
import { artifacts, bots, goals, messages } from "@/db/schema";


export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * The morning brief.
 *
 * This is assembled from what the app already knows — open goals, what each Bot
 * was last working on, work saved recently — rather than by asking a model,
 * because a brief that appears instantly is the whole point of one. It costs
 * three small queries and no tokens.
 */
export type Brief = {
  greeting: string;
  /** One line summarising the day. */
  headline: string;
  openGoals: { id: string; title: string; status: string; dueAt: string | null }[];
  dueToday: number;
  overdue: number;
  /** What each Bot was last doing, newest first. */
  working: { botId: string; botName: string; shape: string; color: string; preview: string | null; at: string | null }[];
  /** Work saved in the last seven days. */
  recent: { id: string; title: string; kind: string; at: string }[];
};

function partOfDay(hour: number) {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export async function GET() {
  try {
    const user = await requireUser();

    const now = new Date();
    const greeting = `${partOfDay(now.getHours())}${user.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}`;

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [openRows, workingRows, botRows, recentRows] = await Promise.all([
      db
        .select({ id: goals.id, title: goals.title, status: goals.status, dueAt: goals.dueAt })
        .from(goals)
        .where(and(eq(goals.userId, user.id), sql`${goals.status} <> 'done'`))
        .orderBy(desc(goals.createdAt))
        .limit(50),
      // The last message per Bot, which is what the gallery shows as its preview.
      db
        .select({
          botId: messages.botId,
          content: messages.content,
          createdAt: messages.createdAt,
          role: messages.role,
        })
        .from(messages)
        .where(eq(messages.userId, user.id))
        .orderBy(desc(messages.createdAt))
        .limit(120),
      db.select({ id: bots.id, name: bots.name, shape: bots.shape, color: bots.color }).from(bots).where(eq(bots.userId, user.id)),
      db
        .select({ id: artifacts.id, title: artifacts.title, kind: artifacts.kind, createdAt: artifacts.createdAt })
        .from(artifacts)
        .where(and(eq(artifacts.userId, user.id), gte(artifacts.createdAt, weekAgo)))
        .orderBy(desc(artifacts.createdAt))
        .limit(12),
    ]);

    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    let dueToday = 0;
    let overdue = 0;
    for (const goal of openRows) {
      if (!goal.dueAt) continue;
      const due = new Date(goal.dueAt);
      if (due < now) overdue += 1;
      else if (due <= endOfToday) dueToday += 1;
    }

    // Collapse the message window down to the newest row per Bot, then attach
    // the Bot's own name and face so the brief can draw it without another call.
    const byId = new Map(botRows.map((b) => [b.id, b]));
    const seen = new Set<string>();
    const working: Brief["working"] = [];
    for (const row of workingRows) {
      if (seen.has(row.botId)) continue;
      const bot = byId.get(row.botId);
      if (!bot) continue;
      seen.add(row.botId);
      working.push({
        botId: row.botId,
        botName: bot.name,
        shape: bot.shape,
        color: bot.color,
        preview: row.content.replace(/\s+/g, " ").trim().slice(0, 90) || null,
        at: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      });
    }

    const bits: string[] = [];
    if (overdue) bits.push(`${overdue} ${overdue === 1 ? "goal is" : "goals are"} overdue`);
    if (dueToday) bits.push(`${dueToday} due today`);
    if (!bits.length && openRows.length) bits.push(`${openRows.length} ${openRows.length === 1 ? "goal" : "goals"} in play`);
    if (recentRows.length) bits.push(`${recentRows.length} ${recentRows.length === 1 ? "thing" : "things"} saved this week`);

    const body: Brief = {
      greeting,
      headline: bits.length ? `${bits.join(" · ")}.` : "Nothing outstanding — a clean slate.",
      openGoals: openRows.slice(0, 5).map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        dueAt: g.dueAt ? new Date(g.dueAt).toISOString() : null,
      })),
      dueToday,
      overdue,
      working: working.slice(0, 4),
      recent: recentRows.slice(0, 4).map((a) => ({ id: a.id, title: a.title, kind: a.kind, at: new Date(a.createdAt).toISOString() })),
    };

    return Response.json(body, NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}
