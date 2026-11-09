import "server-only";
import { Sandbox } from "@e2b/desktop";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bots } from "@/db/schema";

const TIMEOUT_MS = 20 * 60_000;

export type BotRef = { id: string; sandboxId: string | null };

/** Reconnect to the bot's computer if it is still alive. Never creates one. */
export async function connectDesktop(bot: BotRef, apiKey: string): Promise<Sandbox | null> {
  if (!bot.sandboxId) return null;
  try {
    const sb = await Sandbox.connect(bot.sandboxId, { apiKey });
    await sb.setTimeout(TIMEOUT_MS).catch(() => {});
    return sb;
  } catch {
    await db.update(bots).set({ sandboxId: null }).where(eq(bots.id, bot.id));
    bot.sandboxId = null;
    return null;
  }
}

/** Reconnect, or boot a fresh desktop for this bot. */
export async function ensureDesktop(bot: BotRef, apiKey: string): Promise<{ sb: Sandbox; fresh: boolean }> {
  const existing = await connectDesktop(bot, apiKey);
  if (existing) return { sb: existing, fresh: false };
  const sb = await Sandbox.create({
    apiKey,
    resolution: [1024, 768],
    dpi: 96,
    timeoutMs: TIMEOUT_MS,
  });
  bot.sandboxId = sb.sandboxId;
  await db.update(bots).set({ sandboxId: sb.sandboxId }).where(eq(bots.id, bot.id));
  return { sb, fresh: true };
}

export async function shot(sb: Sandbox): Promise<string | null> {
  try {
    const bytes = await sb.screenshot();
    return Buffer.from(bytes).toString("base64");
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep };

export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return "about:blank";
  if (/^(https?:|about:|file:)/i.test(t)) return t;
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return `https://${t}`;
  if (/^localhost(:\d+)?(\/.*)?$/.test(t)) return `http://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Opens a URL in the desktop's browser (starts it if needed). */
export async function openInBrowser(sb: Sandbox, url: string): Promise<void> {
  const target = normalizeUrl(url);
  const script = `
B=$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || command -v firefox || true)
if [ -z "$B" ]; then xdg-open ${shq(target)} >/dev/null 2>&1 & exit 0; fi
case "$B" in
  *firefox*) FLAGS="" ;;
  *) FLAGS="--no-sandbox --no-first-run --no-default-browser-check --disable-dev-shm-usage --start-maximized" ;;
esac
(setsid nohup "$B" $FLAGS ${shq(target)} >/tmp/browser.log 2>&1 &)
exit 0`;
  await sb.commands.run(script, { timeoutMs: 20_000 });
}

export async function restartBrowser(sb: Sandbox): Promise<void> {
  await sb.commands
    .run("pkill -f chrome; pkill -f chromium; pkill firefox; sleep 1; exit 0", { timeoutMs: 15_000 })
    .catch(() => {});
}
