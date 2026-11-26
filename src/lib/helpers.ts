import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, bots } from "@/db/schema";
import { runAgent } from "@/lib/ai/llm";
import { helperMayRun, helperTools, waitForHelperJobs } from "@/lib/helper-policy";

/**
 * Helper Bots.
 *
 * A Helper is a second agent, given one slice of a job and its own short brief,
 * that works while the main Bot carries on. It is intentionally small: it does
 * not get the user's other conversations, their connections, or their
 * computer's screen — only the context the main Bot chooses to pass. That
 * keeps a Helper useful without making it a second, unsupervised copy of the
 * Bot with the run of the account.
 *
 * Helpers live in memory for the length of the request that spawned them.
 * They are not a queue and there is no retry: if the same turn that spawned
 * them ends, they are gone, which is the right lifetime for "help me finish
 * this build".
 */

export type HelperState = "working" | "done" | "failed";

export type Helper = {
  id: string;
  name: string;
  task: string;
  state: HelperState;
  report: string;
  artifactId: string | null;
  artifactIds: string[];
  controller: AbortController;
  startedAt: number;
  endedAt: number | null;
  /** Resolved when the helper reaches a terminal state. */
  settled: Promise<void>;
};

/** Helpers are scoped to a turn, so one user's cannot see another's. */
const runs = new Map<string, Helper[]>();

const MAX_HELPERS = 4;
const HELPER_STEPS = 8;

export function helpersFor(turnId: string): Helper[] {
  return runs.get(turnId) ?? [];
}

export function clearHelpers(turnId: string): void {
  const list = runs.get(turnId) ?? [];
  runs.delete(turnId);
  for (const helper of list) helper.controller.abort();
}

export type SpawnInput = {
  turnId: string;
  userId: string;
  botId: string;
  botName: string;
  name: string;
  task: string;
  context?: string;
  artifactKind?: string;
  /** Use the same explicitly selected provider and model as the parent turn. */
  ai: { provider: import("@/lib/ai/providers").ProviderId; apiKey: string; baseUrl: string; model: string };
  /** Tools available to helpers, already filtered for the deployment. */
  tools: import("@/lib/ai/llm").Tool[];
  runTool: (name: string, args: Record<string, unknown>, id: string) => Promise<import("@/lib/ai/llm").ToolResult>;
  signal: AbortSignal;
};

export function spawnHelper(input: SpawnInput): Helper {
  if (input.signal.aborted) throw new Error("This turn has stopped.");
  const list = runs.get(input.turnId) ?? [];
  if (list.length >= MAX_HELPERS) {
    throw new Error(`You already have ${MAX_HELPERS} Helper Bots running. Check them with helper_status before starting more.`);
  }
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const helper: Helper = {
    id: crypto.randomUUID(),
    name: input.name.slice(0, 40) || "Helper",
    task: input.task.slice(0, 2000),
    state: "working",
    report: "",
    artifactId: null,
    artifactIds: [],
    controller: new AbortController(),
    startedAt: Date.now(),
    endedAt: null,
    settled,
  };
  list.push(helper);
  runs.set(input.turnId, list);

  // Deliberately not awaited: the main Bot keeps working while this runs.
  const abort = () => helper.controller.abort();
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  void runHelper(input, helper).finally(() => {
    input.signal.removeEventListener("abort", abort);
    helper.endedAt = Date.now();
    settle();
  });

  return helper;
}

