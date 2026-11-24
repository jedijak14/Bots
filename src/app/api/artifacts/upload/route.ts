import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { handleError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 24 MB of audio is a long song; a cover is never more than a few MB. */
const LIMITS: Record<string, number> = { audio: 24 * 1024 * 1024, image: 8 * 1024 * 1024 };

const SUPPORTED: Record<string, true> = {
  "audio/mpeg": true,
  "audio/mp3": true,
  "audio/wav": true,
  "audio/x-wav": true,
  "audio/ogg": true,
  "audio/mp4": true,
  "audio/x-m4a": true,
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
  "image/gif": true,
};

/**
 * Stores a song or a cover as an artifact and returns its id, so a lyric video
 * can point at it. Uploads arrive as a data URL from the browser: that keeps the
 * client simple and works on any deployment without object-storage credentials.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as {
      botId?: string;
      kind?: "audio" | "image" | "lyrics";
      title?: string;
      dataUrl?: string;
    };
    // Lyrics arrive as plain text, not a data URL; everything else is binary.
    const kind = body.kind === "image" ? "image" : body.kind === "lyrics" ? "lyrics" : "audio";
    if (!body.botId || !(await getBot(user.id, body.botId))) return Response.json({ error: "Bot not found." }, { status: 404 });

    // Lyrics are text: validate, store, done — no base64, no mime table.
    if (kind === "lyrics") {
      const text = String(body.dataUrl ?? "");
      if (!text.trim()) return Response.json({ error: "That lyrics file is empty." }, { status: 400 });
      if (text.length > 200_000) return Response.json({ error: "That lyrics file is too large." }, { status: 400 });
      const [saved] = await db
        .insert(artifacts)
        .values({ botId: body.botId, userId: user.id, title: String(body.title ?? "").trim().slice(0, 160) || "Lyrics", kind: "lyrics", content: text })
        .returning({ id: artifacts.id });
      return Response.json({ id: saved.id, mime: "text/plain", bytes: text.length }, { status: 201 });
    }

    const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(body.dataUrl ?? ""));
    if (!match) return Response.json({ error: "That file could not be read." }, { status: 400 });
    const [, mime, base64] = match;
    if (!SUPPORTED[mime]) {
      return Response.json(
        { error: kind === "audio" ? "Use an mp3, wav, ogg or m4a file." : "Use a PNG, JPEG, WebP or GIF image." },
        { status: 400 },
      );
    }
    if (kind === "audio" && !mime.startsWith("audio/")) return Response.json({ error: "That is not an audio file." }, { status: 400 });
    if (kind === "image" && !mime.startsWith("image/")) return Response.json({ error: "That is not an image." }, { status: 400 });

    const bytes = Buffer.from(base64, "base64");
    if (bytes.byteLength > LIMITS[kind]) {
      return Response.json(
        { error: kind === "audio" ? "That song is over 24 MB." : "That image is over 8 MB." },
        { status: 413 },
      );
    }

    const title = String(body.title ?? "").trim().slice(0, 160) || (kind === "audio" ? "Song" : "Cover art");
    const [row] = await db
      .insert(artifacts)
      .values({ userId: user.id, botId: body.botId, title, kind, content: `data:${mime};base64,${base64}` })
      .returning({ id: artifacts.id });
    return Response.json({ id: row.id, mime, bytes: bytes.byteLength }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
