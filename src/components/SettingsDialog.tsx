"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "@/lib/ai/providers";
import { signOutAction } from "@/lib/auth-actions";
import { useApp, type SettingsTab } from "./AppProvider";
import { Icon, Spinner } from "./icons";
import { btnDanger, btnGhost, btnWhite, cx, inputCls, Modal, Toggle } from "./ui";

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "ai", label: "AI Provider", icon: "grid" },
  { id: "computer", label: "Computer", icon: "expand" },
  { id: "preferences", label: "Preferences", icon: "gear" },
  { id: "account", label: "Account", icon: "pencil" },
  { id: "data", label: "Data", icon: "download" },
];

export function SettingsDialog() {
  const app = useApp();
  const [tab, setTab] = useState<SettingsTab>(app.settingsTab ?? "ai");

  return (
    <Modal onClose={app.closeSettings} width={780} label="Settings">
      <div className="flex h-[min(620px,calc(100dvh-2rem))] flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/[0.06] p-3 md:w-[210px] md:flex-col md:border-b-0 md:border-r">
          <h2 className="hidden px-3 pb-3 pt-2 text-[15px] font-semibold md:block">Settings</h2>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[13.5px] transition",
                tab === t.id ? "bg-white/[0.09] text-white" : "text-neutral-400 hover:bg-white/[0.05] hover:text-white",
              )}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
              {t.id === "ai" && !app.settings.hasAiKey && <span className="ml-auto size-1.5 rounded-full bg-[#2b8af7]" />}
            </button>
          ))}
          <div className="mt-auto hidden px-3 pb-1 pt-4 text-[11.5px] leading-snug text-neutral-600 md:block">
            Keys are encrypted at rest and only used to talk to your provider.
          </div>
        </nav>
        <div className="relative min-h-0 flex-1 overflow-y-auto p-6">
          <button onClick={app.closeSettings} aria-label="Close settings" className="absolute right-4 top-4 grid size-8 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white">
            <Icon name="close" size={16} />
          </button>
          {tab === "ai" && <AiTab />}
          {tab === "computer" && <ComputerTab />}
          {tab === "preferences" && <PreferencesTab />}
          {tab === "account" && <AccountTab />}
          {tab === "data" && <DataTab />}
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="fade-up">
      <h3 className="text-[18px] font-semibold tracking-tight">{title}</h3>
      {desc && <p className="mt-1 max-w-[520px] text-[13.5px] leading-relaxed text-neutral-400">{desc}</p>}
      <div className="mt-5 space-y-5">{children}</div>
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
  const [mode, setMode] = useState<string>(s.aiProviderMode || "auto");
  const [baseUrl, setBaseUrl] = useState(s.aiBaseUrl);
  const [model, setModel] = useState(s.defaultModel ?? "");
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
      setKey("");
      setMsg({ ok: true, text: `Connected to ${j.detected}${j.models?.length ? ` · ${j.models.length} models available` : ""}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't verify that key." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await app.confirm({ title: "Remove AI key?", body: "Your bots won't be able to reply until you add a key again.", confirmLabel: "Remove", danger: true }))) return;
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
    <Section title="AI Provider" desc="Bring your own key. Paste it and we'll detect the provider automatically — OpenAI, Anthropic, Google AI Studio, OpenRouter, Groq, xAI and more.">
      <StatusPill ok={s.hasAiKey}>
        {s.hasAiKey ? (
          <>
            Connected to <b className="font-semibold">{s.aiProviderLabel}</b>
            <span className="font-mono text-[12px] opacity-70">{s.aiKeyHint}</span>
          </>
        ) : (
          "No key yet. Your bots need one to reply."
        )}
      </StatusPill>

      <div>
        <Label hint={s.hasAiKey ? "Leave blank to keep your saved key." : "sk-…, sk-ant-…, AIza…, gsk_…, xai-…, sk-or-…"}>API key</Label>
        <SecretInput value={key} onChange={setKey} placeholder={s.hasAiKey ? "Saved — paste a new key to replace it" : "Paste your API key"} label="AI API key" />
      </div>

      <div>
        <Label hint="Auto-detect works for most keys. Override it if yours isn't recognised.">Provider</Label>
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            if (e.target.value === "custom") setAdvanced(true);
          }}
          className={cx(inputCls, "appearance-none")}
          aria-label="Provider"
        >
          <option value="auto">Auto-detect from key</option>
          {PROVIDER_IDS.map((p: ProviderId) => (
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
            </p>
          </div>
        )}
      </div>

      {s.hasAiKey && (
        <div>
          <Label hint="Used by new bots. You can also pick a model per bot from the chat header.">Default model</Label>
          {models.length ? (
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
        </div>
      )}

      {msg && <p className={cx("text-[13px]", msg.ok ? "text-emerald-400" : "text-[#ff6b7a]")}>{msg.text}</p>}

      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={save} disabled={busy || (!key.trim() && !s.hasAiKey)} className={btnWhite}>
          {busy ? <Spinner size={14} /> : null}
          {s.hasAiKey && !key.trim() ? "Re-verify & save" : "Verify & save"}
        </button>
        {s.hasAiKey && (
          <button onClick={remove} className={btnDanger}>
            Remove key
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
    <Section title="Preferences">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-6">
          <div>
            <div className="text-[14px] font-medium">{r.title}</div>
            <div className="mt-0.5 text-[12.5px] text-neutral-500">{r.desc}</div>
          </div>
          <Toggle checked={s[r.key]} onChange={(v) => app.patchSettings({ [r.key]: v })} label={r.title} />
        </div>
      ))}
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

  async function uploadAvatar(file: File) {
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

  async function deleteAccount() {
    const pw = window.prompt("Enter your password to permanently delete your account and all data:");
    if (!pw) return;
    if (await call("delete", { password: pw }, "DELETE")) {
      window.location.assign("/login");
    }
  }

  return (
    <Section title="Account">
      <div>
        <Label>Profile picture</Label>
        <div className="flex items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#3a3f66] to-[#1d2038] text-lg font-semibold">
            {app.user.avatarUrl ? <img src={app.user.avatarUrl} alt="Your profile" className="size-full object-cover" /> : app.user.displayName.charAt(0).toUpperCase()}
          </div>
          <label className={cx(btnGhost, "cursor-pointer", uploading && "pointer-events-none opacity-50")}>
            {uploading ? "Uploading…" : "Choose image"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAvatar(file); e.currentTarget.value = ""; }} />
          </label>
          <span className="text-[12px] text-neutral-500">JPG, PNG, or WebP up to 5 MB</span>
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
        <button onClick={deleteAccount} className={btnDanger}>
          Delete account
        </button>
      </div>
    </Section>
  );
}

/* ----------------------------------- Data ----------------------------------- */
function DataTab() {
  const app = useApp();
  const router = useRouter();
  return (
    <Section title="Data" desc="Your bots and conversations are saved to your account in the cloud, separate from everyone else's.">
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-[14px] font-medium">Export everything</div>
          <div className="mt-0.5 text-[12.5px] text-neutral-500">Download all bots and conversations as JSON.</div>
        </div>
        <a href="/api/export" className={btnGhost}>
          <Icon name="download" size={15} /> Export
        </a>
      </div>
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-[14px] font-medium">Clear all conversations</div>
          <div className="mt-0.5 text-[12.5px] text-neutral-500">Keeps your bots, removes every message.</div>
        </div>
        <button
          className={btnDanger}
          onClick={async () => {
            if (!(await app.confirm({ title: "Clear all conversations?", body: "Every message with every bot will be deleted.", confirmLabel: "Clear all", danger: true }))) return;
            const res = await fetch("/api/export", { method: "DELETE" });
            if (res.ok) {
              app.toast("Conversations cleared.");
              router.push("/");
              router.refresh();
              window.location.assign("/");
            }
          }}
        >
          Clear
        </button>
      </div>
    </Section>
  );
}
