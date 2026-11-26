/** Browser-only, on-demand Gemma inference. We never load weights on page load. */
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { createLocalEngineManager } from "./local-engine";
import { createLocalQueue } from "./local-queue";

const runExclusive = createLocalQueue();

const MODEL = "gemma-2-2b-it-q4f32_1-MLC";
const manager = createLocalEngineManager<MLCEngineInterface>(async (onProgress) => {
  try {
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    return await CreateMLCEngine(MODEL, { initProgressCallback: report => onProgress(report.text) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown loading error";
    throw new Error(`Could not load Orbit Local (Gemma): ${detail}. Check WebGPU, device memory and access to Hugging Face and the model files; model terms may require approval.`);
  }
});

export async function browserGemma(
  history: { role: "user" | "assistant"; content: string }[],
  onProgress: (message: string) => void,
  onToken: (text: string) => void,
  signal: AbortSignal,
) {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) throw new Error("Orbit Local needs WebGPU. Try a supported browser and device, or use a hosted provider.");
  if (!await gpu.requestAdapter()) throw new Error("Orbit Local could not find a usable WebGPU adapter. Enable hardware acceleration or try another device.");
  const engine = await manager.get(signal, onProgress);
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  onProgress("Waiting for the local model…");
  return runExclusive(signal, async () => {
    onProgress("Generating locally…");
    const stop = () => { void engine.interruptGenerate(); };
    signal.addEventListener("abort", stop, { once: true });
    try {
      const stream = await engine.chat.completions.create({
        messages: history,
        max_tokens: 400,
        temperature: 0.7,
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
      if (!answer.trim()) throw new Error("Gemma returned an empty response. Please try again.");
      return answer;
    } finally {
      signal.removeEventListener("abort", stop);
    }
  });
}
