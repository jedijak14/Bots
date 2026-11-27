import { MEDIA_CHUNK_BYTES, MEDIA_LIMITS } from "./media-upload";

/** Raw media is deliberately served in bounded ranges on serverless hosts. */
export async function fetchMediaBlob(id: string, signal?: AbortSignal): Promise<Blob> {
  const chunks: Blob[] = [];
  let offset = 0, total = Infinity;
  while (offset < total) {
    const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}/raw`, { headers: { Range: `bytes=${offset}-` }, signal });
    if (!response.ok) throw new Error(`Media could not be loaded (${response.status}).`);
    const range = response.headers.get("Content-Range");
    const chunk = await response.blob();
    if (!chunk.size) throw new Error("The media download was interrupted.");
    chunks.push(chunk);
    offset += chunk.size;
    if (range) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      if (!match || Number(match[1]) !== offset - chunk.size || Number(match[2]) !== offset - 1) throw new Error("Invalid media range response.");
      total = Number(match[3]);
    } else {
      if (response.status === 206 || offset !== chunk.size) throw new Error("The media download was interrupted.");
      total = offset;
    }
    if (!Number.isSafeInteger(total) || total < offset || total > MEDIA_LIMITS.video) throw new Error("Invalid or oversized media response.");
  }
  return new Blob(chunks, { type: chunks[0]?.type || "application/octet-stream" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function uploadVideo(blob: Blob, botId: string, title: string, signal?: AbortSignal): Promise<string> {
  if (!blob.size || blob.size > MEDIA_LIMITS.video) throw new Error("The MP4 is empty or exceeds the 32 MB artifact limit.");
  let id: string | null = null;
  try {
    const count = Math.ceil(blob.size / MEDIA_CHUNK_BYTES);
    for (let index = 0; index < count; index++) {
      const chunk = blob.slice(index * MEDIA_CHUNK_BYTES, (index + 1) * MEDIA_CHUNK_BYTES);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the rendered MP4."));
        reader.readAsDataURL(chunk);
      });
      const response: Response = await fetch("/api/artifacts/upload/chunk", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ botId, kind: "video", title, mime: "video/mp4", index, totalBytes: blob.size, uploadId: id, data: dataUrl.slice(dataUrl.indexOf(",") + 1) }),
      });
      const body: { id?: string; complete?: boolean; error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not save the MP4 (${response.status}).`);
      if (!body.id || body.complete !== (index === count - 1) || (id && body.id !== id)) throw new Error("The MP4 upload was interrupted.");
      id = body.id;
    }
    if (!id) throw new Error("The MP4 upload was interrupted.");
    return id;
  } catch (error) {
    if (id) void fetch(`/api/artifacts/upload/chunk?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}
