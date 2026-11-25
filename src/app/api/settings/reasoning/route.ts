import { requireUser } from "@/lib/auth";
import { aiConfigFrom, getSettings } from "@/lib/settings";
import { proxyUrlFrom, checkHealth } from "@/lib/ai/optillm";
import { probePython } from "@/lib/ai/optillm-server";
import type { Reasoning } from "@/lib/ai/optillm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Is reasoning actually going to work for this account?
 *
 * The settings panel offers Low / Medium / High and tells the user what each
 * one costs. It never said whether the machinery behind them existed, so a
 * user could pick High, pay nothing, and get ordinary replies with one line of
 * explanation buried in the transcript — or pick High against a machine with no
 * Python and be told so only after a turn they had already written.
 *
 * This answers the question before they choose: is the package installed, is a
 * proxy answering, and where. It runs no inference and costs nothing.
 */
export async function GET() {
  const user = await requireUser();
  const settings = await getSettings(user.id);
  const cfg = aiConfigFrom(settings);
  const reasoning = (settings.reasoning ?? "off") as Reasoning;

  const override = (process.env.OPTILLM_URL ?? "").trim();
  const url = proxyUrlFrom(override || null);
  const health = await checkHealth(url);
  const probe = await probePython();

  // `simulate` is false when this deployment cannot run a proxy at all: no key
  // for the account, or a provider OptiLLM cannot speak to.
  const hasKey = !!cfg?.apiKey;
  const usable = hasKey && (override ? health.up : probe.ok);
  const level = reasoning === "off" ? null : reasoning;
  const calls = level === "low" ? 2 : level === "medium" ? 5 : level === "high" ? 10 : 0;

  // Order matters. A proxy answering on the default port proves nothing when
  // this deployment cannot start its own: the turn would be sent to somebody
  // else's process, or refused as a squatter. So a managed proxy is only
  // "connected" when OPTILLM_URL names it; without that, Python has to exist.
  const detail = !hasKey
    ? "Add an AI key first — reasoning runs the same key through the proxy."
    : override
      ? health.up
        ? `Connected to the OptiLLM proxy at ${url}.`
        : `OPTILLM_URL is set to ${url} but nothing answered (${health.detail}).`
      : probe.ok
        ? health.up
          ? `OptiLLM is installed here and answering on ${url.replace(/^https?:\/\//, "").replace(/\/v1$/, "")}.`
          : "OptiLLM is installed. A proxy starts on the first reply that needs one."
        : health.up
          ? `Something is answering on ${url.replace(/^https?:\/\//, "").replace(/\/v1$/, "")} that this app did not start, and OptiLLM is not installed for it (${probe.detail.slice(0, 100)}). If that proxy is yours, set OPTILLM_URL to it.`
          : `OptiLLM is not installed for this deployment (${probe.detail.slice(0, 120)}). Set OPTILLM_URL to a proxy you run, or install it with: python3 -m pip install optillm`;

  return Response.json({
    ok: usable,
    // What the user is actually getting right now, not what they selected.
    level,
    callsPerReply: calls,
    proxy: { url, up: health.up, managed: !!override, detail: health.detail },
    python: probe,
    detail,
  });
}
