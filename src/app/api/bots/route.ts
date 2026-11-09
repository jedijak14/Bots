import { db } from "@/db";
import { bots } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";
import { greetingPreview, insertGreeting, toBotDTO } from "@/lib/bots";
import { isColor, isShape } from "@/lib/shapes";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = (await req.json().catch(() => ({}))) as {
      name?: string;
      shape?: string;
      color?: string;
      instructions?: string;
    };
    const name = String(b.name ?? "").trim().slice(0, 40);
    if (!name) throw new HttpError(400, "Give your bot a name.");
    const shape = String(b.shape ?? "circle");
    const color = String(b.color ?? "blue");
    if (!isShape(shape) || !isColor(color)) throw new HttpError(400, "Pick a valid shape and color.");
    const [bot] = await db
      .insert(bots)
      .values({ userId: user.id, name, shape, color, instructions: String(b.instructions ?? "").slice(0, 4000) })
      .returning();
    await insertGreeting(user.id, bot.id, name);
    return Response.json({ bot: toBotDTO(bot, greetingPreview(name)) });
  } catch (e) {
    return handleError(e);
  }
}
