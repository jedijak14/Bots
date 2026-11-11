import { handleError, HttpError, requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { e2bKeyFrom, getSettings } from "@/lib/settings";
import { connectDesktop } from "@/lib/sandbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const bot = await getBot(user.id, id);
    if (!bot) throw new HttpError(404, "Bot not found.");
    const key = e2bKeyFrom(await getSettings(user.id));
    if (!key) return Response.json({ error: "Add your E2B API key in Settings.", code: "no_e2b" }, { status: 400 });
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "/home/user";
    const userRoot = "/home/user";
    if ((path !== userRoot && !path.startsWith(`${userRoot}/`)) || path.split("/").includes("..")) throw new HttpError(400, "Invalid path.");
    const sb = await connectDesktop({ id: bot.id, sandboxId: bot.sandboxId }, key);
    if (!sb) return Response.json({ active: false, path, entries: [] });

    if (url.searchParams.get("download")) {
      const bytes = await sb.files.read(path, { format: "bytes" });
      const name = path.split("/").pop() || "file";
      return new Response(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
        },
      });
    }

    const list = await sb.files.list(path);
    const entries = list
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: e.path, type: e.type === "dir" ? "dir" : "file", size: e.size }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return Response.json({ active: true, path, entries });
  } catch (e) {
    if (e instanceof HttpError) return handleError(e);
    return Response.json({ error: "Couldn't read files. Try again." }, { status: 502 });
  }
}
