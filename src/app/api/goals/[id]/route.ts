import { handleError, requireUser } from "@/lib/auth";
import { goalInputError } from "@/lib/goal-validation";
import { deleteGoal, updateGoal, type GoalStatus } from "@/lib/goals";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { title?: string; detail?: string; status?: GoalStatus; due?: string | null };
    const error = goalInputError(body, false);
    if (error) return Response.json({ error }, { status: 400 });
    const goal = await updateGoal(user.id, id, { title: body.title, detail: body.detail, status: body.status, dueAt: body.due });
    if (!goal) return Response.json({ error: "That goal is gone." }, { status: 404 });
    return Response.json(goal, NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const ok = await deleteGoal(user.id, id);
    if (!ok) return Response.json({ error: "That goal is gone." }, { status: 404 });
    return Response.json({ ok: true }, NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}
