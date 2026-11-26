import { parseLocalToolCall } from "./local-tools";

/** A single bounded tool step; never treat model text as a tool result. */
export async function finishLocalTurn(
  generated: string,
  runTool: (call: NonNullable<ReturnType<typeof parseLocalToolCall>>) => Promise<{ ok: boolean; output?: string; error?: string }>,
): Promise<string> {
  const call = parseLocalToolCall(generated);
  if (call) {
    const result = await runTool(call);
    return result.ok
      ? `**${call.tool} result:**\n\n${result.output ?? ""}`
      : `**${call.tool} could not run:** ${result.error ?? "Unknown error"}`;
  }
  if (/^\s*(?:```(?:json)?\s*\n)?\{\s*"tool"\s*:/i.test(generated)) {
    return "I could not make a valid supported tool request. Please try again or use a hosted model.";
  }
  return generated;
}
