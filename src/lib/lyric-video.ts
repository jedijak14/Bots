import "server-only";
import { db } from "@/db";
import { artifacts } from "@/db/schema";

export { LYRIC_PRESETS, parseSpec, type LyricVideoSpec } from "./lyric-video-spec";

/** Save the audio or artwork blob as its own artifact, so it survives a reload. */
export async function saveMediaArtifact(input: {
  userId: string;
  botId: string;
  title: string;
  kind: "audio" | "image";
  content: string;
}): Promise<string> {
  const [row] = await db
    .insert(artifacts)
    .values({ userId: input.userId, botId: input.botId, title: input.title, kind: input.kind, content: input.content })
    .returning({ id: artifacts.id });
  return row.id;
}
