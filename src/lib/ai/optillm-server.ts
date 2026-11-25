import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkHealth, proxyEnv, proxyUrlFrom, type OptillmConfig } from "./optillm";

/**
 * Running the OptiLLM proxy alongside this app.
 *
 * One proxy per provider, keyed by a hash of the provider and base URL — not by
 * the key itself, so a rotated key reuses the same process and the environment
 * is refreshed by restarting it. The process is started once and reused: it
 * loads torch on import, which takes several seconds, and paying that on every
 * turn would cost more time than the reasoning saves.
 *
 * Honest failure matters more here than elsewhere. If Python or the package is
 * missing, this reports exactly that and returns nothing, so the caller can send
 * the turn straight to the provider instead of hanging on a proxy that will
 * never answer.
 */

/**
 * The launcher, as Python. Argv is rebuilt because `-c` makes every argument
 * program text: the real flags arrive after `--` in sys.argv.
 */
const LAUNCH = [
  "import sys",
  "argv = sys.argv",
  "sep = argv.index('--') if '--' in argv else len(argv)",
  "sys.argv = ['optillm'] + argv[sep + 1:]",
  "from optillm import main",
  "sys.exit(main())",
].join("\n");

type Slot = {
  child: ChildProcess;
  url: string;
  key: string;
  startedAt: number;
  ready: boolean;
};

// Global so a dev-mode reload does not leak a process per compile.
const globalSlots = globalThis as unknown as { __optillmSlots?: Map<string, Slot> };
const slots = (globalSlots.__optillmSlots ??= new Map<string, Slot>());

function slotKey(cfg: OptillmConfig): string {
  // The provider and address, never the secret.
  return `${cfg.provider}|${cfg.baseUrl}`.toLowerCase();
}

/**
 * The interpreter that has optillm installed.
 *
 * OPTILLM_PYTHON picks the interpreter, and OPTILLM_PYTHONPATH is passed through
 * to it — needed when optillm lives in a virtualenv or a --target directory
 * rather than the system site-packages. Neither is required when `python3 -c
 * "import optillm"` already works.
 */
export function pythonBinary(): string {
  return process.env.OPTILLM_PYTHON ?? "python3";
}

function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (process.env.OPTILLM_PYTHONPATH) {
    const inherited = process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : "";
    env.PYTHONPATH = `${process.env.OPTILLM_PYTHONPATH}${inherited}`;
  }
  return env;
}

/** Is the optillm package importable, and which version? Cached for the process. */
const globalProbe = globalThis as unknown as { __optillmProbe?: Promise<{ ok: boolean; detail: string }> };
export function probePython(): Promise<{ ok: boolean; detail: string }> {
  if (globalProbe.__optillmProbe) return globalProbe.__optillmProbe;
  globalProbe.__optillmProbe = new Promise((resolve) => {
    const child = spawn(pythonBinary(), ["-c", "import optillm; print(getattr(optillm, '__version__', 'installed'))"], {
      timeout: 20_000,
      env: childEnv({}),
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => resolve({ ok: false, detail: e.message.slice(0, 160) }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, detail: out.trim() || "installed" });
      else resolve({ ok: false, detail: (err.trim() || `exit ${code}`).slice(0, 160) });
    });
  });
  return globalProbe.__optillmProbe;
}

/**
 * Start (or reuse) a proxy for this account and wait until it answers.
 *
 * `port` comes from the caller because two accounts on one machine must not
 * fight over 8000, and a busy port must not be read as "the proxy is broken".
 */
