/** Validate untrusted goal payloads before they reach date parsing or the database. */
export function goalInputError(value: unknown, create: boolean): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid goal request.";
  const body = value as Record<string, unknown>;
  if ((create || body.title !== undefined) && (typeof body.title !== "string" || !body.title.trim())) return "A goal needs a title.";
  if (body.detail !== undefined && typeof body.detail !== "string") return "Goal detail must be text.";
  if (body.status !== undefined && body.status !== "open" && body.status !== "doing" && body.status !== "done") return "Invalid goal status.";
  if (body.due !== undefined && body.due !== null && (typeof body.due !== "string" || (body.due !== "" && !Number.isFinite(Date.parse(body.due))))) return "Invalid goal due date.";
  if (body.botId !== undefined && body.botId !== null && typeof body.botId !== "string") return "Invalid Bot id.";
  return null;
}
