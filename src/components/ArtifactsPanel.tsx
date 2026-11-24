"use client";

import useSWR from "swr";
import { useState } from "react";
import { useApp } from "./AppProvider";
import { Icon } from "./icons";
import { EmailDraftCard } from "./chat/EmailDraftCard";
import { LyricVideoCard } from "./chat/LyricVideoCard";
import { btnQuiet, cx } from "./ui";

type Artifact = { id: string; title: string; kind: string; content: string; archived: boolean; createdAt: string };

const fetcher = async (url: string): Promise<Artifact[]> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load Artifacts.");
  return response.json();
};

const isEmail = (kind: string) => kind.startsWith("email_") || kind === "sent_email";
/** Uploaded songs and covers back a lyric video; they are not documents. */
const isMedia = (kind: string) => kind === "audio" || kind === "image";

function artifactBlob(artifact: Artifact) {
  const type = artifact.kind === "html" || artifact.kind === "website" ? "text/html" : isEmail(artifact.kind) ? "application/json" : "text/plain";
  return new Blob([artifact.content], { type: `${type};charset=utf-8` });
}

function artifactFileName(artifact: Artifact) {
  const base = artifact.title.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "artifact";
  const extension = artifact.kind === "html" || artifact.kind === "website" ? ".html" : isEmail(artifact.kind) ? ".json" : ".txt";
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

export function ArtifactsPanel() {
  const app = useApp();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [actionError, setActionError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(`/api/artifacts${includeArchived ? "?includeArchived=true" : ""}`, fetcher, { revalidateOnFocus: true });

  function openArtifact(artifact: Artifact) {
    const url = URL.createObjectURL(artifactBlob(artifact));
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  function downloadArtifact(artifact: Artifact) {
    const url = URL.createObjectURL(artifactBlob(artifact));
    const link = document.createElement("a");
    link.href = url;
    link.download = artifactFileName(artifact);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function setArchived(artifact: Artifact, archived: boolean) {
    setActionError("");
    const response = await fetch(`/api/artifacts/${artifact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    const result = await response.json();
    if (!response.ok) {
      setActionError(result.error ?? "Could not update this artifact.");
      return;
    }
    await mutate();
  }
  async function remove(artifact: Artifact) {
    const ok = await app.confirm({
      title: "Delete this artifact?",
      body: `“${artifact.title}” will be gone for good.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setActionError("");
    const response = await fetch(`/api/artifacts/${artifact.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) {
      setActionError(result.error ?? "Could not delete this artifact.");
      return;
    }
    await mutate();
  }

  return (
    <div className="fade-up">
      <h3 className="text-[18px] font-semibold tracking-tight">Artifacts</h3>
      <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-neutral-400">
        Stories, documents, websites, lyric videos and reviewed email drafts your Bots save for you.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex rounded-full border border-white/[0.07] bg-black/20 p-0.5 text-[12px]">
          {[
            { id: false, label: "Active" },
            { id: true, label: "Everything" },
          ].map((opt) => (
            <button
              key={String(opt.id)}
              onClick={() => setIncludeArchived(opt.id)}
              aria-pressed={includeArchived === opt.id}
              className={cx(
                "rounded-full px-3 py-1.5 transition",
                includeArchived === opt.id ? "bg-white/[0.1] text-white" : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="mt-5 text-[13px] text-neutral-500">Loading artifacts…</p>}
      {error && (
        <p role="alert" className="mt-5 text-[13px] text-rose-300">
          {error.message}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-3 text-[12px] text-rose-300">
          {actionError}
        </p>
      )}

      {!isLoading && !error && !data?.length && (
        <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-8 text-center text-[13px] text-neutral-500">
          {includeArchived ? "No artifacts in this view." : "Your saved work will appear here."}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {data?.map((artifact) => (
          <article key={artifact.id} className="rounded-[20px] border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-neutral-300">
                <Icon
                  name={
                    artifact.kind === "lyric_video"
                      ? "volume"
                      : isEmail(artifact.kind)
                        ? "mail"
                        : isMedia(artifact.kind)
                          ? artifact.kind === "audio" ? "volume" : "image"
                          : "file"
                  }
                  size={16}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-[13.5px] font-medium text-white">{artifact.title}</h4>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {artifact.kind.replaceAll("_", " ")} · {new Date(artifact.createdAt).toLocaleDateString()}
                  {artifact.archived ? " · archived" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {!isEmail(artifact.kind) && !isMedia(artifact.kind) && (
                  <button type="button" onClick={() => openArtifact(artifact)} className={btnQuiet}>
                    Open
                  </button>
                )}
                {!isMedia(artifact.kind) && (
                  <button type="button" onClick={() => downloadArtifact(artifact)} className={btnQuiet}>
                    Save
                  </button>
                )}
                <button type="button" onClick={() => void setArchived(artifact, !artifact.archived)} className={btnQuiet}>
                  {artifact.archived ? "Restore" : "Archive"}
                </button>
                <button
                  type="button"
                  aria-label={`Permanently delete ${artifact.title}`}
                  onClick={() => void remove(artifact)}
                  className="rounded-full px-2.5 py-1.5 text-[12px] text-neutral-500 transition hover:bg-rose-400/10 hover:text-rose-300"
                >
                  Delete
                </button>
              </div>
            </div>

            {artifact.kind === "lyric_video" ? (
              <div className="mt-3">
                <LyricVideoCard artifact={artifact} />
              </div>
            ) : isEmail(artifact.kind) ? (
              <div className="mt-3">
                <EmailDraftCard artifact={artifact} />
              </div>
            ) : isMedia(artifact.kind) ? (
              <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <Icon name={artifact.kind === "audio" ? "volume" : "image"} size={14} className="text-neutral-500" />
                <span className="text-[12px] text-neutral-500">
                  {artifact.kind === "audio" ? "Uploaded song" : "Uploaded cover art"} — used by a lyric video.
                </span>
                <button type="button" onClick={() => downloadArtifact(artifact)} className={cx(btnQuiet, "ml-auto shrink-0")}>
                  Save
                </button>
              </div>
            ) : (
              <details className="mt-3">
                <summary className="cursor-pointer rounded-lg text-[12px] text-neutral-400 transition hover:text-white">View artifact</summary>
                {artifact.kind === "html" || artifact.kind === "website" ? (
                  <iframe title={artifact.title} sandbox="" srcDoc={artifact.content} className="mt-3 h-[360px] w-full rounded-xl bg-white" />
                ) : (
                  <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-black/25 p-3 text-[12px] leading-relaxed text-neutral-300">{artifact.content}</pre>
                )}
              </details>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
