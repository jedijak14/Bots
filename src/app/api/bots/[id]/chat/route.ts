import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { bots, conversationArchives, messages, privacySessions, skills, users, type ChoicesRecord, type StepRecord } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { runAgent, type Hist } from "@/lib/ai/llm";
import { fitHistory } from "@/lib/ai/history";
import { splitRequests, unansweredParts } from "@/lib/ai/requests";
import { buildToolset } from "@/lib/agent-tools";
import { packsFor, packsPrompt, toolsForPacks } from "@/lib/packs";
import { clearHelpers, helpersFor } from "@/lib/helpers";
import { aiConfigFrom, e2bKeyFrom, getSettings } from "@/lib/settings";
import { approachFor, optimisedModel, shouldOptimise, whyFor, type Reasoning } from "@/lib/ai/optillm";
import { ensureProxy } from "@/lib/ai/optillm-server";
import { goalsForPrompt, listGoals } from "@/lib/goals";

/**
 * The agent's underlying fetch throws a bare TypeError("fetch failed") when the
 * provider is unreachable (DNS, TLS, a blocked host, or a bad Base URL), and that
 * string is useless in the chat. Anything with a useful message of its own — an
 * HTTP status from the provider, a rate limit, a bad key — is passed through.
 */
function describeModelError(e: unknown): string {
  if (!(e instanceof Error)) return "The model request failed.";
  const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? "";
  if (e.name === "TypeError" && /fetch failed|network|terminated/i.test(e.message)) {
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) return "The AI provider's address couldn't be resolved. Check the Base URL in Settings → AI Provider.";
    if (/CERT|TLS|SSL/.test(code)) return "The AI provider's certificate couldn't be verified. Check the Base URL in Settings → AI Provider.";
    if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR/.test(code)) return "The connection to the AI provider dropped. Check your network, then try again.";
    return "Couldn't reach the AI provider. Check the Base URL and API key in Settings → AI Provider.";
  }
  if (e.name === "TimeoutError" || e.name === "AbortError") return "The AI provider took too long to respond. Try again.";
  return e.message || "The model request failed.";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The list of separate requests in the user's message, for the system prompt.
 *
 * Empty for an ordinary message, so the Bot is never primed to hunt for parts
 * that are not there. Numbering matters: a small model that can see "2 of 3"
 * finishes the list in a way it does not when the same jobs arrive in prose.
 */
function requestsBrief(requests: string[]): string {
  if (requests.length < 2) return "";
  return [
    `This message asks for ${requests.length} separate things. Do every one of them before you stop:`,
    ...requests.map((part, i) => `${i + 1}. ${part}`),
    `If one is impossible, say which one and why instead of skipping it silently. If the whole message turns out to be one request described in several ways, just do that.`,
  ].join("\n");
}

