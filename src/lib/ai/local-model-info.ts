/** The public, unmodified instruction-tuned model used for browser inference. */
export const LOCAL_MODEL_ID = "Qwen3-4B-q4f32_1-MLC";
export const LOCAL_MODEL_NAME = "Qwen3 4B";
export const LOCAL_CONSENT_KEY = "bots-local-qwen3-4b-consent-v1";
export const LOCAL_BETA_WARNING = "Bots Local replaces Orbit Local with the unmodified Qwen3 4B model from Qwen, packaged by MLC. It is a general-purpose pretrained model, not a model trained by this app. It may be wrong, make up facts or misinterpret tool requests; it cannot browse the web, edit files, use connected accounts or delegate. It needs a compatible WebGPU browser, approximately 4.3 GB of GPU memory, and a first download of about 2.5 GB from Hugging Face plus model code from the WebLLM project. Real inference has not yet been verified in this app; the download may fail or continue after you stop. Tool requests and completed messages are sent to this app's server. Your hosted provider remains available. Continue?";

/** Consent is per tab and model version; previous Orbit consent is not reused. */
export function hasLocalConsent(): boolean {
  try { return sessionStorage.getItem(LOCAL_CONSENT_KEY) === "yes"; } catch { return false; }
}
export function rememberLocalConsent(): void {
  try { sessionStorage.setItem(LOCAL_CONSENT_KEY, "yes"); } catch { /* Ask again on the next use. */ }
}
