"use client";

import { ORBIT_BETA_WARNING } from "@/lib/ai/orbit-info";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isLocalBaseUrl, PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/ai/providers";
import { signOutAction } from "@/lib/auth-actions";
import { useApp, type SettingsTab } from "./AppProvider";
import { Icon, Spinner, type IconName } from "./icons";
import { LogoMark } from "./Logo";
import { btnDanger, btnGhost, btnWhite, cx, inputCls, Modal, Toggle } from "./ui";
import { PrivacyTab, SkillsTab } from "./SecureSettingsTabs";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { Card, TabHeader } from "./settings/parts";
import { HistoryPanel } from "./HistoryPanel";
import { GoalsPanel } from "./GoalsPanel";

type TabMeta = { id: SettingsTab; label: string; icon: IconName; summary: string };

const TAB_GROUPS: { label: string; items: TabMeta[] }[] = [
  {
    label: "Setup",
    items: [
      { id: "ai", label: "AI Provider", icon: "sparkles", summary: "The model behind your bots" },
      { id: "computer", label: "Computer", icon: "monitor", summary: "The desktop bots work on" },
      { id: "preferences", label: "Preferences", icon: "sliders", summary: "Motion, voice and feel" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "connections", label: "Connections", icon: "link", summary: "Accounts your bots can use" },
      { id: "skills", label: "Skills", icon: "sparkles", summary: "Reusable instructions and grants" },
      { id: "goals", label: "Goals", icon: "target", summary: "One list every bot can see" },
      { id: "privacy", label: "Privacy Mode", icon: "lock", summary: "Private moments, bot hands off" },
    ],
  },
  {
    label: "You",
    items: [
      { id: "account", label: "Account", icon: "pencil", summary: "Name, photo and password" },
      { id: "artifacts", label: "Artifacts", icon: "archive", summary: "Everything your bots made" },
      { id: "history", label: "History", icon: "clock", summary: "Conversations you cleared" },
      { id: "data", label: "Data", icon: "database", summary: "Export or clear everything" },
    ],
  },
];

const ALL_TABS = TAB_GROUPS.flatMap((group) => group.items);