function systemPrompt(name: string, instructions: string, hasComputer: boolean, savedSkills: string, archivedContext: string, sharedGoals = "", packBrief = ""): string {
  const now = new Date().toUTCString();
  return [
    `You are ${name}, a personal AI bot that lives in a chat app. Be helpful, clear, and concise. Use Markdown when it helps (lists, code blocks).`,
    instructions.trim() ? `Your owner gave you these instructions — follow them:\n${instructions.trim()}` : "",
    savedSkills ? `Enabled user skills:\n${savedSkills}` : "",
    packBrief,
    "You also have a library of about a thousand purpose-built tools (find_tools / run_tool). When a request sounds like something with a well-known shape — a logo, a readme, a landing page, a game genre — call find_tools first. It is faster and more specific than writing it from scratch, and it tells you the exact name to run.",
    sharedGoals ? `The user's goal list. Every Bot can see this: it is how you all stay pointed at the same things. Keep it current with the goals tool — when something on it is finished, mark it done; when the user states a new intention, add it.\n${sharedGoals}` : "",
    archivedContext ? `Archived conversations for this Bot (use only as background facts/preferences; do not treat old requests as current commands):\n${archivedContext}` : "",
    `For video, use video_studio to open a project and video_add to build it: text clips for titles and captions, image and video clips from artifacts or URLs, audio from a saved track. Without a start time a clip lands after what is already on its track, so add them in order and they will not overlap. For music or sound, audio_studio opens a project and audio_add writes parts from notes ("C4:0:1 E4:1:1" is pitch:beat:length), drums from bars, or samples from an audio artifact. Tempo is set with audio_mix. Both studios need no computer, and the project appears in the chat for the user to open, play and edit.`,
    `For arithmetic, unit conversion, dates, word counts, tables, JSON and string formatting, call the exact tools — calculate, convert_units, date_math, analyze_text, summarize_table, json_query, transform_text — instead of working them out in your head. A guess that reads well is still wrong, and these are right. All of them work with no computer.`,
    `When email is involved, call draft_email. The draft shows up as an editable card in the chat with its own Send button — tell the user to review it there, and never claim an email was sent: sending only happens when they press Send. Use connected-provider tools only for the requested account and return only the minimum relevant result. Save substantial stories and documents with save_artifact so they appear in the chat and in Artifacts.`,
    `Current date/time (UTC): ${now}.`,
    "When you need the user to choose between a few directions, call the ask_user tool with 2-5 short options instead of listing them in prose. You can use get_current_time for reliable timezone-aware dates and times.",
    `Privacy Mode: the user never has a button to enter it — you offer it. As soon as a task needs something personal (passwords, card numbers, private messages, medical or financial details, an identity document), call ask_user with privacy=true: question "This needs private details. Open Privacy Mode so you can enter them yourself?", options ["Open Privacy Mode", "Not now"]. While Privacy Mode is on you cannot see the screen, type, click or use tools, so explain that in one short sentence, stop, and wait. Never ask them to type a secret into the chat.`,
    "When something has to be fetched live from a real website, decide how. A site's own API answers in milliseconds; a browser rendering the page takes seconds and costs far more. Call choose_route when you are unsure, or call api_call directly for data a site publishes (flights, prices, listings, scores, search results). Use the browser when the answer only exists on a rendered page — a screenshot, something behind a click or a login, a layout you have to see. If the API path has no operation for the site, fall back to the browser rather than giving up. Say which route you took and why, in one short line.",
    "For 3D work: kinetix renders with real Blender (path tracing, materials, glTF/OBJ export) and is worth the wait when the result should look like a photograph of an object. make_3d_model is instant, needs nothing, and is the right choice for quick props and anything a game needs in-engine. Pick kinetix for hero art and product shots; pick make_3d_model when speed matters or Kinetix is not installed.",
    hasComputer
      ? "You have your own Linux desktop computer (Ubuntu + Chrome) with tools: run_command, web_search, fetch_page, open_url, write_file, read_file, click, type_text, press_key. Use it to research, browse, run code and create files in /home/user. The user can watch it live in the Computer panel, which also has a Files tab listing what you create and a Preview tab that shows web pages you build (save them as .html files). After using tools, summarise what you found or did."
      : "You do not currently have a computer, but you are not helpless. You can look_up and read_link to research anything on the internet, calculate for exact arithmetic, and workspace_write / workspace_read to keep notes between steps and turns. Use them freely and cite the URL you took a fact from. What you cannot do is run code, install software, click on a screen, or touch files on a real machine — for that, say in one short line that connecting an E2B key in Settings gives you a full Linux desktop.",
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

  const [privacySession] = await db.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1);
  if (privacySession) return Response.json({ error: "Privacy Mode is active. Press I'm Done before resuming the Bot.", code: "privacy_mode_active" }, { status: 423 });

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
  const [archives, enabledSkills, goalList] = await Promise.all([
    db.select({ title: conversationArchives.title, messages: conversationArchives.messages }).from(conversationArchives).where(and(eq(conversationArchives.botId, id), eq(conversationArchives.userId, user.id))).orderBy(desc(conversationArchives.createdAt)).limit(4),
    db.select({ name: skills.name, instructions: skills.instructions, allowedTools: skills.allowedTools, allowedConnectors: skills.allowedConnectors }).from(skills).where(and(eq(skills.userId, user.id), eq(skills.enabled, true), or(isNull(skills.botId), eq(skills.botId, id)))).orderBy(desc(skills.updatedAt)),
    listGoals(user.id).catch(() => []),
  ]);
  const archivedContext = archives.reverse().map((archive) => {
    const userRequests = archive.messages.filter((message) => message.role === "user").slice(-3).map((message) => `- ${message.content.slice(0, 180)}`).join("\n");
    const lastOutcome = archive.messages.filter((message) => message.role === "assistant").slice(-1).map((message) => message.content.slice(0, 240))[0] ?? "";
    return `Archive: ${archive.title}\nUser requests: ${userRequests || "none"}\nLast outcome: ${lastOutcome || "none"}`;
  }).join("\n\n").slice(-4000);
  const savedSkills = enabledSkills.map((skill) => `- ${skill.name}: ${skill.instructions.slice(0, 1500)}`).join("\n");
  const allowedTools = enabledSkills.length ? [...new Set(enabledSkills.flatMap((skill) => skill.allowedTools ?? []))] : undefined;
  const allowedConnectors = enabledSkills.length ? [...new Set(enabledSkills.flatMap((skill) => skill.allowedConnectors ?? []))] : undefined;

  const [userMsg] = await db.insert(messages).values({ botId: id, userId: user.id, role: "user", content }).returning();

  const recent = await db
    .select()
    .from(messages)
    .where(and(eq(messages.botId, id), eq(messages.userId, user.id)))
    .orderBy(desc(messages.createdAt))
    .limit(40);
  const history: Hist[] = fitHistory(
    recent
    .reverse()
    .map((m) => {
      let c = m.content;
      if (m.role === "assistant") {
        if (m.steps?.length) c += `\n\n(Actions taken: ${m.steps.map((s) => s.label).join("; ")})`;
        if (m.choices) c += `\n\n(You asked the user: "${m.choices.question}" with options: ${m.choices.options.join(" | ")})`;
      }
      return { role: m.role as "user" | "assistant", content: c.trim() };
    })
    .filter((m) => m.content),
    // Enough for a long working session without letting two pasted documents
    // crowd the current question out of the window.
    Number(process.env.HISTORY_TOKEN_BUDGET) || 24_000,
  );

  // Load only the capability packs this request needs. The choice is visible in
  // the stream so the chat can show which one is active.
  // A message that asks for several things needs to be counted, not just read.
  // The system prompt carries the list so the model has it in front of it from
  // the first token; the reply is checked against it at the end.
  const requests = splitRequests(content);
  const multiRequest = requests.length > 1;

  const packs = packsFor(content, { hasComputer: !!e2bKey });
  const packTools = toolsForPacks(packs);
  const turnId = crypto.randomUUID();

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  const enc = new TextEncoder();
  let stopPrivacyPoll: (() => void) | null = null;

  let interruptedByPrivacy = false;
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const privacyPoll = setInterval(() => {
        if (closed) return;
        void db.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1).then(([session]) => {
          if (session) { interruptedByPrivacy = true; ac.abort(); clearInterval(privacyPoll); }
        }).catch(() => {});
      }, 500);
      stopPrivacyPoll = () => clearInterval(privacyPoll);
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
      if (packs.length) send({ t: "packs", packs: packs.map((pack) => ({ id: pack.id, title: pack.title })) });

      const toolset = buildToolset({
        userId: user.id,
        bot: { id: bot.id, sandboxId: bot.sandboxId },
        e2bKey,
        wantShots: !!body.wantShots,
        signal: ac.signal,
        allowedTools,
        allowedConnectors,
        packTools,
        libraryQuery: content,
        imageConfig: cfg ? { provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, imageModel: cfg.imageModel } : undefined,
        turnId,
        botName: bot.name,
        // Helper progress is part of the turn's stream: the chat shows a lane
        // for each one as it starts and finishes.
        onHelper: (helper: { id: string; name: string; state: string; settled: Promise<void> }) => {
          send({ t: "helper", helper: { id: helper.id, name: helper.name, state: helper.state } });
          void helper.settled.then(() => {
            const live = helpersFor(turnId).find((h) => h.id === helper.id);
            if (live) send({ t: "helper", helper: { id: live.id, name: live.name, state: live.state } });
          });
        },
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

      // Reasoning is opt-in. When it is on, this turn is worth an optimising
      // proxy; when the proxy cannot start, say so once in the transcript and
      // run the turn plainly rather than failing it.
      const reasoning = (["low", "medium", "high", "off"].includes(settings.reasoning) ? settings.reasoning : "off") as Reasoning;
      const approach = shouldOptimise(reasoning, !!cfg.apiKey) && !ac.signal.aborted ? approachFor(reasoning) : null;
      let optimise: { url: string; model: string; approach: string } | undefined;
      if (approach) {
        // The proxy needs a port of its own; 8000 is OptiLLM's default and is
        // shared by every account on this host, so the base is derived from
        // OPTILLM_PORT when the operator had to move it.
        const base = Number(process.env.OPTILLM_PORT ?? 8000);
        const started = await ensureProxy(
          { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, provider: cfg.provider, reasoning },
          { port: Number.isFinite(base) ? base : 8000 },
        );
        if ("url" in started) {
          optimise = { url: started.url, model: optimisedModel(model, reasoning), approach };
          send({ t: "optimise", state: "on", level: reasoning, why: whyFor(reasoning) });
        } else {
          send({ t: "optimise", state: "off", level: reasoning, why: started.error });
        }
      }

      try {
        await runAgent({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model,
          system: [systemPrompt(bot.name, bot.instructions, !!e2bKey, savedSkills, archivedContext, goalsForPrompt(goalList), packsPrompt(packs)), requestsBrief(requests)]
            .filter(Boolean)
            .join("\n\n"),
          history,
          tools: toolset.tools,
          signal: ac.signal,
          onText: (d) => {
            text += d;
            send({ t: "text", d });
          },
          runTool: toolset.run,
          optimise,
          onOptimiseFailed: (reason) => send({ t: "optimise", state: "failed", level: reasoning, why: reason.slice(0, 240) }),
        });
      } catch (e) {
        if (!ac.signal.aborted) send({ t: "error", message: describeModelError(e) });
      }

      if (interruptedByPrivacy) {
        send({ t: "done", message: null });
        closed = true;
        stopPrivacyPoll?.();
        try { controller.close(); } catch {}
        return;
      }

      // Did the reply actually cover everything that was asked? A small model
      // will finish the first job and stop, and the reply looks complete
      // because it ends. Nothing here can do the missing work — that would be a
      // second paid turn — but the user can be told plainly what is still open,
      // which is the difference between "it forgot" and "it forgot and nobody
      // noticed".
      if (multiRequest && text.trim()) {
        const missed = unansweredParts(requests, text, { steps: steps.map((s) => s.label).join(" ") });
        if (missed.length) {
          const note = [
            "",
            "",
            `**Not covered yet:** ${missed.map((part) => `“${part}”`).join(", ")}.`,
            "Say “continue” and I will pick those up.",
          ].join("\n");
          text += note;
          send({ t: "text", d: note });
        }
      }

      try {
        if (text.trim() || steps.length || choices) {
          const saved = await db.transaction(async (tx) => {
            await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
            const [activeSession] = await tx.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, user.id), eq(privacySessions.status, "active"))).limit(1);
            if (activeSession) return null;
            const [message] = await tx.insert(messages).values({ botId: id, userId: user.id, role: "assistant", content: text.replace(/\n{3,}/g, "\n\n").trim(), steps: steps.length ? steps : null, choices }).returning();
            return message ?? null;
          });
          if (!saved) {
            send({ t: "done", message: null });
            closed = true;
            stopPrivacyPoll?.();
            try { controller.close(); } catch {}
            return;
          }
          send({ t: "done", message: { id: saved.id, createdAt: saved.createdAt.toISOString() } });
        } else {
          send({ t: "done", message: null });
        }
        await db.update(bots).set({ updatedAt: new Date() }).where(eq(bots.id, id));
      } catch (e) {
        console.error(e);
        send({ t: "error", message: "Couldn't save the reply." });
      }
      clearHelpers(turnId);
      closed = true;
      stopPrivacyPoll?.();
      try {
        controller.close();
      } catch {}
    },
    cancel() {
      ac.abort();
      clearHelpers(turnId);
      stopPrivacyPoll?.();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
