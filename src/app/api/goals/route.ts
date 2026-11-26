import { handleError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { goalInputError } from "@/lib/goal-validation";
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
    const error = goalInputError(body, true);
    if (error) return Response.json({ error }, { status: 400 });
    if (body.botId && !await getBot(user.id, body.botId)) return Response.json({ error: "Bot not found." }, { status: 404 });
    const goal = await addGoal(user.id, { title: body.title!.trim(), detail: body.detail, botId: body.botId || null, dueAt: body.due ?? null });
    return Response.json(goal, NO_STORE);
  } catch (error) {
    return handleError(error);
  }
}
