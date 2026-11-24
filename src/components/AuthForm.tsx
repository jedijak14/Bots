"use client";

import { useActionState, useEffect, useState } from "react";
import { SHAPE_IDS, COLOR_ROWS } from "@/lib/shapes";
import { BotAvatar } from "./BotAvatar";
import { Spinner, Icon } from "./icons";
import { LogoMark } from "./Logo";
import { cx, inputCls } from "./ui";

const COLORS_CYCLE = COLOR_ROWS.flat();

export type AuthFormState = { error: string | null; mode: "signin" | "signup" };

export function AuthForm({
  action,
  initialMode = "signin",
}: {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  /** Deep links from the landing page open straight on the sign-up tab. */
  initialMode?: "signin" | "signup";
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, mode: initialMode });
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [i, setI] = useState(5);

  // the hero bot keeps changing its look
  useEffect(() => {
    const t = setInterval(() => setI((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, []);

  // only show an error that belongs to the tab we're currently on
  const error = state.mode === mode ? state.error : null;

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#060608]">
      {/* brand backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-20%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(124,140,255,0.14),transparent)] blur-3xl" />
        <div className="absolute bottom-[-25%] right-[-10%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.12),transparent)] blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[1120px] flex-col px-5 py-10 sm:px-8 lg:flex-row lg:items-center lg:gap-16">
        {/* Pitch */}
        <div className="hidden flex-1 lg:block">
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="text-[20px] font-semibold tracking-[-0.03em]">Bots</span>
          </div>

          <h1 className="mt-12 max-w-[460px] text-[42px] font-semibold leading-[1.05] tracking-[-0.04em] text-white">
            Bots with their own look, memory and computer.
          </h1>
          <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-neutral-400">
            Create a bot, give it a personality, and let it use a real desktop. Bring your own model — your keys stay yours.
          </p>

          <ul className="mt-8 space-y-3 text-[13.5px] text-neutral-300">
            <li className="flex items-center gap-2.5">
              <span className="grid size-6 place-items-center rounded-full bg-white/[0.06] text-[#a8c0ff]">
                <Icon name="check" size={13} />
              </span>
              Every bot keeps its own conversation and files
            </li>
            <li className="flex items-center gap-2.5">
              <span className="grid size-6 place-items-center rounded-full bg-white/[0.06] text-[#a8c0ff]">
                <Icon name="check" size={13} />
              </span>
              A live Linux desktop it can drive while you watch
            </li>
            <li className="flex items-center gap-2.5">
              <span className="grid size-6 place-items-center rounded-full bg-white/[0.06] text-[#a8c0ff]">
                <Icon name="check" size={13} />
              </span>
              Encrypted keys, and nothing sent anywhere else
            </li>
          </ul>

          <div className="mt-12 flex items-end gap-5 opacity-90">
            <BotAvatar shape="heart" color="blue" size={58} follow={false} />
            <BotAvatar shape="sparkle" color="purple" size={78} follow={false} />
            <BotAvatar shape="square" color="green" size={58} follow={false} />
          </div>
        </div>

        {/* Form */}
        <div className="mx-auto w-full max-w-[400px] lg:ml-auto">
          <div className="lg:hidden">
            <div className="mb-10 flex flex-col items-center">
              <LogoMark size={44} />
              <span className="mt-3 text-[20px] font-semibold tracking-[-0.03em]">Bots</span>
            </div>
          </div>

          <div className="fade-up rounded-[26px] border border-white/[0.08] bg-[#0e0e11]/90 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur sm:p-7">
            <div className="flex h-[92px] items-center justify-center">
              <BotAvatar shape={SHAPE_IDS[i % SHAPE_IDS.length]} color={COLORS_CYCLE[(i * 3) % COLORS_CYCLE.length]} size={86} />
            </div>
            <h2 className="mt-2 text-center text-[22px] font-semibold tracking-[-0.03em] text-white">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-1.5 text-center text-[13px] text-neutral-500">
              {mode === "signin" ? "Sign in to pick up where you left off." : "Just an email and a password. Your bots stay private to you."}
            </p>

            <div className="mt-5 grid grid-cols-2 rounded-full bg-white/[0.04] p-1 text-[12.5px]" role="tablist" aria-label="Sign in or create account">
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
              {mode === "signup" && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-neutral-400">Name</span>
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="What should your bots call you?"
                    aria-label="Name"
                    className={inputCls}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-neutral-400">Email</span>
                <input
                  type="email"
                  name="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-neutral-400">Password</span>
                <span className="relative block">
                  <input
                    type={show ? "text" : "password"}
                    name="password"
                    required
                    minLength={mode === "signup" ? 8 : undefined}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                    aria-label="Password"
                    className={cx(inputCls, "pr-12")}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11.5px] text-neutral-500 transition hover:text-white"
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </span>
              </label>

              {error && (
                <p role="alert" className="rounded-xl border border-[#4a1c22] bg-[#241013] px-3.5 py-2.5 text-[12.5px] text-[#ff8b98]">
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

            <p className="mt-4 text-center text-[11.5px] leading-relaxed text-neutral-600">
              Keys are encrypted at rest and only used to talk to your provider.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