export function SettingsDialog() {
  const app = useApp();
  const pathname = usePathname();
  const currentBotId = pathname.match(/\/bots\/([^/]+)/)?.[1] ?? null;
  const [tab, setTab] = useState<SettingsTab>(app.settingsTab ?? "ai");
  const [query, setQuery] = useState("");

  // Filtering the rail is how people find a setting they cannot name a home
  // for ("where do I change my photo"). Matches the label or the summary.
  const needle = query.trim().toLowerCase();
  const groups = needle
    ? TAB_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => `${item.label} ${item.summary} ${item.id === "ai" ? "orbit local beta gemma model" : ""}`.toLowerCase().includes(needle)),
      })).filter((group) => group.items.length)
    : TAB_GROUPS;
  const meta = ALL_TABS.find((item) => item.id === tab);

  return (
    <Modal onClose={app.closeSettings} width={900} label="Settings">
      <div className="flex h-[min(680px,calc(100dvh-2rem))] flex-col md:flex-row">
        <nav className="shrink-0 border-b border-white/[0.06] md:flex md:min-h-0 md:w-[248px] md:flex-col md:border-b-0 md:border-r">
          {/* On a phone the nav is a scrolling strip, so it needs a title of its own
              and an edge that hints there is more to the right. */}
          <div className="flex items-center gap-2 px-4 pb-1 pt-3.5 md:mb-2 md:px-2.5 md:pb-2 md:pt-1.5">
            <LogoMark size={20} />
            <h2 className="text-[14px] font-semibold tracking-tight">Settings</h2>
          </div>
          <div className="px-2.5 pb-2">
            <label className="relative block">
              <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a setting"
                aria-label="Find a setting"
                className={cx(inputCls, "h-8 py-0 pl-8 text-[12.5px]")}
              />
            </label>
          </div>
          <div className="flex gap-1 overflow-x-auto p-2.5 pt-1.5 [mask-image:linear-gradient(to_right,transparent,black_6px,black_calc(100%-18px),transparent)] [scrollbar-width:none] md:min-h-0 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto md:overflow-x-hidden md:p-0 md:[mask-image:none]">
          {groups.map((group) => (
            <div key={group.label} className="contents md:block">
              <div className="hidden px-3 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-[0.09em] text-neutral-600 md:block">
                {group.label}
              </div>
              {group.items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    "relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[13px] transition md:mx-2",
                    tab === t.id ? "bg-white/[0.08] text-white" : "text-neutral-400 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  <Icon name={t.icon} size={15} className={cx("shrink-0", tab === t.id ? "text-[#a8c0ff]" : "text-neutral-500")} />
                  {t.label}
                  {t.id === "ai" && !app.settings.hasAiKey && !app.settings.preferOrbitLocal && <span className="ml-auto size-1.5 rounded-full bg-amber-400" />}
                  {t.id === "ai" && (app.settings.hasAiKey || app.settings.preferOrbitLocal) && <span className="ml-auto size-1.5 rounded-full bg-emerald-400" />}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <p className="px-3 py-4 text-[12.5px] text-neutral-600">No setting matches “{query}”.</p>}
          </div>
          <div className="mt-auto hidden px-2.5 pb-2 pt-4 text-[11px] leading-snug text-neutral-600 md:block">
            Keys are encrypted at rest and only used to talk to your provider.
          </div>
        </nav>
        <div className="relative min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          <button onClick={app.closeSettings} aria-label="Close settings" className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white">
            <Icon name="close" size={16} />
          </button>
          {meta && (
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-600">
              <Icon name={meta.icon} size={11} />
              {meta.label}
              <span className="ml-1 normal-case tracking-normal text-neutral-700">· {meta.summary}</span>
            </div>
          )}
          {tab === "ai" && <AiTab />}
          {tab === "computer" && <ComputerTab />}
          {tab === "preferences" && <PreferencesTab />}
          {tab === "account" && <AccountTab />}
          {tab === "data" && <DataTab />}
          {tab === "connections" && <ConnectionsPanel />}
          {tab === "skills" && <SkillsTab botId={currentBotId} />}
          {tab === "goals" && (
            <div className="fade-up">
              <h3 className="text-[18px] font-semibold tracking-tight text-white">Goals</h3>
              <p className="mb-4 mt-1 max-w-[540px] text-[13.5px] leading-relaxed text-neutral-400">
                One list, seen by every Bot. Anything here is in the mind of whichever Bot you are talking to, and a Bot can add or tick off a goal as it works.
              </p>
              <GoalsPanel />
            </div>
          )}
          {tab === "privacy" && <PrivacyTab botId={currentBotId} />}
          {tab === "artifacts" && <ArtifactsPanel />}
          {tab === "history" && <HistoryPanel botId={currentBotId} />}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Tab shell: title, one-line purpose, then the tab's content. Every tab goes
 * through this so the type scale and the rhythm between blocks are identical.
 */
function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="fade-up">
      <TabHeader title={title} desc={desc ?? ""} />
      <div className="max-w-[600px] space-y-3.5">{children}</div>
    </div>
  );
}

function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <div className="text-[13px] font-medium text-neutral-200">{children}</div>
      {hint && <div className="mt-0.5 text-[12px] text-neutral-500">{hint}</div>}
    </div>
  );
}

function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className={cx("flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px]", ok ? "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300" : "border-white/[0.08] bg-white/[0.03] text-neutral-400")}>
      <span className={cx("size-2 rounded-full", ok ? "bg-emerald-400" : "bg-neutral-600")} />
      {children}
    </div>
  );
}

function SecretInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        className={cx(inputCls, "pr-16 font-mono text-[13px]")}
      />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[12px] text-neutral-400 transition hover:text-white">
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

