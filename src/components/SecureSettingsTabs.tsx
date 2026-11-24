"use client";

import useSWR from "swr";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { Icon, Spinner } from "./icons";
import { btnGhost, btnWhite, Checkbox, cx, inputCls, Toggle } from "./ui";
import { SKILL_CONNECTOR_OPTIONS, SKILL_TOOL_OPTIONS } from "@/lib/skill-permissions";

type Skill = {
  id: string;
  botId: string | null;
  name: string;
  instructions: string;
  enabled: boolean;
  allowedTools: string[];
  allowedConnectors: string[];
  version: number;
};

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load data.");
  return response.json();
};

export function SkillsTab({ botId }: { botId: string | null }) {
  const app = useApp();
  const { data: skills, error, mutate } = useSWR<Skill[]>(`/api/skills?botId=${encodeURIComponent(botId ?? "global")}`, fetcher, {
    shouldRetryOnError: false,
  });
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignedBotId, setAssignedBotId] = useState(botId ?? "");
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [allowedConnectors, setAllowedConnectors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");

  function reset() {
    setName("");
    setInstructions("");
    setEditingId(null);
    setAssignedBotId(botId ?? "");
    setAllowedTools([]);
    setAllowedConnectors([]);
    setSaveError("");
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    setSaveError("");
    try {
      const response = await fetch(editingId ? `/api/skills/${editingId}` : "/api/skills", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions, botId: assignedBotId || null, allowedTools, allowedConnectors }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save the skill.");
      reset();
      setSaved(true);
      await mutate();
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not save the skill.");
    } finally {
      setBusy(false);
    }
  }

  const canSave = !busy && !!name.trim() && !!instructions.trim();

  return (
    <div className="fade-up">
      <h3 className="text-[18px] font-semibold tracking-tight text-white">Skills</h3>
      <p className="mt-1 max-w-[540px] text-[13.5px] leading-relaxed text-neutral-400">
        Give a Bot reusable instructions and decide exactly which tools and connected accounts it may use. Once a skill is enabled, the Bot only
        receives those grants.
      </p>

      <div className="mt-5 space-y-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
        <input aria-label="Skill name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Skill name" />
        <textarea
          aria-label="Skill instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className={cx(inputCls, "min-h-28 resize-y")}
          placeholder="When this skill is enabled, ..."
        />
        <label className="block text-[11.5px] font-medium uppercase tracking-[0.08em] text-neutral-500">
          Assign to
          <select
            aria-label="Assign skill to a Bot"
            value={assignedBotId}
            onChange={(event) => setAssignedBotId(event.target.value)}
            className={cx(inputCls, "mt-1.5 appearance-none text-[13px] normal-case tracking-normal")}
          >
            <option value="">All Bots</option>
            {botId && <option value={botId}>This Bot</option>}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="rounded-xl border border-white/[0.08] p-3">
            <legend className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">Allowed tools</legend>
            <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
              {SKILL_TOOL_OPTIONS.map((option) => (
                <Checkbox
                  key={option.id}
                  label={option.label}
                  checked={allowedTools.includes(option.id)}
                  onChange={(on) =>
                    setAllowedTools((current) => (on ? [...current, option.id] : current.filter((id) => id !== option.id)))
                  }
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-white/[0.08] p-3">
            <legend className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">Allowed connected accounts</legend>
            <div className="space-y-2">
              {SKILL_CONNECTOR_OPTIONS.map((option) => (
                <Checkbox
                  key={option.id}
                  label={option.label}
                  checked={allowedConnectors.includes(option.id)}
                  onChange={(on) =>
                    setAllowedConnectors((current) => (on ? [...current, option.id] : current.filter((id) => id !== option.id)))
                  }
                />
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-neutral-600">Accounts also need to be connected in Settings.</p>
          </fieldset>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" disabled={!canSave} onClick={() => void save()} className={btnWhite}>
            {busy ? "Saving…" : editingId ? "Save changes" : "Create skill"}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className={btnGhost}>
              Cancel
            </button>
          )}
          {saved && <p role="status" className="text-[12px] text-emerald-300">Skill saved.</p>}
        </div>
        {saveError && (
          <p role="alert" className="text-[12px] text-[#ff9aa5]">
            {saveError}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-[13px] text-[#ff9aa5]">
          {error.message}
        </p>
      )}

      {!!skills?.length && (
        <div className="mt-6 flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500">Saved skills</div>
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={cx(
                "flex items-center gap-3 rounded-xl border px-3.5 py-3 transition",
                skill.enabled ? "border-white/[0.09] bg-white/[0.025]" : "border-white/[0.06] bg-white/[0.01]",
              )}
            >
              <span className={cx("grid size-8 shrink-0 place-items-center rounded-full", skill.enabled ? "bg-white/[0.07] text-white" : "bg-white/[0.04] text-neutral-600")}>
                <Icon name="sparkles" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-white">
                  {skill.name}
                  <span className="ml-2 text-[10px] font-normal text-neutral-600">v{skill.version}</span>
                </div>
                <p className="truncate text-[11px] text-neutral-500">{skill.instructions}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingId(skill.id);
                  setName(skill.name);
                  setInstructions(skill.instructions);
                  setAssignedBotId(skill.botId ?? "");
                  setAllowedTools(skill.allowedTools ?? []);
                  setAllowedConnectors(skill.allowedConnectors ?? []);
                  setSaved(false);
                  setSaveError("");
                }}
                className="rounded-full px-2.5 py-1.5 text-[11px] text-neutral-400 transition hover:bg-white/[0.06] hover:text-white"
              >
                Edit
              </button>
              <Toggle
                checked={skill.enabled}
                label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
                onChange={async () => {
                  const response = await fetch(`/api/skills/${skill.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: !skill.enabled }),
                  });
                  if (response.ok) await mutate();
                }}
              />
              <button
                type="button"
                aria-label={`Delete ${skill.name}`}
                onClick={async () => {
                  if (!(await app.confirm({ title: "Delete this skill?", body: `“${skill.name}” will stop applying to your Bots.`, confirmLabel: "Delete", danger: true }))) return;
                  const response = await fetch(`/api/skills/${skill.id}`, { method: "DELETE" });
                  if (response.ok) await mutate();
                }}
                className="rounded-full px-2 py-1.5 text-[11px] text-neutral-600 transition hover:bg-rose-400/10 hover:text-rose-300"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PrivacyTab({ botId }: { botId: string | null }) {
  const app = useApp();
  const { data: privacy, mutate } = useSWR<{ status: "active" | "idle" }>("/api/privacy", fetcher, { revalidateOnFocus: true });
  const active = privacy?.status === "active";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function update(action: "take_control" | "done") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, botId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update Privacy Mode.");
      await mutate({ status: action === "done" ? "idle" : "active" }, { revalidate: false });
      app.closeSettings();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update Privacy Mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fade-up">
      <h3 className="text-[18px] font-semibold tracking-tight text-white">Privacy Mode</h3>
      <p className="mt-1 max-w-[540px] text-[13.5px] leading-relaxed text-neutral-400">
        Take over a Bot&apos;s computer when you need to sign in to something, read a private message, or type a password yourself.
      </p>

      <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
        <div className="flex items-center gap-2.5">
          <span className={cx("size-2 rounded-full", active ? "animate-soft-pulse bg-amber-300" : "bg-white/20")} />
          <div className="text-[13.5px] font-medium text-amber-100">{active ? "Privacy Mode is active" : "Ready when you need it"}</div>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-100/60">
          While you are in control the Bot pauses: it can&apos;t see the screen, type, or click. Press{" "}
          <span className="text-amber-100">I&apos;m Done</span> to hand control back.
        </p>
        {!active && !botId && <p className="mt-1.5 text-[11.5px] text-amber-100/50">Open a Bot first — its sandbox is what you take over.</p>}
        <button
          type="button"
          disabled={busy || !privacy || (!active && !botId)}
          onClick={() => void update(active ? "done" : "take_control")}
          className={cx("mt-4", active ? btnGhost : btnWhite)}
        >
          {busy ? <Spinner size={14} /> : active ? "I'm Done" : "Take Control"}
        </button>
        {error && (
          <p role="alert" className="mt-3 text-[12px] text-[#ff9aa5]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
