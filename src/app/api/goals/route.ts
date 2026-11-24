import { handleError, requireUser } from "@/lib/auth";
import { addGoal, listGoals } from "@/lib/goals";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await listGoals(user.id), NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { title?: string; detail?: string; botId?: string; due?: string };
    const title = String(body.title ?? "").trim();
    if (!title) return Response.json({ error: "A goal needs a title." }, { status: 400 });
    const goal = await addGoal(user.id, { title, detail: body.detail, botId: body.botId ?? null, dueAt: body.due ?? null });
    return Response.json(goal, NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}
