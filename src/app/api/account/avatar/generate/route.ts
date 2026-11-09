import { del, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { handleError, HttpError, requireUser } from "@/lib/auth";

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { prompt?: string };
    const prompt = String(body.prompt ?? "").trim().slice(0, 120);
    if (!prompt) throw new HttpError(400, "Describe the picture you want to generate.");

    const seed = [...prompt].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const hue = seed % 360;
    const accent = (hue + 55) % 360;
    const label = escapeXml(prompt.slice(0, 28));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 72% 54%)"/><stop offset="1" stop-color="hsl(${accent} 78% 42%)"/></linearGradient></defs><rect width="512" height="512" rx="128" fill="url(#g)"/><circle cx="256" cy="220" r="112" fill="white" fill-opacity=".92"/><path d="M112 456c20-96 78-144 144-144s124 48 144 144" fill="white" fill-opacity=".92"/><circle cx="218" cy="215" r="14" fill="hsl(${hue} 55% 28%)"/><circle cx="294" cy="215" r="14" fill="hsl(${hue} 55% 28%)"/><path d="M214 270c26 22 58 22 84 0" fill="none" stroke="hsl(${hue} 55% 28%)" stroke-linecap="round" stroke-width="12"/><title>${label}</title></svg>`;
    const file = new File([svg], "generated-avatar.svg", { type: "image/svg+xml" });
    const blob = await put(`avatars/${user.id}-generated.svg`, file, { access: "public", addRandomSuffix: true });
    const [current] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, user.id)).limit(1);
    await db.update(users).set({ avatarUrl: blob.url }).where(eq(users.id, user.id));
    if (current?.avatarUrl) await del(current.avatarUrl).catch(() => undefined);
    return Response.json({ avatarUrl: blob.url });
  } catch (error) {
    return handleError(error);
  }
}
