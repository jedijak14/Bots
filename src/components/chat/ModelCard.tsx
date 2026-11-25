"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";

/**
 * A 3D model artifact.
 *
 * The stored content is a complete HTML viewer with the mesh embedded, so this
 * shows it in a sandboxed frame rather than re-implementing a renderer: what
 * the user sees here is exactly what they get if they open the artifact, and
 * the mesh itself is a separate .obj artifact next to it.
 */
export function ModelCard({ artifact }: { artifact: { id: string; title: string; content: string } }) {
  const [open, setOpen] = useState(false);
  // The viewer is plain HTML with no network access, so it is safe to inline.
  const srcDoc = useMemo(() => artifact.content, [artifact.content]);
  // The viewer carries its own counts, so the card never has to parse the mesh.
  const stats = useMemo(() => {
    const m = /<meta name="mesh-stats" content="(\d+) vertices, (\d+) faces">/.exec(artifact.content);
    return { verts: Number(m?.[1] ?? 0), faces: Number(m?.[2] ?? 0) };
  }, [artifact.content]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b0b0e]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.07] px-3.5 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-neutral-300">
          <Icon name="grid" size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-white">{artifact.title}</div>
          <div className="text-[11px] text-neutral-500">
            {stats.faces ? `${stats.faces.toLocaleString()} faces · ${stats.verts.toLocaleString()} vertices · ` : ""}drag to orbit
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition hover:bg-white/[0.14] hover:text-white"
        >
          {open ? "Hide" : "View"}
        </button>
      </div>
      {open ? (
        <iframe
          title={artifact.title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          className="block h-[360px] w-full border-0 sm:h-[440px]"
        />
      ) : (
        <div className="grid h-[132px] place-items-center text-[12px] text-neutral-600">
          <span>3D model ready — press View</span>
        </div>
      )}
    </div>
  );
}

/** A generated image artifact, stored as a data URL. */
export function ImageCard({ artifact }: { artifact: { id: string; title: string; content: string } }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b0b0e]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={artifact.content} alt={artifact.title} className="block max-h-[420px] w-full object-contain" />
      <figcaption className="border-t border-white/[0.07] px-3.5 py-2 text-[11.5px] text-neutral-500">{artifact.title}</figcaption>
    </figure>
  );
}
