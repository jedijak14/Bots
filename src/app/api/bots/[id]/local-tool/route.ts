import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { skills } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { readLimitedJson } from "@/lib/limited-json";
import { buildToolset } from "@/lib/agent-tools";
import { validLocalToolCall } from "@/lib/ai/local-tools";

/** Untrusted browser output may only invoke the bounded read-only subset. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await ctx.params;
  const bot = await getBot(user.id, id);
  if (!bot) return Response.json({ error: "Bot not found." }, { status: 404 });
  const parsed = await readLimitedJson(req, 48_000);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const call = parsed.value;
  if (!validLocalToolCall(call)) return Response.json({ error: "Tool or arguments are not allowed in Bots Local." }, { status: 400 });
  const enabled = await db.select({ allowedTools: skills.allowedTools }).from(skills).where(and(eq(skills.userId, user.id), eq(skills.enabled, true), or(isNull(skills.botId), eq(skills.botId, bot.id))));
  const allowedTools = enabled.length ? [...new Set(enabled.flatMap(s => s.allowedTools ?? []))] : undefined;
  if (allowedTools && !allowedTools.includes(call.tool)) return Response.json({ error: "This tool is not allowed by the Bot's enabled skills." }, { status: 403 });
  let stepOk = false;
  const set = buildToolset({ userId: user.id, bot: { id: bot.id, sandboxId: bot.sandboxId }, e2bKey: null, wantShots: false, signal: req.signal, allowedTools, turnId: crypto.randomUUID(), ev: { onStepStart: () => {}, onStepEnd: s => { stepOk = s.ok; }, onShot: () => {}, onChoices: () => {} } });
  const result = await set.run(call.tool, call.args, crypto.randomUUID());
  if (!stepOk) return Response.json({ error: result.output.slice(0, 2000) }, { status: 400 });
  return Response.json({ tool: call.tool, output: result.output.slice(0, 5000) });
}
