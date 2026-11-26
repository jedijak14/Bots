import type { Tool } from "./ai/llm";

/** Helper access is the intersection of this list and the parent Bot's permitted tools. */
const HELPER_TOOL_NAMES = new Set([
  "web_search", "fetch_page", "look_up", "read_link", "read_file", "write_file",
  "get_current_time", "calculate", "convert_units", "date_math", "analyze_text",
  "summarize_table", "json_query", "transform_text", "check_contrast", "color_palette",
  "money_math", "spell_number", "describe_numbers", "convert_time_zones", "estimate_loan", "compare_texts",
  "save_artifact", "draw_asset", "design_brief", "make_asset_sheet",
  "video_studio", "video_add", "video_edit", "video_remove", "video_narrate", "video_split",
  "video_duplicate", "video_tighten", "video_read", "audio_studio", "audio_add", "audio_mix",
  "audio_track", "audio_repeat", "audio_remove", "audio_move", "audio_read",
]);

export function helperTools(parentTools: Tool[]): Tool[] {
  return parentTools.filter(tool => HELPER_TOOL_NAMES.has(tool.name));
}

export function helperMayRun(available: Set<string>, name: string): boolean {
  return HELPER_TOOL_NAMES.has(name) && available.has(name);
}

/** Do not launch extra agents and provider calls unless the user asks to delegate. */
export function userRequestedHelpers(message: string): boolean {
  const work = /\b(use|ask|start|spawn|run|employ|assign|have|let|create|hire)\b[\s\S]{0,80}\b(helper bots?|helpers?|subagents?|sub-agents?|parallel agents?|agent team|team of agents)\b/i;
  return /\b(delegate|delegating)\b/i.test(message) || work.test(message);
}

/** Wait for current jobs, but remove the abort handler and timer on every path. */
export async function waitForHelperJobs(jobs: Promise<void>[], seconds: number, signal: AbortSignal): Promise<void> {
  const budget = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, 25)) * 1000;
  if (!jobs.length || !budget || signal.aborted) return;
  await new Promise<void>(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, budget);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
    void Promise.allSettled(jobs).then(finish);
  });
}
