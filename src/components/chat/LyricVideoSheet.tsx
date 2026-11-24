"use client";

import { useRef, useState } from "react";
import { useApp } from "../AppProvider";
import { Icon, Spinner } from "../icons";
import { btnGhost, btnWhite, cx, inputCls, Modal } from "../ui";

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });

const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsText(file);
  });

const formatOf = (name: string): "lrc" | "srt" | "ttml" | "qrc" | "plain" => {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "lrc" || extension === "srt" || extension === "ttml" || extension === "qrc" || extension === "xml") {
    return extension === "xml" ? "ttml" : extension;
  }
  return "plain";
};

/**
 * The upload half of a lyric video: a song, the synced lyrics, and optionally a
 * cover. The files go up first so the Bot only has to assemble them; the
 * lyric text goes into the next message, which is what the Bot needs to call
 * make_lyric_video.
 */
export function LyricVideoSheet({ botId, onClose, onReady }: { botId: string; onClose: () => void; onReady: (note: string) => void }) {
  const app = useApp();
  const audioInput = useRef<HTMLInputElement | null>(null);
  const lyricsInput = useRef<HTMLInputElement | null>(null);
  const artInput = useRef<HTMLInputElement | null>(null);
  const [audio, setAudio] = useState<{ id: string; name: string } | null>(null);
  const [lyrics, setLyrics] = useState<{ id: string; name: string; format: string } | null>(null);
  const [art, setArt] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function upload(file: File, kind: "audio" | "image") {
    const dataUrl = await readDataUrl(file);
    const response = await fetch("/api/artifacts/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botId, kind, title: file.name, dataUrl }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "That file could not be uploaded.");
    return { id: body.id as string, name: file.name };
  }

  async function pickAudio(file: File) {
    setBusy("audio");
    setError("");
    try {
      setAudio(await upload(file, "audio"));
      // The file name is usually "Artist - Title.mp3"; use it to save typing.
      if (!title) {
        const stem = file.name.replace(/\.[^.]+$/, "");
        const [maybeArtist, maybeTitle] = stem.split(" - ");
        if (maybeTitle) {
          setArtist(maybeArtist.trim());
          setTitle(maybeTitle.trim());
        } else setTitle(stem.trim());
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That file could not be uploaded.");
    } finally {
      setBusy("");
    }
  }

  async function pickLyrics(file: File) {
    setBusy("lyrics");
    setError("");
    try {
      const text = await readText(file);
      if (!text.trim()) throw new Error("That lyrics file is empty.");
      const response = await fetch("/api/artifacts/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, kind: "lyrics", title: file.name, dataUrl: text }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "That lyrics file could not be uploaded.");
      setLyrics({ id: body.id as string, name: file.name, format: formatOf(file.name) });
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/_/g, " "));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That file could not be read.");
    } finally {
      setBusy("");
    }
  }

  async function pickArt(file: File) {
    setBusy("art");
    setError("");
    try {
      setArt(await upload(file, "image"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That image could not be uploaded.");
    } finally {
      setBusy("");
    }
  }

  function build() {
    if (!audio || !lyrics) return;
    // Ids only: the files themselves are artifacts the Bot can open, so the
    // message stays short instead of echoing a whole lyrics file.
    const note = [
      `Make a lyric video from my uploads. Title: ${title || "Untitled"}${artist ? `, artist ${artist}` : ""}.`,
      `Audio artifact id: ${audio.id}`,
      art ? `Cover art artifact id: ${art.id}` : "",
      `Lyrics artifact id: ${lyrics.id} (${lyrics.format})`,
    ]
      .filter(Boolean)
      .join("\n");
    onReady(note);
    app.toast("Uploads ready — the Bot is building your lyric video.");
  }

  return (
    <Modal onClose={onClose} width={560} label="New lyric video">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-[#a8c0ff]">
            <Icon name="volume" size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-tight text-white">New lyric video</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-500">
              A song, its synced lyrics, and optionally the cover. Word-by-word animation, built by the Bot.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          <Drop
            label="Song"
            hint="mp3, wav, ogg or m4a · up to 24 MB"
            done={audio?.name}
            busy={busy === "audio"}
            onClick={() => audioInput.current?.click()}
          />
          <Drop
            label="Lyrics"
            hint="LRC, SRT, TTML, QRC or plain text"
            done={lyrics?.name}
            busy={busy === "lyrics"}
            onClick={() => lyricsInput.current?.click()}
          />
          <Drop
            label="Cover art"
            hint="Optional · PNG, JPEG or WebP"
            done={art?.name}
            busy={busy === "art"}
            onClick={() => artInput.current?.click()}
            optional
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-neutral-600">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" aria-label="Song title" className={cx(inputCls, "py-2 text-[13px]")} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-neutral-600">Artist</span>
            <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Optional" aria-label="Artist" className={cx(inputCls, "py-2 text-[13px]")} />
          </label>
        </div>

        {error && <p role="alert" className="mt-3 text-[12px] leading-relaxed text-[#ff9aa5]">{error}</p>}

        <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-neutral-600">
          <Icon name="lock" size={12} className="mt-[3px] shrink-0" />
          <span>The song and the lyrics stay in your account. Nothing is uploaded anywhere else.</span>
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cx(btnGhost, "px-3.5 py-2 text-[12.5px]")}>
            Cancel
          </button>
          <button type="button" disabled={!audio || !lyrics || !!busy} onClick={build} className={cx(btnWhite, "px-4 py-2 text-[12.5px]")}>
            Build lyric video
          </button>
        </div>
      </div>

      <input
        ref={audioInput}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.wav,.ogg,.m4a"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pickAudio(file);
          e.target.value = "";
        }}
      />
      <input
        ref={lyricsInput}
        type="file"
        accept=".lrc,.srt,.ttml,.xml,.qrc,.txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pickLyrics(file);
          e.target.value = "";
        }}
      />
      <input
        ref={artInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pickArt(file);
          e.target.value = "";
        }}
      />
    </Modal>
  );
}

function Drop({
  label,
  hint,
  done,
  busy,
  optional,
  onClick,
}: {
  label: string;
  hint: string;
  done?: string;
  busy: boolean;
  optional?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
        done ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-white/[0.08] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
      )}
    >
      <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", done ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.05] text-neutral-400")}>
        {busy ? <Spinner size={13} /> : <Icon name={done ? "check" : "plus"} size={14} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-white">
          {label} {optional && <span className="font-normal text-neutral-600">· optional</span>}
        </span>
        <span className="block truncate text-[11.5px] text-neutral-500">{done ?? hint}</span>
      </span>
      <span className="shrink-0 text-[11.5px] text-neutral-500">{done ? "Replace" : "Choose"}</span>
    </button>
  );
}
