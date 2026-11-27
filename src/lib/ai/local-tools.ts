/** Small, read-only subset of Bot tools exposed to the local model. */
export const LOCAL_TOOL_NAMES = ["calculate", "convert_units", "check_contrast", "describe_numbers", "get_current_time", "date_math", "analyze_text", "transform_text", "estimate_loan", "convert_time_zones", "compare_texts"] as const;
export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[number];
export type LocalToolCall = { tool: LocalToolName; args: Record<string, unknown> };

/** Validate even when called directly by an untrusted client. */
export function validLocalToolCall(input: unknown): input is LocalToolCall {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (!LOCAL_TOOL_NAMES.includes(value.tool as LocalToolName) || !value.args || typeof value.args !== "object" || Array.isArray(value.args)) return false;
  const a = value.args as Record<string, unknown>;
  const only = (allowed: string[]) => Object.keys(a).every(k => allowed.includes(k));
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  switch (value.tool) {
    case "calculate": return only(["expression"]) && str(a.expression, 300);
    case "convert_units": return only(["amount", "from", "to"]) && typeof a.amount === "number" && Number.isFinite(a.amount) && Math.abs(a.amount) <= 1e100 && str(a.from, 30) && str(a.to, 30);
    case "check_contrast": return only(["foreground", "background"]) && str(a.foreground, 50) && str(a.background, 50);
    case "describe_numbers": return only(["values"]) && Array.isArray(a.values) && a.values.length > 0 && a.values.length <= 1000 && a.values.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e100);
    case "get_current_time": return only(["timezone"]) && (a.timezone === undefined || str(a.timezone, 100));
    case "date_math": return only(["date", "compare", "addDays", "addMonths", "addYears", "addBusinessDays"]) && str(a.date, 10) && (a.compare === undefined || str(a.compare, 10)) && [a.addDays, a.addMonths, a.addYears, a.addBusinessDays].every(v => v === undefined || (typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 100000));
    case "analyze_text": return only(["text"]) && str(a.text, 3000);
    case "transform_text": return only(["text", "op"]) && str(a.text, 3000) && typeof a.op === "string" && ["slug", "kebab", "snake", "camel", "title", "upper", "lower", "sentence", "trim", "dedupe-lines", "sort-lines", "reverse-lines", "remove-blank-lines", "number-lines", "trim-lines", "base64", "unbase64", "urlencode", "urldecode"].includes(a.op);
    case "estimate_loan": return only(["principal", "annualRate", "months"]) && typeof a.principal === "number" && Number.isFinite(a.principal) && a.principal > 0 && a.principal <= 1e12 && typeof a.annualRate === "number" && Number.isFinite(a.annualRate) && a.annualRate >= 0 && a.annualRate <= 1000 && typeof a.months === "number" && Number.isInteger(a.months) && a.months >= 1 && a.months <= 1200;
    case "convert_time_zones": return only(["instant", "zones"]) && str(a.instant, 50) && Array.isArray(a.zones) && a.zones.length >= 1 && a.zones.length <= 20 && a.zones.every(z => str(z, 100));
    case "compare_texts": return only(["before", "after"]) && typeof a.before === "string" && a.before.length <= 3000 && typeof a.after === "string" && a.after.length <= 3000;
    default: return false;
  }
}

/** Accept only a complete JSON object, not instructions embedded in prose. */
export function parseLocalToolCall(text: string): LocalToolCall | null {
  const trimmed = text.trim();
  if (trimmed.length > 8000) return null;
  // Accept a single fenced JSON block, not JSON buried in model prose.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  if (!candidate.startsWith("{")) return null;
  try { const parsed: unknown = JSON.parse(candidate); return validLocalToolCall(parsed) ? parsed : null; } catch { return null; }
}

export const LOCAL_TOOL_PROMPT = `You are Bots Local, a helpful assistant powered by Qwen3 4B from Qwen. Answer open-ended questions naturally, admit uncertainty, and never invent current information. You have read-only tools. To use exactly one tool, respond with ONLY a JSON object: {"tool":"name","args":{...}}. Otherwise respond normally. Never claim a tool ran if you did not request it. Available tools:
calculate: {"expression":"(2 + 3) * 4"}
convert_units: {"amount":12,"from":"km","to":"mi"}
check_contrast: {"foreground":"#000000","background":"#ffffff"}
describe_numbers: {"values":[1,2,3]}
get_current_time: {"timezone":"America/Los_Angeles"}
date_math: {"date":"2026-01-01","addDays":30}
analyze_text: {"text":"Words to count"}
transform_text: {"text":"Hello World","op":"slug"}
estimate_loan: {"principal":10000,"annualRate":5,"months":36}
convert_time_zones: {"instant":"2026-01-01T12:00:00Z","zones":["America/Los_Angeles"]}
compare_texts: {"before":"old line","after":"new line"}
You cannot browse, send email, write files, use connected accounts or control a computer.`;