async function runHelper(input: SpawnInput, helper: Helper): Promise<void> {
  try {
    const allowed = helperTools(input.tools);
    const allowedNames = new Set(allowed.map(tool => tool.name));
    const system = [
      `You are ${helper.name}, a Helper Bot working for ${input.botName}.`,
      `Your job, in full: ${helper.task}`,
      input.context ? `Context from ${input.botName}:\n${input.context.slice(0, 6000)}` : "",
      input.artifactKind
        ? `If save_artifact is available, save your work as kind "${input.artifactKind.slice(0, 40)}"; otherwise return it in your report.`
        : "Reply with your finished work in the message. Be complete rather than describing what you would do.",
      "Use only the tools provided. You cannot send email, use connected accounts, run shell commands, or control the screen. Files and artifacts are shared with the parent: avoid editing the same project concurrently. Do not ask questions — nobody is watching this thread. Make a sensible choice and say which one you made.",
      "Finish with a short report: what you produced, and anything the main Bot should know.",
    ]
      .filter(Boolean)
      .join("\n\n");

    let report = "";
    // A helper that only draws usually ends on a tool call with no prose, and
    // "finished without a written report" then hides everything it did. Keep a
    // list of the work instead, and refuse to run the same step twice — the
    // first version of this looped nine times on one draw_asset.
    const done: string[] = [];
    const seen = new Set<string>();
    await runAgent({
      provider: input.ai.provider,
      apiKey: input.ai.apiKey,
      baseUrl: input.ai.baseUrl,
      model: input.ai.model,
      system,
      history: [{ role: "user", content: helper.task }],
      tools: allowed,
      signal: helper.controller.signal,
      maxSteps: HELPER_STEPS,
      onText: (delta) => {
        report += delta;
      },
      runTool: async (name, args, id) => {
        if (helper.controller.signal.aborted) throw new DOMException("Helper stopped", "AbortError");
        if (!helperMayRun(allowedNames, name)) return { output: "This tool is not available to this Helper." };
        const key = `${name}:${JSON.stringify(args)}`;
        if (seen.has(key) && name !== "read_file" && name !== "helper_status") {
          return { output: "You have already run exactly this step; its result is above. Do not repeat it — reply with your report now." };
        }
        seen.add(key);
        const result = await input.runTool(name, args, `${helper.id}:${id}`);
        if (result.artifactId) {
          helper.artifactId = result.artifactId;
          if (!helper.artifactIds.includes(result.artifactId)) helper.artifactIds.push(result.artifactId);
        }
        done.push(`${name}: ${result.output.slice(0, 160)}`);
        return result;
      },
    });

    if (helper.controller.signal.aborted) throw new DOMException("Helper stopped", "AbortError");
    helper.report =
      report.trim() ||
      (done.length ? `Steps attempted:\n${done.map((line) => `- ${line}`).join("\n")}` : "Finished without producing anything.");
    helper.state = "done";
  } catch (error) {
    helper.state = "failed";
    helper.report = error instanceof Error ? error.message : "The Helper stopped unexpectedly.";
  }
}

/** A compact view for the tool result the main Bot reads. */
export function helperSummary(helper: Helper): Record<string, unknown> {
  return {
    id: helper.id,
    name: helper.name,
    state: helper.state,
    seconds: Math.round(((helper.endedAt ?? Date.now()) - helper.startedAt) / 1000),
    artifactId: helper.artifactId,
    artifactIds: helper.artifactIds.slice(0, HELPER_STEPS),
    report: helper.report.slice(0, 4000) || (helper.state === "working" ? "Still working." : ""),
  };
}

/** Wait until every helper settles, or until the caller's patience runs out. */
export async function waitForHelpers(turnId: string, seconds: number, signal: AbortSignal): Promise<void> {
  const pending = (runs.get(turnId) ?? []).filter(helper => helper.state === "working").map(helper => helper.settled);
  await waitForHelperJobs(pending, seconds, signal);
}

/** The artifact card a Helper saved, so the main Bot can name it. */
export async function helperArtifactTitle(userId: string, botId: string, id: string): Promise<string | null> {
  const [row] = await db
    .select({ title: artifacts.title })
    .from(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.userId, userId), eq(artifacts.botId, botId)))
    .limit(1);
  return row?.title ?? null;
}

/** Used by tests and the health endpoint: how many turns are holding helpers. */
export function activeHelperTurns(): number {
  return runs.size;
}

/** Confirm the bot belongs to the user before a helper writes as it. */
export async function botOwnedBy(userId: string, botId: string): Promise<boolean> {
  const [row] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), eq(bots.userId, userId))).limit(1);
  return !!row;
}
