/** Read JSON with a hard byte limit, including when Content-Length is absent or incorrect. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: "Invalid JSON request." };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: "Request is too large." };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON request." };
  } finally {
    reader.releaseLock();
  }
}