/* ----------------------------------- AI ----------------------------------- */
function AiTab() {
  const app = useApp();
  const s = app.settings;
  const [key, setKey] = useState("");
  const [mode, setMode] = useState<string>(s.preferOrbitLocal ? "orbit-local" : s.aiProviderMode || "auto");
  const [reasoning, setReasoning] = useState<"off" | "low" | "medium" | "high">(s.reasoning ?? "off");
  const [baseUrl, setBaseUrl] = useState(s.aiBaseUrl);
  /**
   * A base URL pointing at this machine. Ollama and LM Studio ship with no key,
   * so the save button must not sit disabled waiting for one that will never be
   * typed. Matches the check the API route makes, deliberately: the two must
   * agree or the button enables a save the server rejects.
   */
  // Same predicate the server and the settings row use; see `isLocalBaseUrl`.
  const localBase = isLocalBaseUrl(baseUrl);
  const [model, setModel] = useState(s.defaultModel ?? "");
  const [imageModel, setImageModel] = useState(s.imageModel ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [advanced, setAdvanced] = useState(!!s.aiBaseUrl || s.aiProviderMode === "custom");

  useEffect(() => {
    if (!s.hasAiKey) return;
    fetch("/api/models")
      .then((r) => r.json())
      .then((j) => setModels(j.models ?? []))
      .catch(() => {});
  }, [s.hasAiKey]);

  // Whether reasoning can actually run here. Checked when a level is chosen, so
  // the panel can say "not installed" instead of letting the user pay for a
  // setting that silently does nothing.
  const [reason, setReason] = useState<{ ok: boolean; detail: string; callsPerReply: number } | null>(null);
  useEffect(() => {
    if (reasoning === "off") return;
    const controller = new AbortController();
    fetch("/api/settings/reasoning", { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => { if (!controller.signal.aborted) setReason({ ok: !!j.ok, detail: String(j.detail ?? ""), callsPerReply: Number(j.callsPerReply ?? 0) }); })
      .catch(() => { if (!controller.signal.aborted) setReason(null); });
    return () => controller.abort();
  }, [reasoning, s.hasAiKey]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, mode, baseUrl, model }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't verify that key.");
      app.setSettings(j.settings);
      setModels(j.models ?? []);
      setModel(j.settings.defaultModel ?? "");
      setImageModel(j.settings.imageModel ?? "");
      setKey("");
      setMsg({ ok: true, text: `Connected to ${j.detected}${j.models?.length ? ` · ${j.models.length} models available` : ""}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't verify that key." });
    } finally {
      setBusy(false);
    }
  }

  async function selectOrbitLocal() {
    const ok = await app.confirm({ title: "Orbit Local — Beta report", body: ORBIT_BETA_WARNING, confirmLabel: "Use Orbit Local Beta" });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferOrbitLocal: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not select Orbit Local.");
      app.setSettings(data);
      setMode("orbit-local");
      setMsg({ ok: true, text: "Orbit Local Beta is selected for new chats. The model downloads on first use, not now." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not select Orbit Local." });
    } finally { setBusy(false); }
  }

  async function useHostedProvider() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferOrbitLocal: false }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not switch providers.");
      app.setSettings(data);
      setMode(data.aiProviderMode || "auto");
      setMsg({ ok: true, text: "Hosted provider selected for new chats." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not switch providers." });
    } finally { setBusy(false); }
  }

  async function selectFreeCloud(provider: "kilo-free" | "kilo-gemma-free" | "ovh-free") {
    const kilo = provider !== "ovh-free";
    const name = provider === "kilo-gemma-free" ? "Gemma via Kilo" : kilo ? "Kilo" : "OVHcloud";
    const ok = await app.confirm({
      title: `Use ${name}'s anonymous cloud AI?`,
      body: `This sends your prompts, conversation context, tool definitions and results to ${name}${kilo ? " and its model providers; some free models may collect data" : ""}. Anonymous usage is rate-limited and availability can change; it is not unlimited. Switching replaces and removes any saved personal AI key. Continue?`,
      confirmLabel: `Use ${name}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: provider }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not configure free cloud AI.");
      app.setSettings(data.settings);
      setModels(data.models ?? []);
      setModel(data.settings.defaultModel ?? "");
      setMode("auto");
      setBaseUrl("");
      setReasoning("off");
      setKey("");
      setMsg({ ok: true, text: `${name} configured. Availability is not yet verified; try a chat.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not configure free cloud AI." });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!(await app.confirm({ title: s.usingFreeCloud ? "Stop using free cloud AI?" : "Remove AI key?", body: "Your bots will use included AI if it is configured; otherwise add a key to resume chatting.", confirmLabel: "Remove", danger: true }))) return;
    const res = await fetch("/api/settings/ai", { method: "DELETE" });
    const j = await res.json();
    if (res.ok) {
      app.setSettings(j.settings);
      setModels([]);
      setModel("");
      setMsg(null);
    }
  }

  return (
    <Section title="AI Provider" desc="Use the deployment’s included AI when available, or connect your own provider. Included AI is hosted by the deployment operator; availability and privacy depend on that host.">
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3 text-[13px] text-neutral-300">
        <div className="font-medium text-white">Orbit Local <span className="text-amber-300">Beta</span>{s.preferOrbitLocal ? " · Selected" : ""}</div>
        <p className="mt-1 text-[12px] text-neutral-400">Gemma runs in your browser without a model-provider request quota. Experimental; device and download requirements apply.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={selectOrbitLocal} disabled={busy} className={btnWhite}>{s.preferOrbitLocal ? "Review beta report" : "Use Orbit Local Beta"}</button>
          {s.preferOrbitLocal && <button type="button" onClick={useHostedProvider} disabled={busy} className={btnWhite}>Use hosted provider instead</button>}
        </div>
      </div>
      <StatusPill ok={s.hasAiKey}>
        {s.hasAiKey ? (
          <>
            {s.usingIncludedAi || s.usingFreeCloud ? "Configured to use" : "Connected to"} <b className="font-semibold">{s.aiProviderLabel}</b>
            <span className="font-mono text-[12px] opacity-70">{s.usingIncludedAi || s.usingFreeCloud ? "No personal API key required" : s.aiKeyHint}</span>
          </>
        ) : (
          "No hosted provider configured. Orbit Local Beta can be selected above."
        )}
      </StatusPill>

      <div>
        <Label hint={s.hasAiKey && !s.usingIncludedAi && !s.usingFreeCloud ? "Leave blank to keep your saved key." : "sk-…, sk-ant-…, AIza…, gsk_…, xai-…, sk-or-…, nvapi-…"}>API key</Label>
        <SecretInput value={key} onChange={setKey} placeholder={s.hasAiKey && !s.usingIncludedAi && !s.usingFreeCloud ? "Saved — paste a new key to replace it" : "Paste your API key"} label="AI API key" />
      </div>

      <div>
        <Label hint="Auto-detect works for most keys. Override it if yours isn't recognised.">Provider</Label>
        <select
          value={mode}
          onChange={(e) => {
            if (e.target.value === "orbit-local") { void selectOrbitLocal(); return; }
            setMode(e.target.value);
            if (e.target.value === "custom") setAdvanced(true);
          }}
          className={cx(inputCls, "appearance-none")}
          aria-label="Provider"
        >
          <option value="orbit-local">Orbit Local (Beta) — runs in your browser</option>
          <option value="auto">Auto-detect from key</option>
          {PROVIDER_IDS.filter((p) => p !== "kilo-free" && p !== "kilo-gemma-free" && p !== "ovh-free").map((p: ProviderId) => (
            <option key={p} value={p}>
              {p === "custom" ? "OpenAI-compatible (custom base URL)" : PROVIDERS[p].label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <button onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1.5 text-[13px] text-neutral-400 transition hover:text-white">
          <Icon name="chevron" size={14} className={cx("transition", advanced && "rotate-180")} />
          Base URL override
        </button>
        {advanced && (
          <div className="mt-2.5 fade-up">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://your-host.example.com/v1"
              aria-label="Base URL"
              className={cx(inputCls, "font-mono text-[13px]")}
            />
            <p className="mt-1.5 text-[12px] text-neutral-500">
              For any OpenAI-compatible server (Ollama, LM Studio, vLLM, LiteLLM, Azure…). Requests go to <code>{"{base}/chat/completions"}</code>.
              {localBase ? " A server on this machine needs no API key — leave the key field empty." : ""}
            </p>
          </div>
        )}
      </div>

      {s.hasAiKey && (
        <div>
          <Label hint="Used by new bots. You can also pick a model per bot from the chat header.">Default model</Label>
          {s.usingIncludedAi || s.usingFreeCloud ? (
            <p className="text-[13px] text-neutral-300">{s.defaultModel} · {s.usingFreeCloud ? "free route; subject to availability" : "configured by the deployment operator"}</p>
          ) : models.length ? (
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                app.patchSettings({ defaultModel: e.target.value });
              }}
              className={cx(inputCls, "appearance-none")}
              aria-label="Default model"
            >
              {!models.includes(model) && model && <option value={model}>{model}</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => model !== (s.defaultModel ?? "") && app.patchSettings({ defaultModel: model })}
              placeholder="e.g. llama3.1:8b"
              aria-label="Default model"
              className={inputCls}
            />
          )}
          {!s.usingFreeCloud && <div className="mt-3">
            <Label hint="Only needed when your provider serves pictures on a different model.">Image model</Label>
            <input
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value)}
              onBlur={() => imageModel !== (s.imageModel ?? "") && app.patchSettings({ imageModel })}
              placeholder="leave empty to use sensible defaults"
              aria-label="Image model"
              className={inputCls}
            />
          </div>}

          {/* Reasoning. The honest framing matters here: these levels buy
              accuracy with extra model calls on the user's own key, so each one
              says what it costs rather than implying a better model. */}
          {!s.usingFreeCloud && <div className="mt-3">
            <Label hint="Runs your key through OptiLLM. Higher levels make more model calls per reply and cost more.">Reasoning</Label>
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1" role="radiogroup" aria-label="Reasoning level">
              {(["off", "low", "medium", "high"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={reasoning === level}
                  onClick={() => {
                    setReasoning(level);
                    app.patchSettings({ reasoning: level });
                  }}
                  className={cx(
                    "rounded-lg px-2 py-1.5 text-[12px] font-medium capitalize transition",
                    reasoning === level ? "bg-white/[0.09] text-white" : "text-neutral-400 hover:text-white",
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-neutral-500">
              {reasoning === "off"
                ? "Off. Every reply comes straight from your model, one call."
                : reasoning === "low"
                  ? "Low. Reads the question twice before answering — 2 calls per reply."
                  : reasoning === "medium"
                    ? "Medium. Plans, then answers with reflection — 6 calls per reply."
                    : "High. Several agents answer, the best are kept, the majority wins — 11 calls per reply."}
              {reasoning !== "off"
                ? " A reply that uses tools always runs direct, with no extra calls — reasoning only pays for itself when the model is thinking, not when it is acting."
                : ""}
            </p>
            {reasoning !== "off" && reason && (
              <p
                className={cx(
                  "mt-1.5 flex items-start gap-1.5 text-[12px]",
                  reason.ok ? "text-emerald-400/90" : "text-amber-400/90",
                )}
              >
                <span aria-hidden className="mt-[3px] size-1.5 shrink-0 rounded-full bg-current" />
                <span>{reason.detail}</span>
              </p>
            )}
          </div>}
        </div>
      )}

      {s.usingFreeCloud && <p className="text-[12px] text-neutral-400">Anonymous cloud AI is rate-limited, not unlimited. Conversation and tool context go to {s.aiProvider !== "ovh-free" ? "Kilo and its model providers" : "OVHcloud"}. <a className="underline" href={s.aiProvider !== "ovh-free" ? "https://kilo.ai/docs/gateway/usage-and-billing" : "https://help.ovhcloud.com/csm/en-public-cloud-ai-endpoints-getting-started?id=kb_article_view&sysparm_article=KB0065403"} target="_blank" rel="noreferrer">Provider policy</a></p>}
      {msg && <p className={cx("text-[13px]", msg.ok ? "text-emerald-400" : "text-[#ff6b7a]")}>{msg.text}</p>}

      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={save} disabled={busy || mode === "orbit-local" || (!key.trim() && (!s.hasAiKey || s.usingIncludedAi || s.usingFreeCloud) && !localBase)} className={btnWhite}>
          {busy ? <Spinner size={14} /> : null}
          {s.hasAiKey && !s.usingIncludedAi && !s.usingFreeCloud && !key.trim() ? "Re-verify & save" : "Verify & save"}
        </button>
        {s.aiProvider !== "kilo-free" && <button onClick={() => selectFreeCloud("kilo-free")} disabled={busy} className={btnWhite}>Try Kilo Free</button>}
        {s.aiProvider !== "kilo-gemma-free" && <button onClick={() => selectFreeCloud("kilo-gemma-free")} disabled={busy} className={btnWhite}>Try Gemma via Kilo</button>}
        {s.aiProvider !== "ovh-free" && <button onClick={() => selectFreeCloud("ovh-free")} disabled={busy} className={btnWhite}>Try OVHcloud</button>}
        {s.hasAiKey && !s.usingIncludedAi && (
          <button onClick={remove} className={btnDanger}>
            {s.usingFreeCloud ? "Stop using free cloud" : "Remove key"}
          </button>
        )}
      </div>
    </Section>
  );
}

/* --------------------------------- Computer -------------------------------- */
function ComputerTab() {
  const app = useApp();
  const s = app.settings;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/e2b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't verify that key.");
      app.setSettings(j.settings);
      setKey("");
      setMsg({ ok: true, text: "E2B key verified. Your bots can now use their own computer." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't verify that key." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await app.confirm({ title: "Remove E2B key?", body: "Bots will no longer be able to browse or run code. Running computers shut down on their own.", confirmLabel: "Remove", danger: true }))) return;
    const res = await fetch("/api/settings/e2b", { method: "DELETE" });
    const j = await res.json();
    if (res.ok) {
      app.setSettings(j.settings);
      setMsg(null);
    }
  }

  return (
    <Section title="Computer" desc="Each bot gets its own cloud desktop (Linux + Chrome) powered by your E2B account, so it can browse, research, run code and create files.">
      <StatusPill ok={s.hasE2bKey}>
        {s.hasE2bKey ? (
          <>
            E2B connected <span className="font-mono text-[12px] opacity-70">{s.e2bKeyHint}</span>
          </>
        ) : (
          "No E2B key. Chat works, but bots won't have a computer."
        )}
      </StatusPill>
      <div>
        <Label hint="Starts with e2b_. Get one from your E2B dashboard.">E2B API key</Label>
        <SecretInput value={key} onChange={setKey} placeholder={s.hasE2bKey ? "Saved — paste a new key to replace it" : "e2b_…"} label="E2B API key" />
      </div>
      {msg && <p className={cx("text-[13px]", msg.ok ? "text-emerald-400" : "text-[#ff6b7a]")}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy || !key.trim()} className={btnWhite}>
          {busy ? <Spinner size={14} /> : null}
          Verify & save
        </button>
        <a href="https://e2b.dev/dashboard?tab=keys" target="_blank" rel="noreferrer" className={btnGhost}>
          Open E2B dashboard
        </a>
        {s.hasE2bKey && (
          <button onClick={remove} className={btnDanger}>
            Remove key
          </button>
        )}
      </div>
    </Section>
  );
}

/* -------------------------------- Preferences ------------------------------- */
function PreferencesTab() {
  const app = useApp();
  const s = app.settings;
  const rows: { key: "followMouse" | "animations" | "voiceReplies"; title: string; desc: string }[] = [
    { key: "followMouse", title: "Eyes follow your mouse", desc: "Bots watch your cursor wherever it goes." },
    { key: "animations", title: "Animations", desc: "Shape morphing, bursts and thinking animations. Turn off for a calmer interface." },
    { key: "voiceReplies", title: "Read replies aloud", desc: "Uses your browser's text-to-speech when a bot finishes replying." },
  ];
  return (
    <Section title="Preferences" desc="How the app looks and moves. These follow you to every device.">
      <Card title="Appearance" desc="Choose a side. System follows your device." icon={<Icon name="sparkles" size={15} />}>
        <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-2">
          {([
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
            { id: "system", label: "System" },
          ] as const).map((option) => {
            const active = (s.theme ?? "dark") === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => app.patchSettings({ theme: option.id })}
                className={cx(
                  "group overflow-hidden rounded-xl border p-1.5 text-left transition",
                  active ? "border-white/25 ring-1 ring-white/20" : "border-white/[0.07] hover:border-white/15",
                )}
              >
                {/* A miniature of the app in each mode, so the choice is visual.
                    Fixed-size swatches inside a fixed-height frame: percentage
                    children in a flex row grew past the frame whenever the dark
                    gradient reset their background-size. Nothing here depends on
                    layout, so the three previews always match. */}
                <span
                  aria-hidden
                  className="relative block h-10 w-full overflow-hidden rounded-[7px] ring-1 ring-black/10"
                  style={{ background: option.id === "light" ? "#f2f2f4" : option.id === "dark" ? "#0b0b0e" : undefined }}
                >
                  {option.id === "system" && (
                    <span aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(90deg,#0b0b0e 0 50%,#f2f2f4 50% 100%)" }} />
                  )}
                  {/* Proportion, not decoration: a narrow rail, then a content
                      column that keeps the same ratio as the real shell. */}
                  <span aria-hidden className="absolute inset-y-1.5 left-1.5 w-4 overflow-hidden rounded-[3px]">
                    {option.id === "system" ? (
                      <span aria-hidden className="block size-full" style={{ background: "linear-gradient(90deg,#383841 0 50%,#dcdce2 50% 100%)" }} />
                    ) : (
                      <span aria-hidden className="block size-full" style={{ background: option.id === "light" ? "#dcdce2" : "#383841" }} />
                    )}
                  </span>
                  <span aria-hidden className="absolute inset-y-1.5 left-6 right-1.5 overflow-hidden rounded-[3px]">
                    {option.id === "system" ? (
                      <span aria-hidden className="block size-full" style={{ background: "linear-gradient(90deg,#1a1a1f 0 50%,#e6e6eb 50% 100%)" }} />
                    ) : (
                      <span aria-hidden className="block size-full" style={{ background: option.id === "light" ? "#e6e6eb" : "#22222a" }} />
                    )}
                  </span>
                  {active && (
                    <span aria-hidden className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-white text-[#0b0b0e] shadow-sm">
                      <Icon name="check" size={9} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className={cx("mt-2 flex items-center gap-1.5 px-1 pb-0.5 text-[12px]", active ? "text-white" : "text-neutral-400")}>
                  <span className={cx("size-1.5 shrink-0 rounded-full", active ? "bg-[#7c9bff]" : "bg-transparent")} />
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <Card>
        <div className="divide-y divide-white/[0.05]">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-white">{r.title}</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-500">{r.desc}</div>
              </div>
              <Toggle checked={s[r.key]} onChange={(v) => app.patchSettings({ [r.key]: v })} label={r.title} />
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

/* ---------------------------------- Account --------------------------------- */
function AccountTab() {
  const app = useApp();
  const [name, setName] = useState(app.user.displayName);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function uploadAvatar(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const supported = ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension) || ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type);
    if (!supported) {
      setErr("This image is not supported.");
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/account/avatar", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't upload that image.");
      app.setUserAvatar(json.avatarUrl);
      app.toast("Profile picture updated.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't upload that image.");
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    setRemoving(true);
    setErr(null);
    try {
      const res = await fetch("/api/account/avatar", { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't remove your picture.");
      app.setUserAvatar(null);
      app.toast("Profile picture removed.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't remove your picture.");
    } finally {
      setRemoving(false);
    }
  }

  async function call(kind: string, body: unknown, method = "PATCH") {
    setBusy(kind);
    setErr(null);
    try {
      const res = await fetch("/api/account", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");

  async function deleteAccount() {
    if (await call("delete", { password: deletePw }, "DELETE")) {
      window.location.assign("/login");
    }
  }

  return (
    <Section title="Account">
      <div>
        <Label hint="JPG, PNG, WebP or HEIC, up to 5 MB.">Profile picture</Label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#3a3f66] to-[#1d2038] text-lg font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded blob of unknown size */}
            {app.user.avatarUrl ? <img src={app.user.avatarUrl} alt="Your profile" className="size-full object-cover" /> : (app.user.displayName || app.user.email).charAt(0).toUpperCase()}
          </div>
          <label className={cx(btnGhost, "cursor-pointer focus-within:ring-2 focus-within:ring-white/40", (uploading || removing) && "pointer-events-none opacity-50")}>
            {uploading ? "Uploading…" : app.user.avatarUrl ? "Change picture" : "Choose picture"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" disabled={uploading || removing} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAvatar(file); e.currentTarget.value = ""; }} />
          </label>
          {app.user.avatarUrl && (
            <button type="button" onClick={() => void removeAvatar()} disabled={uploading || removing} className="rounded-full px-3 py-2 text-[13px] text-neutral-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
              {removing ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      </div>
      <div>
        <Label>Email</Label>
        <input value={app.user.email} readOnly aria-label="Email" className={cx(inputCls, "text-neutral-400")} />
      </div>
      <div>
        <Label>Display name</Label>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Display name" className={inputCls} />
          <button
            className={btnGhost}
            disabled={busy === "name" || !name.trim() || name.trim() === app.user.displayName}
            onClick={async () => {
              if (await call("name", { displayName: name })) {
                app.setUserName(name.trim());
                app.toast("Name updated.");
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div>
        <Label>Change password</Label>
        <div className="space-y-2">
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" aria-label="Current password" autoComplete="current-password" className={inputCls} />
          <div className="flex gap-2">
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+ characters)" aria-label="New password" autoComplete="new-password" className={inputCls} />
            <button
              className={btnGhost}
              disabled={busy === "pw" || !cur || next.length < 8}
              onClick={async () => {
                if (await call("pw", { currentPassword: cur, newPassword: next })) {
                  setCur("");
                  setNext("");
                  app.toast("Password changed.");
                }
              }}
            >
              Update
            </button>
          </div>
        </div>
      </div>
      {err && <p className="text-[13px] text-[#ff6b7a]">{err}</p>}
      <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-5">
        <form action={signOutAction}>
          <button type="submit" className={btnGhost}>
            Sign out
          </button>
        </form>
        <button onClick={() => { setDeletePw(""); setDeleteOpen(true); }} className={btnDanger}>
          Delete account
        </button>
      </div>

      {deleteOpen && (
        <Modal onClose={() => setDeleteOpen(false)} width={420} label="Delete account">
          <div className="p-6">
            <h3 className="text-[16px] font-semibold tracking-tight text-white">Delete your account?</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-neutral-400">
              Every bot, conversation and artifact goes with it. This can&apos;t be undone.
            </p>
            <input
              type="password"
              value={deletePw}
              onChange={(e) => setDeletePw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && deletePw && void deleteAccount()}
              placeholder="Your password"
              aria-label="Password"
              autoComplete="current-password"
              autoFocus
              className={cx(inputCls, "mt-4")}
            />
            {err && <p className="mt-2 text-[12px] text-[#ff9aa5]">{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setDeleteOpen(false)}>
                Keep my account
              </button>
              <button className={btnDanger} disabled={!deletePw || busy === "delete"} onClick={() => void deleteAccount()}>
                {busy === "delete" ? "Deleting…" : "Delete everything"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Section>
  );
}

/* ----------------------------------- Data ----------------------------------- */
function DataTab() {
  const app = useApp();
  const router = useRouter();
  return (
    <Section title="Data" desc="Your bots and conversations are saved to your account in the cloud, separate from everyone else's.">
      <Card title="Export everything" desc="Download all bots, conversations and goals as one JSON file." icon={<Icon name="download" size={15} />} action={
        <a href="/api/export" className={btnGhost}>
          <Icon name="download" size={15} /> Export
        </a>
      } />
      <Card
        tone="danger"
        title="Clear all conversations"
        desc="Keeps your bots and their settings, removes every message in every thread."
        icon={<Icon name="trash" size={15} />}
        action={
        <button
          className={btnDanger}
          onClick={async () => {
            if (!(await app.confirm({ title: "Clear all conversations?", body: "Every message with every bot will be deleted.", confirmLabel: "Clear all", danger: true }))) return;
            const res = await fetch("/api/export", { method: "DELETE" });
            if (res.ok) {
              app.toast("Conversations cleared.");
              router.push("/bots");
              router.refresh();
            }
          }}
        >
          Clear
        </button>
        }
      />
    </Section>
  );
}
