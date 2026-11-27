import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { LOCAL_MODEL_NAME } from "./local-model-info";

export type LocalMessage = { role: "system" | "user" | "assistant"; content: string };

/** Generate a single reply; the caller serializes access to the engine. */
export async function generateLocalReply(
  engine: MLCEngineInterface,
  history: LocalMessage[],
  onToken: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  const stop = () => { void engine.interruptGenerate(); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const stream = await engine.chat.completions.create({
      messages: history,
      max_tokens: 600,
      temperature: 0.7,
      top_p: 0.8,
      extra_body: { enable_thinking: false },
      stream: true,
    });
    let answer = "";
    for await (const chunk of stream) {
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      const delta = chunk.choices[0]?.delta.content ?? "";
      answer += delta;
      if (delta) onToken(delta);
    }
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (!answer.trim()) throw new Error(`${LOCAL_MODEL_NAME} returned an empty response. Please try again.`);
    return answer;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
