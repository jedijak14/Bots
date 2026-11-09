import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bots, messages, type ChoicesRecord, type StepRecord } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { runAgent, type Hist } from "@/lib/ai/llm";
import { buildToolset } from "@/lib/agent-tools";
import { aiConfigFrom, e2bKeyFrom, getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function systemPrompt(name: string, instructions: string, hasComputer: boolean): string {
  const now = new Date().toUTCString();
  return [
    `You are ${name}, a personal AI bot that lives in a chat app. Be helpful, clear, and concise. Use Markdown when it helps (lists, code blocks).`,
    instructions.trim() ? `Your owner gave you these instructions — follow them:\n${instructions.trim()}` : "",
    `Current date/time (UTC): ${now}.`,
    "When you need the user to choose between a few directions, call the ask_user tool with 2-5 short options instead of listing them in prose. You can use get_current_time for reliable timezone-aware dates and times.",
    hasComputer
      ? "You have your own Linux desktop computer (Ubuntu + Chrome) with tools: run_command, web_search, fetch_page, open_url, write_file, read_file, click, type_text, press_key. Use it to research, browse, run code and create files in /home/user. The user can watch it live in the Computer panel, which also has a Files tab listing what you create and a Preview tab that shows web pages you build (save them as .html files). After using tools, summarise what you found or did."
      : "You do not currently have a computer. If asked to browse the web or run code, explain that the user can connect an E2B API key in Settings to give you one.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await ctx.params;
  const bot = await getBot(user.id, id);
  if (!bot) return Response.json({ error: "Bot not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { content?: string; wantShots?: boolean };
  const content = String(body.content ?? "").trim();
  if (!content) return Response.json({ error: "Say something first." }, { status: 400 });
  if (content.length > 60_000) return Response.json({ error: "That message is too long." }, { status: 400 });

  const settings = await getSettings(user.id);
  const cfg = aiConfigFrom(settings);
  if (!cfg) {
    return Response.json(
      { error: "Add your AI API key in Settings to start chatting.", code: "no_key" },
      { status: 400 },
    );
  }
  const model = bot.model || cfg.defaultModel;
  if (!model) {
    return Response.json({ error: "Pick a model in Settings or from the model menu.", code: "no_model" }, { status: 400 });
  }
  const e2bKey = e2bKeyFrom(settings);

  const [userMsg] = await db.insert(messages).values({ botId: id, userId: user.id, role: "user", content }).returning();

  const recent = await db
    .select()
    .from(messages)
    .where(and(eq(messages.botId, id), eq(messages.userId, user.id)))
    .orderBy(desc(messages.createdAt))
    .limit(40);
  const history: Hist[] = recent
    .reverse()
    .map((m) => {
      let c = m.content;
      if (m.role === "assistant") {
        if (m.steps?.length) c += `\n\n(Actions taken: ${m.steps.map((s) => s.label).join("; ")})`;
        if (m.choices) c += `\n\n(You asked the user: "${m.choices.question}" with options: ${m.choices.options.join(" | ")})`;
      }
      return { role: m.role as "user" | "assistant", content: c.trim() };
    })
    .filter((m) => m.content);

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (o: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          closed = true;
        }
      };
      let text = "";
      const steps: StepRecord[] = [];
      let choices: ChoicesRecord | null = null;

      send({ t: "start", userMessage: { id: userMsg.id, createdAt: userMsg.createdAt.toISOString() } });

      const toolset = buildToolset({
        bot: { id: bot.id, sandboxId: bot.sandboxId },
        e2bKey,
        wantShots: !!body.wantShots,
        signal: ac.signal,
        ev: {
          onStepStart: (s) => send({ t: "step", ...s }),
          onStepEnd: (s) => {
            steps.push(s);
            send({ t: "step_done", ...s });
          },
          onShot: (data) => send({ t: "shot", data }),
          onChoices: (c) => {
            choices = c;
            send({ t: "choices", ...c });
          },
        },
      });

      try {
        await runAgent({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model,
          system: systemPrompt(bot.name, bot.instructions, !!e2bKey),
          history,
          tools: toolset.tools,
          signal: ac.signal,
          onText: (d) => {
            text += d;
            send({ t: "text", d });
          },
          runTool: toolset.run,
        });
      } catch (e) {
        if (!ac.signal.aborted) {
          send({ t: "error", message: e instanceof Error ? e.message : "The model request failed." });
        }
      }

      try {
        if (text.trim() || steps.length || choices) {
          const [saved] = await db
            .insert(messages)
            .values({
              botId: id,
              userId: user.id,
              role: "assistant",
              content: text.trim(),
              steps: steps.length ? steps : null,
              choices,
            })
            .returning();
          send({ t: "done", message: { id: saved.id, createdAt: saved.createdAt.toISOString() } });
        } else {
          send({ t: "done", message: null });
        }
        await db.update(bots).set({ updatedAt: new Date() }).where(eq(bots.id, id));
      } catch (e) {
        console.error(e);
        send({ t: "error", message: "Couldn't save the reply." });
      }
      closed = true;
      try {
        controller.close();
      } catch {}
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
