"use client";

import { useActionState, useEffect, useState } from "react";
import { SHAPE_IDS, COLOR_ROWS } from "@/lib/shapes";
import { BotAvatar } from "./BotAvatar";
import { Spinner } from "./icons";
import { cx, inputCls } from "./ui";

const COLORS_CYCLE = COLOR_ROWS.flat();

export type AuthFormState = { error: string | null; mode: "signin" | "signup" };

export function AuthForm({
  action,
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, mode: "signin" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [i, setI] = useState(5);

  // the hero bot keeps changing its look
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, []);

  // only show an error that belongs to the tab we're currently on
  const error = state.mode === mode ? state.error : null;

  return (
    <div className="fixed inset-0 grid place-items-center overflow-y-auto bg-[#0a0a0a] p-4">
      <div className="fade-up w-full max-w-[400px] rounded-2xl border border-white/10 bg-[#101010] p-7 shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
        <div className="flex h-[120px] items-center justify-center">
          <BotAvatar shape={SHAPE_IDS[i % SHAPE_IDS.length]} color={COLORS_CYCLE[(i * 3) % COLORS_CYCLE.length]} size={104} />
        </div>
        <h1 className="mt-3 text-center text-[24px] font-semibold tracking-tight">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1.5 text-center text-[13.5px] text-neutral-400">
          {mode === "signin" ? "Sign in with your email to see your bots." : "Just an email and a password. Your bots stay private to you."}
        </p>

        <div className="mt-6 grid grid-cols-2 rounded-full bg-[#161616] p-1 text-[13px]" role="tablist">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cx("rounded-full py-2 font-medium transition", mode === m ? "bg-white text-black" : "text-neutral-400 hover:text-white")}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form action={formAction} className="mt-5 space-y-3">
          <input type="hidden" name="intent" value={mode} />
          <input
            type="email"
            name="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="Email"
            className={inputCls}
          />
          <input
            type="password"
            name="password"
            required
            minLength={mode === "signup" ? 8 : undefined}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
            aria-label="Password"
            className={inputCls}
          />
          {error && (
            <p role="alert" className="rounded-xl bg-[#2a1215] px-3.5 py-2.5 text-[13px] text-[#ff8b98]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[14px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.98] disabled:opacity-60"
          >
            {pending && <Spinner size={15} />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-neutral-600">
          <span className="h-px flex-1 bg-white/[0.08]" />
          <span>or</span>
          <span className="h-px flex-1 bg-white/[0.08]" />
        </div>
        <a
          href="/api/auth/google"
          className="flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] py-3 text-[14px] font-medium text-white transition hover:bg-white/[0.09]"
        >
          <span aria-hidden="true" className="text-base font-semibold">G</span>
          Continue with Google
        </a>
      </div>
    </div>
  );
}
