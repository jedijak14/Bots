"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COLOR_ROWS, COLORS, SHAPE_LABELS, SHAPE_ROWS, type ColorId, type ShapeId } from "@/lib/shapes";
import { useApp } from "./AppProvider";
import { BotAvatar } from "./BotAvatar";
import { btnDanger, btnGhost, btnWhite, cx, inputCls, Modal, ModalHeader } from "./ui";
import { Icon, Spinner } from "./icons";

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

export function BotDialog({ botId }: { botId: string | null }) {
  const app = useApp();
  const router = useRouter();
  const editing = botId ? app.bots.find((b) => b.id === botId) ?? null : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [shape, setShape] = useState<string>(editing?.shape ?? "heart");
  const [color, setColor] = useState<string>(editing?.color ?? "blue");
  const [instructions, setInstructions] = useState(editing?.instructions ?? "");
  const [showInstr, setShowInstr] = useState(!!editing?.instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const changed =
    !editing || name.trim() !== editing.name || shape !== editing.shape || color !== editing.color || instructions !== editing.instructions;
  const canSubmit = name.trim().length > 0 && changed && !busy;

  function randomize() {
    const nextShape = pick(SHAPE_ROWS.flat().filter((s) => s !== shape) as ShapeId[]);
    const nextColor = pick(COLOR_ROWS.flat().filter((c) => c !== color) as ColorId[]);
    setShape(nextShape);
    setColor(nextColor);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/bots/${editing.id}` : "/api/bots", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), shape, color, instructions }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't save the bot.");
      if (editing) {
        app.upsertBot({ id: editing.id, name: j.bot.name, shape: j.bot.shape, color: j.bot.color, instructions: j.bot.instructions });
        app.toast(`${j.bot.name} looks great.`);
        app.closeBotDialog();
      } else {
        app.addBot(j.bot);
        app.closeBotDialog();
        router.push(`/bots/${j.bot.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    const ok = await app.confirm({
      title: `Delete ${editing.name}?`,
      body: "This permanently deletes the bot, its conversation, and shuts down its computer.",
      confirmLabel: "Delete bot",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch(`/api/bots/${editing.id}`, { method: "DELETE" });
    if (!res.ok) {
      setBusy(false);
      setError("Couldn't delete the bot.");
      return;
    }
    app.removeBot(editing.id);
    app.closeBotDialog();
    router.push("/");
  }

  return (
    <Modal onClose={app.closeBotDialog} width={440} label={editing ? "Edit Bot" : "Create New Bot"}>
      <ModalHeader title={editing ? "Edit Bot" : "New Bot"} onClose={app.closeBotDialog}>
        <button onClick={randomize} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-neutral-400 transition hover:bg-white/[0.06] hover:text-white">
          <Icon name="refresh" size={13} />
          <span className="max-sm:hidden">Surprise me</span>
        </button>
      </ModalHeader>

      <div className="max-h-[calc(100dvh-9rem)] overflow-y-auto px-6 pb-3 pt-5">
        <div className="relative flex h-[130px] items-center justify-center" aria-live="polite">
          <div aria-hidden className="absolute h-[150px] w-[150px] rounded-full bg-[radial-gradient(closest-side,rgba(124,140,255,0.18),transparent)] blur-xl" />
          <BotAvatar shape={shape} color={color} size={112} />
        </div>

        <input
          ref={nameRef}
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Name your Bot"
          aria-label="Bot name"
          className={cx(inputCls, "mt-2 h-12 text-center text-[16px] font-medium")}
        />

        <SectionLabel>Shape</SectionLabel>
        <div className="mt-2 flex flex-col items-center gap-1" role="radiogroup" aria-label="Shape">
          {SHAPE_ROWS.map((row, i) => (
            <div key={i} className="flex justify-center gap-1">
              {row.map((s: ShapeId) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={shape === s}
                  aria-label={SHAPE_LABELS[s]}
                  title={SHAPE_LABELS[s]}
                  onClick={() => setShape(s)}
                  className={cx(
                    "grid size-[52px] place-items-center rounded-2xl transition duration-150 hover:bg-white/[0.05] active:scale-90",
                    shape === s && "bg-white/[0.05]",
                  )}
                >
                  <BotAvatar shape={s} color={color} size={36} outline={shape === s} follow={false} />
                </button>
              ))}
            </div>
          ))}
        </div>

        <SectionLabel>Color</SectionLabel>
        <div className="mt-2.5 flex flex-col items-center gap-2.5" role="radiogroup" aria-label="Color">
          {COLOR_ROWS.map((row, i) => (
            <div key={i} className="flex justify-center gap-2.5">
              {row.map((c: ColorId) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={color === c}
                  aria-label={COLORS[c].name}
                  title={COLORS[c].name}
                  onClick={() => setColor(c)}
                  className={cx(
                    "size-[26px] rounded-full transition duration-150 hover:scale-110 active:scale-90",
                    color === c && "ring-2 ring-white/90 ring-offset-[3px] ring-offset-[#121215]",
                  )}
                  style={{ background: COLORS[c].hex }}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="mt-5">
          {showInstr ? (
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Instructions — e.g. “Be helpful, clear, and concise.”"
              aria-label="Instructions"
              className={cx(inputCls, "resize-none")}
            />
          ) : (
            <button onClick={() => setShowInstr(true)} className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-neutral-500 transition hover:bg-white/[0.05] hover:text-neutral-200">
              <Icon name="plus" size={13} />
              Add instructions (optional)
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-center text-[13px] text-[#ff6b7a]">{error}</p>}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/[0.06] px-5 py-3.5">
        {editing ? (
          <button onClick={remove} disabled={busy} className={btnDanger}>
            Delete
          </button>
        ) : (
          <span className="text-[11.5px] text-neutral-600">You can change this later.</span>
        )}
        <div className="flex gap-2">
          <button onClick={app.closeBotDialog} className={btnGhost}>
            Cancel
          </button>
          <button onClick={submit} disabled={!canSubmit} className={cx(btnWhite, !canSubmit && "!bg-[#26262b] !text-neutral-500 opacity-100")}>
            {busy ? <Spinner size={14} /> : editing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mt-6 flex items-center gap-3 px-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-neutral-500">{children}</span>
      <span className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}
