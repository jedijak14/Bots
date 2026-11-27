/** Browser-only, on-demand Qwen inference. We never load weights on page load. */
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { LOCAL_MODEL_ID, LOCAL_MODEL_NAME } from "./local-model-info";
import { createLocalEngineManager } from "./local-engine";
import { createLocalQueue } from "./local-queue";
import { generateLocalReply, type LocalMessage } from "./local-generation";

const runExclusive = createLocalQueue();
const manager = createLocalEngineManager<MLCEngineInterface>(async (onProgress) => {
  try {
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    return await CreateMLCEngine(LOCAL_MODEL_ID, { initProgressCallback: report => onProgress(report.text) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown loading error";
    throw new Error(`Could not load Bots Local (${LOCAL_MODEL_NAME}): ${detail}. Check WebGPU, device memory and access to Hugging Face and WebLLM model files.`);
  }
});

export async function browserLocal(
  history: LocalMessage[],
  onProgress: (message: string) => void,
  onToken: (text: string) => void,
  signal: AbortSignal,
) {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) throw new Error("Bots Local needs WebGPU. Try a supported browser and device, or use a hosted provider.");
  if (!await gpu.requestAdapter()) throw new Error("Bots Local could not find a usable WebGPU adapter. Enable hardware acceleration or try another device.");
  const engine = await manager.get(signal, onProgress);
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  onProgress("Waiting for the local model…");
  return runExclusive(signal, async () => {
    onProgress("Generating locally…");
    return generateLocalReply(engine, history, onToken, signal);
  });
}
