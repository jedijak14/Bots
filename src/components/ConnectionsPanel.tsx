"use client";

import useSWR from "swr";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { EmailPanel } from "./EmailPanel";
import { Icon, Spinner } from "./icons";
import { cx } from "./ui";

type Provider = "google" | "github" | "notion" | "vercel" | "spotify";
type Status = { connected: boolean; available?: boolean; provider?: Provider; mode?: "user" | "app"; reason?: "connector" | "unconfigured"; error?: string };

const providers: Array<{ id: Provider; name: string; detail: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "google", name: "Google", detail: "Gmail search and send, YouTube read access", icon: "mail" },
  { id: "github", name: "GitHub", detail: "Your repositories and account", icon: "github" },
  { id: "notion", name: "Notion", detail: "Your pages and workspace", icon: "notion" },
  { id: "vercel", name: "Vercel", detail: "Your projects and deployments", icon: "vercel" },
  { id: "spotify", name: "Spotify", detail: "Your recently saved tracks", icon: "spotify" },
];

const fetcher = async (url: string): Promise<Status> => {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Unable to check connection.");
  return body;
};

function ConnectionCard({ id: provider, name, detail, icon }: (typeof providers)[number]) {
  const app = useApp();
  const { data, error, mutate, isLoading } = useSWR<Status>(`/api/connections/${provider}`, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const connected = !!data?.connected;
  const viaApp = data?.mode === "app";

  async function disconnect() {
    const ok = await app.confirm({
      title: `Disconnect ${name}?`,
      body: "Your Bots lose access to this account until you connect it again.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/connections/${provider}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not disconnect.");
      await mutate(result, { revalidate: false });
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(`/api/connections/${provider}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error ?? "Could not start authorization.");
      if (window.self !== window.top) window.open(result.url, "_blank", "noopener,noreferrer");
      else window.location.href = result.url;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not start authorization.");
      setBusy(false);
      await mutate();
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 transition hover:border-white/[0.11]">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.05] text-neutral-300">
          <Icon name={icon} size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-white">{name}</div>
          <div className="text-[12px] text-neutral-500">{detail}</div>
        </div>
        <StatusPill
          connected={connected}
          viaApp={viaApp}
          loading={isLoading}
          error={!!error}
          busy={busy}
          unavailable={data?.available === false}
          onConnect={() => void connect()}
          onDisconnect={() => void disconnect()}
        />
      </div>

      {(error || actionError) && (
        <p role="alert" className="mt-2.5 text-[11.5px] leading-relaxed text-[#ff9aa5]">
          {actionError || error?.message}
        </p>
      )}

      {viaApp && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-neutral-500">
          <Icon name="info" size={12} className="mt-[3px] shrink-0" />
          Email is sent with this deployment&apos;s Google credentials, so no per-account connection is needed.
        </p>
      )}

      {/* One actionable line, and only where there is something to act on. */}
      {!viaApp && !error && data?.available === false && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-neutral-500">
          <Icon name="info" size={12} className="mt-[3px] shrink-0" />
          {data.reason === "connector"
            ? `The ${name} connector is not installed on this deployment yet, so connecting is unavailable here.`
            : provider === "google"
              ? "Vercel Connect isn't set up on this deployment. Saving a Gmail address under Email above does the same job."
              : `Connecting ${name} needs Vercel Connect, which isn't set up on this deployment. Until then your Bots have no ${name} access.`}
        </p>
      )}
    </div>
  );
}

function StatusPill(props: {
  connected: boolean;
  viaApp: boolean;
  loading: boolean;
  error: boolean;
  busy: boolean;
  unavailable: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { connected, viaApp, loading, error, busy, unavailable, onConnect, onDisconnect } = props;
  if (loading) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
        <Spinner size={12} /> Checking
      </span>
    );
  }
  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {viaApp ? "Ready" : "Connected"}
        </span>
        {!viaApp && (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="rounded-full px-2 py-1 text-[11px] text-neutral-500 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
          >
            {busy ? "Revoking…" : "Disconnect"}
          </button>
        )}
      </div>
    );
  }
  if (unavailable) {
    return (
      <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] font-medium text-neutral-500" title="Not available on this deployment">
        Not set up
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={busy || error}
      className={cx(
        "rounded-full border border-white/10 px-3 py-1.5 text-[11.5px] font-medium transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-50",
        error && "opacity-60",
      )}
    >
      {busy ? "Opening…" : "Connect"}
    </button>
  );
}

export function ConnectionsPanel() {
  return (
    <div className="fade-up">
      <h3 className="text-[18px] font-semibold tracking-tight text-white">Connections</h3>
      <p className="mt-1 max-w-[540px] text-[13.5px] leading-relaxed text-neutral-400">
        Bots act through your own accounts. Access tokens stay on the server — they are never sent into chat or stored in the app database.
      </p>

      <div className="mt-5">
        <EmailPanel />
      </div>

      <div className="mt-6 mb-2 text-[10.5px] font-medium uppercase tracking-[0.09em] text-neutral-600">Accounts</div>
      <div className="space-y-2">
        {providers.map((provider) => (
          <ConnectionCard key={provider.id} {...provider} />
        ))}
      </div>
      <p className="mt-4 text-[11.5px] leading-relaxed text-neutral-600">
        Connecting runs through Vercel Connect, so tokens stay on the server and can be revoked at any time. Nothing here is needed to chat.
      </p>
    </div>
  );
}
