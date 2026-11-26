import "server-only";
import { isUuid } from "./ids";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { goals } from "@/db/schema";

export type GoalStatus = "open" | "doing" | "done";

export type GoalDTO = {
  id: string;
  title: string;
  detail: string;
  status: GoalStatus;
  botId: string | null;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
};

const statusOf = (value: string): GoalStatus => (value === "doing" || value === "done" ? value : "open");

function toDTO(row: typeof goals.$inferSelect): GoalDTO {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    status: statusOf(row.status),
    botId: row.botId,
    dueAt: row.dueAt?.toISOString() ?? null,
    doneAt: row.doneAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The whole goal list for one person, newest first within each state. Open and
 * in-progress goals come before finished ones so the list reads as work left.
 */
export async function listGoals(userId: string, options: { includeDone?: boolean } = {}): Promise<GoalDTO[]> {
  const rows = await db
    .select()
    .from(goals)
    .where(eq(goals.userId, userId))
    .orderBy(asc(sql`case ${goals.status} when 'doing' then 0 when 'open' then 1 else 2 end`), asc(goals.createdAt));
  return rows.map(toDTO).filter((goal) => options.includeDone !== false || goal.status !== "done");
}

export async function addGoal(
  userId: string,
  input: { title: string; detail?: string; botId?: string | null; dueAt?: string | null },
): Promise<GoalDTO> {
  const [row] = await db
    .insert(goals)
    .values({
      userId,
      botId: input.botId ?? null,
      title: input.title.trim().slice(0, 300),
      detail: (input.detail ?? "").trim().slice(0, 4000),
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    })
    .returning();
  return toDTO(row);
}

export async function updateGoal(
  userId: string,
  id: string,
  patch: { title?: string; detail?: string; status?: GoalStatus; dueAt?: string | null },
): Promise<GoalDTO | null> {
  if (!isUuid(id)) return null;
  const values: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = patch.title.trim().slice(0, 300);
  if (patch.detail !== undefined) values.detail = patch.detail.trim().slice(0, 4000);
  if (patch.dueAt !== undefined) values.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
  if (patch.status) {
    values.status = patch.status;
    values.doneAt = patch.status === "done" ? new Date() : null;
  }
  const [row] = await db
    .update(goals)
    .set(values)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning();
  return row ? toDTO(row) : null;
}

export async function deleteGoal(userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .delete(goals)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning({ id: goals.id });
  return rows.length > 0;
}

/**
 * A compact form for the model's system prompt. Every Bot sees the same list —
 * that is what makes a goal set with one Bot known to all of them.
 */
export function goalsForPrompt(list: GoalDTO[]): string {
  const live = list.filter((goal) => goal.status !== "done").slice(0, 25);
  if (!live.length) return "";
  return live
    .map((goal) => `- [${goal.status}] ${goal.title}${goal.detail ? ` — ${goal.detail.slice(0, 160)}` : ""}${goal.dueAt ? ` (due ${goal.dueAt.slice(0, 10)})` : ""}`)
    .join("\n");
}