export async function ensureProxy(
  cfg: OptillmConfig,
  opts: { port: number; timeoutMs?: number },
): Promise<{ url: string } | { error: string }> {
  const url = proxyUrlFrom(process.env.OPTILLM_URL ?? null);
  // A user-managed proxy wins: never start a second one over theirs.
  if (process.env.OPTILLM_URL) {
    const health = await checkHealth(url);
    return health.up ? { url } : { error: `OPTILLM_URL is set to ${url} but nothing answered (${health.detail})` };
  }

  // Only a proxy this process started may be adopted. A plain health check
  // would also succeed against somebody else's proxy sitting on the same port —
  // another account's, with another account's key in its environment — and
  // routing this user's turn through it would send their prompt to it and bill
  // them for a reply the other process produced. So the check is "is this the
  // child we spawned, still alive", not "does something answer".
  const key = slotKey(cfg);
  const existing = slots.get(key);
  if (existing) {
    const alive = existing.child.exitCode === null && existing.key === cfg.apiKey;
    if (alive) {
      const health = await checkHealth(existing.url);
      if (health.up) return { url: existing.url };
    }
    // Dead, stale-keyed, or not answering: replace rather than trust.
    stopSlot(key);
  }

  const probe = await probePython();
  if (!probe.ok) {
    return {
      error:
        `OptiLLM is not installed for ${pythonBinary()} (${probe.detail}). ` +
        `Install it once with: ${pythonBinary()} -m pip install optillm`,
    };
  }

  // If our port is occupied by something we did not start, spawning a proxy
  // there would produce a process that dies on bind while the health loop
  // happily talks to the stranger. Say so plainly and let the turn run direct.
  const squatter = await checkHealth(`http://127.0.0.1:${opts.port}/v1`);
  if (squatter.up) {
    return {
      error:
        `Port ${opts.port} already has an OptiLLM proxy running that this app did not start. ` +
        `Set OPTILLM_URL to that address if it is yours, or OPTILLM_PORT to a free port.`,
    };
  }

  try {
    mkdirSync(join(homedir(), ".optillm"), { recursive: true });
  } catch {
    /* a read-only home is fine: the proxy can keep its state elsewhere */
  }

  // Neither `python -m optillm` nor `-m optillm.__main__` exists: the
  // distribution only exposes a console script whose entry point is
  // `optillm:main`. Invoking that same function with a constructed argv is
  // exactly what the script does, and it does not depend on the script having
  // been put on PATH.
  const child = spawn(
    pythonBinary(),
    ["-c", LAUNCH, "--", "--port", String(opts.port), "--base-url", cfg.baseUrl],
    {
    env: {
      ...childEnv(proxyEnv(cfg)),
      // Keep any downloaded artefacts off the system site-packages.
      HF_HOME: join(homedir(), ".optillm", "hf"),
      TRANSFORMERS_CACHE: join(homedir(), ".optillm", "hf"),
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let log = "";
  const capture = (d: Buffer) => {
    log = (log + d.toString()).slice(-2000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  const slot: Slot = { child, url, key: cfg.apiKey, startedAt: Date.now(), ready: false };
  slots.set(key, slot);
  child.on("exit", () => {
    if (slots.get(key) === slot) slots.delete(key);
  });

  // Wait for it to answer. Import alone can take 10 s on a cold torch install,
  // and the first call is slower still, so this is generous but bounded.
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return { error: `OptiLLM exited while starting (code ${child.exitCode}): ${log.slice(-400)}` };
    }
    const health = await checkHealth(url, undefined, 1500);
    if (health.up) {
      slot.ready = true;
      return { url };
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  stopSlot(key);
  return { error: `OptiLLM did not answer within ${Math.round((opts.timeoutMs ?? 90_000) / 1000)}s. ${log.slice(-300)}` };
}

function stopSlot(key: string) {
  const slot = slots.get(key);
  if (!slot) return;
  slots.delete(key);
  try {
    slot.child.kill("SIGTERM");
    // A proxy that ignores SIGTERM would otherwise hold the port for the next
    // start; torch installs are not always quick to unwind.
    setTimeout(() => {
      if (slot.child.exitCode === null) slot.child.kill("SIGKILL");
    }, 4000).unref?.();
  } catch {
    /* already gone */
  }
}

export function stopAllProxies() {
  for (const key of [...slots.keys()]) stopSlot(key);
}

/** What the chat can say about the proxy, for the trace line. */
export async function proxyStatus(cfg: OptillmConfig, port: number) {
  const probe = await probePython();
  if (!probe.ok) return { available: false, detail: probe.detail };
  const url = proxyUrlFrom(process.env.OPTILLM_URL ?? null);
  const health = await checkHealth(url);
  return { available: health.up || !!process.env.OPTILLM_URL, detail: health.detail, port };
}
