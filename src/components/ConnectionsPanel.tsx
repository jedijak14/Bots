"use client";

import useSWR from "swr";
import { useState } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

type Provider = "google" | "github" | "notion" | "vercel" | "spotify";
type Status = { connected: boolean; provider?: Provider; error?: string };
const providers: Array<{ id: Provider; name: string; detail: string }> = [
  { id: "google", name: "Google", detail: "Gmail search + send, YouTube read access"},
  { id: "github", name: "GitHub", detail: "Your repositories and account" },
  { id: "notion", name: "Notion", detail: "Your pages and workspace" },
  { id: "vercel", name: "Vercel", detail: "Your projects" },
  { id: "spotify", name: "Spotify", detail: "Your 10 most recently saved tracks" },
];
const fetcher = async (url: string): Promise<Status> => {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to check connection.");
  return body;
};

function ConnectionCard({ id: provider, name, detail }: (typeof providers)[number]) {
  const { data, error, mutate, isLoading } = useSWR<Status>(`/api/connections/${provider}`, fetcher, { revalidateOnFocus: true });
  const [connecting, setConnecting] = useState(false);
  const [actionError, setActionError] = useState("");
  async function disconnect() {
    if (!window.confirm(`Disconnect your ${name} account? The Bot will lose access until you connect again.`)) return;
    setConnecting(true);
    setActionError("");
    try {
      const response = await fetch(`/api/connections/${provider}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not disconnect.");
      await mutate(result, { revalidate: false });
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not disconnect."); }
    finally { setConnecting(false); }
  }
  async function connect() {
    setConnecting(true);
    setActionError("");
    try {
      const response = await fetch(`/api/connections/${provider}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error ?? "Could not start authorization.");
      if (window.self !== window.top) window.open(result.url, "_blank", "noopener,noreferrer");
      else window.location.href = result.url;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not start authorization.");
      setConnecting(false);
      await mutate();
    }
  }
  return <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06]"><Icon name="link" size={16} /></div>
    <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{name}</div><div className="text-[12px] text-neutral-500">{detail}</div>{(error || actionError) && <p role="alert" className="mt-1 text-[11px] text-rose-300">{actionError || error?.message}</p>}</div>
    {data?.connected ? <div className="flex items-center gap-2"><span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-300">Connected</span><button type="button" onClick={() => void disconnect()} disabled={connecting} className="rounded-full px-2.5 py-1.5 text-[11px] text-neutral-500 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50">{connecting ? "Revoking…" : "Disconnect"}</button></div> : <button type="button" onClick={() => void connect()} disabled={connecting || isLoading} className={cx("rounded-full border border-white/10 px-3 py-1.5 text-[11.5px] transition hover:border-white/20 hover:bg-white/[0.05] disabled:opacity-50")}>{connecting ? "Opening…" : isLoading ? "Checking…" : "Connect"}</button>}
  </div>;
}

export function ConnectionsPanel() {
  return <div className="fade-up"><h3 className="text-[18px] font-semibold tracking-tight">Connections</h3><p className="mt-1 max-w-[520px] text-[13.5px] leading-relaxed text-neutral-400">Each Bot connects to your own account through Vercel Connect. Access tokens stay on the server and are never sent into chat or stored in the app database.</p><div className="mt-5 space-y-2">{providers.map((provider) => <ConnectionCard key={provider.id} {...provider} />)}</div></div>;
}
