import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, bots } from "@/db/schema";
import { runAgent } from "@/lib/ai/llm";
import { aiConfigFrom, getSettings } from "@/lib/settings";

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
  runs.delete(turnId);
}

/**
 * Tools a Helper may use.
 *
 * Helpers can research and they can write files, but they cannot touch the
 * user's connected accounts, send mail, or drive the on-screen desktop. A
 * helper is doing a piece of the work, not acting on the user's behalf.
 */
const HELPER_TOOL_NAMES = new Set([
  "web_search",
  "fetch_page",
  "run_command",
  "write_file",
  "read_file",
  "get_current_time",
  "draw_asset",
  "design_brief",
  "make_asset_sheet",
]);

export type SpawnInput = {
  turnId: string;
  userId: string;
  botId: string;
  botName: string;
  name: string;
  task: string;
  context?: string;
  artifactKind?: string;
  /** Tools available to helpers, already filtered for the deployment. */
  tools: import("@/lib/ai/llm").Tool[];
  runTool: (name: string, args: Record<string, unknown>, id: string) => Promise<import("@/lib/ai/llm").ToolResult>;
  signal: AbortSignal;
};

export function spawnHelper(input: SpawnInput): Helper {
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
    startedAt: Date.now(),
    endedAt: null,
    settled,
  };
  list.push(helper);
  runs.set(input.turnId, list);

  // Deliberately not awaited: the main Bot keeps working while this runs.
  void runHelper(input, helper).finally(() => {
    helper.endedAt = Date.now();
    settle();
  });

  return helper;
}

async function runHelper(input: SpawnInput, helper: Helper): Promise<void> {
  try {
    const settings = await getSettings(input.userId);
    const cfg = aiConfigFrom(settings);
    if (!cfg) throw new Error("No AI provider is configured.");

    const allowed = input.tools.filter((tool) => HELPER_TOOL_NAMES.has(tool.name));
    const system = [
      `You are ${helper.name}, a Helper Bot working for ${input.botName}.`,
      `Your job, in full: ${helper.task}`,
      input.context ? `Context from ${input.botName}:\n${input.context}` : "",
      input.artifactKind
        ? `Save what you produce with save_artifact as kind "${input.artifactKind}" — the user will see it as a card.`
        : "Reply with your finished work in the message. Be complete rather than describing what you would do.",
      "You cannot send email, use the user's connected accounts, or control their screen. Do not ask questions — nobody is watching this thread. Make a sensible choice and say which one you made.",
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
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.defaultModel ?? "",
      system,
      history: [{ role: "user", content: helper.task }],
      tools: allowed,
      signal: input.signal,
      maxSteps: HELPER_STEPS,
      onText: (delta) => {
        report += delta;
      },
      runTool: async (name, args, id) => {
        const key = `${name}:${JSON.stringify(args)}`;
        if (seen.has(key) && name !== "read_file" && name !== "helper_status") {
          return { output: "You have already run exactly this step; its result is above. Do not repeat it — reply with your report now." };
        }
        seen.add(key);
        const result = await input.runTool(name, args, `${helper.id}:${id}`);
        if (result.artifactId) helper.artifactId = result.artifactId;
        done.push(`${name}: ${result.output.slice(0, 160)}`);
        return result;
      },
    });

    helper.report =
      report.trim() ||
      (done.length ? `Completed these steps:\n${done.map((line) => `- ${line}`).join("\n")}` : "Finished without producing anything.");
    helper.state = "done";
  } catch (error) {
    helper.state = "failed";
    helper.report = error instanceof Error ? error.message : "The Helper stopped unexpectedly.";
  }
}

/** A compact view for the tool result the main Bot reads. */
export function helperSummary(helper: Helper): Record<string, unknown> {
  return {
    name: helper.name,
    state: helper.state,
    seconds: Math.round(((helper.endedAt ?? Date.now()) - helper.startedAt) / 1000),
    artifactId: helper.artifactId,
    report: helper.report.slice(0, 4000) || (helper.state === "working" ? "Still working." : ""),
  };
}

/** Wait until every helper settles, or until the caller's patience runs out. */
export async function waitForHelpers(turnId: string, seconds: number, signal: AbortSignal): Promise<void> {
  const list = runs.get(turnId) ?? [];
  const pending = list.filter((helper) => helper.state === "working").map((helper) => helper.settled);
  if (!pending.length) return;
  const budget = Math.max(0, Math.min(seconds, 25)) * 1000;
  if (!budget) return;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, budget);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }),
  ]);
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
