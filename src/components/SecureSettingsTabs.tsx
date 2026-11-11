"use client";

import useSWR from "swr";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { Icon } from "./icons";
import { btnGhost, btnWhite, cx, inputCls } from "./ui";
import { SKILL_CONNECTOR_OPTIONS, SKILL_TOOL_OPTIONS } from "@/lib/skill-permissions";

type Skill = { id: string; botId: string | null; name: string; instructions: string; enabled: boolean; allowedTools: string[]; allowedConnectors: string[]; version: number };
const fetcher = async (url: string) => { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error("Could not load data."); return response.json(); };

export function SkillsTab({ botId }: { botId: string | null }) {
  const { data: skills, error, mutate } = useSWR<Skill[]>(`/api/skills?botId=${encodeURIComponent(botId ?? "global")}`, fetcher);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignedBotId, setAssignedBotId] = useState(botId ?? "");
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [allowedConnectors, setAllowedConnectors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");
  async function save() {
    setBusy(true); setSaved(false); setSaveError("");
    try {
      const response = await fetch(editingId ? `/api/skills/${editingId}` : "/api/skills", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, instructions, botId: assignedBotId || null, allowedTools, allowedConnectors }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save the skill.");
      setName(""); setInstructions(""); setEditingId(null); setAssignedBotId(botId ?? ""); setAllowedTools([]); setAllowedConnectors([]); setSaved(true); await mutate();
    } catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not save the skill."); }
    finally { setBusy(false); }
  }
  return <div className="fade-up"><h3 className="text-[18px] font-semibold tracking-tight">Skills</h3><p className="mt-1 max-w-[520px] text-[13.5px] leading-relaxed text-neutral-400">Give Bots reusable instructions, choose which Bot receives a skill, and explicitly grant tools and connected accounts. With enabled skills, the Bot only receives the combined grants.</p>
    <div className="mt-5 space-y-3"><input aria-label="Skill name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Skill name" /><textarea aria-label="Skill instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} className={cx(inputCls, "min-h-28 resize-y")} placeholder="When this skill is enabled, ..." /><label className="block text-xs text-neutral-400">Assign to<select aria-label="Assign skill to a Bot" value={assignedBotId} onChange={(event) => setAssignedBotId(event.target.value)} className={cx(inputCls, "mt-1.5 appearance-none")}>{<option value="">All Bots</option>}{botId && <option value={botId}>This Bot</option>}</select></label><div className="grid gap-3 sm:grid-cols-2"><fieldset className="rounded-xl border border-white/[0.08] p-3"><legend className="px-1 text-xs font-medium text-neutral-300">Allowed tools</legend><div className="max-h-36 space-y-1 overflow-y-auto">{SKILL_TOOL_OPTIONS.map((option) => <label key={option.id} className="flex items-center gap-2 text-[11px] text-neutral-400"><input type="checkbox" checked={allowedTools.includes(option.id)} onChange={(event) => setAllowedTools((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} className="accent-white" />{option.label}</label>)}</div></fieldset><fieldset className="rounded-xl border border-white/[0.08] p-3"><legend className="px-1 text-xs font-medium text-neutral-300">Allowed connected accounts</legend><div className="space-y-1">{SKILL_CONNECTOR_OPTIONS.map((option) => <label key={option.id} className="flex items-center gap-2 text-[11px] text-neutral-400"><input type="checkbox" checked={allowedConnectors.includes(option.id)} onChange={(event) => setAllowedConnectors((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} className="accent-white" />{option.label}</label>)}</div><p className="mt-2 text-[10px] text-neutral-600">Accounts also need to be connected in Settings.</p></fieldset></div><div className="flex items-center gap-2"><button type="button" disabled={busy || !name.trim() || !instructions.trim()} onClick={() => void save()} className={btnWhite}>{busy ? "Saving…" : editingId ? "Save changes" : "Create skill"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setName(""); setInstructions(""); setAssignedBotId(botId ?? ""); setAllowedTools([]); setAllowedConnectors([]); }} className={btnGhost}>Cancel</button>}</div>{saved && <p role="status" className="text-[12px] text-emerald-300">Skill saved.</p>}{saveError && <p role="alert" className="text-[12px] text-rose-300">{saveError}</p>}</div>
    {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error.message}</p>}{!!skills?.length && <div className="mt-6 flex flex-col gap-2">{skills.map((skill) => <div key={skill.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] p-3"><Icon name="sparkles" size={15} /><div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{skill.name}<span className="ml-2 text-[10px] font-normal text-neutral-600">v{skill.version}</span></div><p className="truncate text-[11px] text-neutral-500">{skill.instructions}</p></div><button type="button" onClick={() => { setEditingId(skill.id); setName(skill.name); setInstructions(skill.instructions); setAssignedBotId(skill.botId ?? ""); setAllowedTools(skill.allowedTools ?? []); setAllowedConnectors(skill.allowedConnectors ?? []); setSaved(false); setSaveError(""); }} className="rounded-full px-2 py-1.5 text-[11px] text-neutral-400 hover:bg-white/[0.05] hover:text-white">Edit</button><button type="button" aria-pressed={skill.enabled} onClick={async () => { const response = await fetch(`/api/skills/${skill.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !skill.enabled }) }); if (response.ok) await mutate(); }} className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-neutral-400 hover:bg-white/[0.05] hover:text-white">{skill.enabled ? "Disable" : "Enable"}</button><button type="button" aria-label={`Delete ${skill.name}`} onClick={async () => { if (!window.confirm(`Delete “${skill.name}”?`)) return; const response = await fetch(`/api/skills/${skill.id}`, { method: "DELETE" }); if (response.ok) await mutate(); }} className="rounded-full px-2 py-1.5 text-[11px] text-neutral-500 hover:bg-rose-400/10 hover:text-rose-300">Delete</button></div>)}</div>}
  </div>;
}

export function PrivacyTab({ botId }: { botId: string | null }) {
  const app = useApp();
  const { data: privacy, mutate } = useSWR<{ status: "active" | "idle" }>("/api/privacy", fetcher, { revalidateOnFocus: true });
  const active = privacy?.status === "active";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function update(action: "take_control" | "done") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, botId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update Privacy Mode.");
      await mutate({ status: action === "done" ? "idle" : "active" }, { revalidate: false });
      app.closeSettings();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update Privacy Mode."); }
    setBusy(false);
  }
  return <div className="fade-up"><h3 className="text-[18px] font-semibold tracking-tight">Privacy Mode</h3><p className="mt-1 max-w-[520px] text-[13.5px] leading-relaxed text-neutral-400">Use this when you need to take control of a connected sandbox or browser session.</p><div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4"><div className="text-[13.5px] font-medium text-amber-100">{active ? "Privacy Mode is active" : "Your Bot is ready to hand over control"}</div>{!active && !botId && <p className="mt-1 text-xs text-amber-100/60">Open a Bot before taking control of its sandbox.</p>}<p className="mt-1 text-[12.5px] leading-relaxed text-amber-100/60">After you press Take Control, I will go into Privacy Mode. The main Bot pauses and cannot see or interact with the sandbox while you use it.</p><button type="button" disabled={busy || !privacy || (!active && !botId)} onClick={() => void update(active ? "done" : "take_control")} className={cx("mt-4", active ? btnGhost : btnWhite)}>{busy ? "Updating…" : active ? "I'm Done" : "Take Control"}</button>{error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}</div></div>;
}
