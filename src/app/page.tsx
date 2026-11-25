import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { LogoMark } from "@/components/Logo";
import { Icon } from "@/components/icons";
import { BotAvatar } from "@/components/BotAvatar";
import { BotMarquee, Reveal, RotatingWord, Spotlight } from "@/components/landing/Motion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — ${BRAND.tagline}` },
  description: BRAND.description,
};

const WORDS = ["work", "research", "email", "code", "plans"] as const;

const FACES = [
  { shape: "circle", color: "blue", name: "Aurora" },
  { shape: "squircle", color: "violet", name: "Byte" },
  { shape: "blob", color: "emerald", name: "Nova" },
  { shape: "hexagon", color: "amber", name: "Echo" },
  { shape: "star", color: "rose", name: "Juno" },
  { shape: "cloud", color: "cyan", name: "Pip" },
  { shape: "diamond", color: "indigo", name: "Sol" },
  { shape: "flower", color: "orange", name: "Kit" },
  { shape: "circle", color: "slate", name: "Rook" },
] as const;

const CAPABILITIES = [
  {
    icon: "cursor",
    title: "Its own computer",
    body: "Every Bot gets a real desktop. It clicks, types and signs in to your sites the way you would, then hands back the finished thing.",
  },
  {
    icon: "sparkles",
    title: "A thousand tools, used sparingly",
    body: "Logos, readmes, landing pages, game genres: a library of purpose-built tools, loaded only when a request calls for one instead of filling the prompt with everything it might need.",
  },
  {
    icon: "grid",
    title: "Renders with real Blender",
    body: "Kinetix builds a scene and path-traces it with Cycles — materials, real light, soft shadows — and hands back the render plus a glTF you can open in any engine.",
  },
  {
    icon: "globe",
    title: "Asks the API before the browser",
    body: "A flight, a price, a score: the Bot calls the site's own API, which answers in milliseconds. Only a page it has to see gets a browser, and it says which it chose and why.",
  },
  {
    icon: "mail",
    title: "Drafts and sends email",
    body: "Ask for a message and the Bot writes it in your voice, shows you the draft, and only sends once you say go.",
  },
  {
    icon: "brain",
    title: "Memory that stays",
    body: "Each Bot keeps its own conversation, its own skills and a list of goals you share. It picks up where you left off.",
  },
  {
    icon: "shield",
    title: "Privacy by default",
    body: "When something looks personal, the Bot stops and asks in the conversation before it ever touches the details.",
  },
  {
    icon: "key",
    title: "Your model, your key",
    body: "Bring an OpenAI, Anthropic, Google or local model. Keys are encrypted and never leave your account.",
  },
] as const;

export default async function LandingPage() {
  // Signed-in people usually belong in the app — but not when they came to
  // look at the front door. A redirect here made the landing page impossible
  // to revisit or review once you had an account, so the call to action below
  // is the thing that routes into the app.
  const signedIn = !!(await getCurrentUser());

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-[#050507] text-white">
      {/* backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[980px] overflow-hidden">
        <div className="land-aurora absolute inset-x-[-15%] top-[-30%] h-[1120px]" />
        <div className="land-grid absolute inset-0" />
        <div className="land-noise absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[#050507] to-transparent" />
      </div>

      {/* top bar */}
      <header className="relative z-20 mx-auto flex max-w-[1180px] items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-xl outline-offset-4" aria-label={`${BRAND.name} home`}>
          <LogoMark size={30} />
          <span className="text-[17px] font-semibold tracking-[-0.02em]">{BRAND.name}</span>
        </Link>
        <nav className="flex items-center gap-1.5" aria-label="Account">
          {/* Someone already signed in has no use for a "Sign in" button, and
              offering one is how the front door stops being a way in. */}
          <Link
            href={signedIn ? "/bots" : "/login"}
            className="rounded-full px-3.5 py-2 text-[13px] font-medium text-neutral-300 transition hover:bg-white/[0.06] hover:text-white"
          >
            {signedIn ? "Your Bots" : "Sign in"}
          </Link>
          <Link
            href={signedIn ? "/bots" : "/login?intent=signup"}
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.97]"
          >
            {signedIn ? "Open app" : "Sign up"}
          </Link>
        </nav>
      </header>

      {/* hero */}
      <Spotlight className="relative z-10 mx-auto max-w-[1180px] px-5 pb-10 pt-14 sm:px-8 sm:pt-20">
        <div className="mx-auto max-w-[860px] text-center">
          <div className="land-rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11.5px] font-medium tracking-wide text-neutral-300 backdrop-blur">
            <span className="relative grid size-1.5 place-items-center">
              <span className="absolute size-1.5 animate-ping rounded-full bg-[#7c9bff]" />
              <span className="size-1.5 rounded-full bg-[#7c9bff]" />
            </span>
            Bots with their own computer
          </div>

          <h1
            className="land-rise mt-7 text-[clamp(2.15rem,6vw,4.6rem)] font-semibold leading-[1.03] tracking-[-0.045em]"
            style={{ animationDelay: "90ms" }}
          >
            <span className="block whitespace-nowrap">AI companions that</span>
            <span className="block whitespace-nowrap">
              get your <RotatingWord words={WORDS} label="work, research, email, code and plans" /> done.
            </span>
          </h1>

          <p
            className="land-rise mx-auto mt-6 max-w-[620px] text-pretty text-[15.5px] leading-relaxed text-neutral-400 sm:text-[17px]"
            style={{ animationDelay: "180ms" }}
          >
            Give a Bot a look, a personality and a job. It signs in to your tools, works on your desktop, remembers
            everything you told it, and comes back with finished work.
          </p>

          <div className="land-rise mt-9 flex flex-wrap items-center justify-center gap-2.5" style={{ animationDelay: "260ms" }}>
            <Link
              href={signedIn ? "/bots" : "/login?intent=signup"}
              className="land-cta-sheen relative overflow-hidden rounded-full bg-white px-6 py-3 text-[14px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.98]"
            >
              <span className="relative z-10">{signedIn ? "Open your Bots" : "Get started — it’s free"}</span>
            </Link>
            <Link
              href={signedIn ? "/bots" : "/login"}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-5 py-3 text-[14px] font-medium text-neutral-200 backdrop-blur transition hover:border-white/25 hover:bg-white/[0.07] active:scale-[0.98]"
            >
              {signedIn ? "Your Bots" : "Sign in"}
              <Icon name="arrow-up-right" size={14} />
            </Link>
          </div>

          <p className="land-rise mt-4 text-[12px] text-neutral-600" style={{ animationDelay: "320ms" }}>
            Bring your own model key. No card, no lock-in.
          </p>
        </div>

        {/* floating bot constellation */}
        <div className="relative mx-auto mt-10 h-[200px] max-w-[900px] sm:mt-16 sm:h-[360px]">
          <div className="absolute inset-0 grid place-items-center">
            <div className="land-orb relative grid size-[132px] place-items-center rounded-[38px] border border-white/12 bg-gradient-to-b from-white/[0.10] to-white/[0.02] shadow-[0_0_120px_-30px_rgba(124,155,255,0.8)] backdrop-blur-sm sm:size-[164px]">
              <LogoMark size={72} />
              <span className="absolute -bottom-3 rounded-full border border-white/10 bg-[#0b0b0e] px-2.5 py-1 text-[10.5px] font-medium text-neutral-300">
                your Bot
              </span>
            </div>
          </div>
          {[
            { top: "4%", left: "8%", size: 56, delay: "0s", tilt: "-6deg" },
            { top: "0%", right: "14%", size: 48, delay: "-1.6s", tilt: "5deg" },
            { bottom: "2%", left: "18%", size: 46, delay: "-3.1s", tilt: "4deg" },
            { bottom: "6%", right: "8%", size: 58, delay: "-4.4s", tilt: "-5deg" },
            { top: "38%", left: "0%", size: 38, delay: "-2.2s", tilt: "8deg" },
            { top: "34%", right: "0%", size: 40, delay: "-5.2s", tilt: "-7deg" },
          ].map((spot, i) => (
            <div
              key={i}
              className="land-float absolute hidden sm:block"
              style={{ ...spot, animationDelay: spot.delay, ["--tilt" as string]: spot.tilt }}
            >
              <div className="grid place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5 backdrop-blur">
                <BotAvatar shape={FACES[i % FACES.length].shape} color={FACES[i % FACES.length].color} size={spot.size} />
              </div>
            </div>
          ))}
        </div>
      </Spotlight>

      {/* marquee */}
      <section aria-label="Example Bots" className="relative z-10 mx-auto max-w-[1180px] px-2 pb-16">
        <BotMarquee rows={[FACES.slice(0, 5), FACES.slice(4, 9)]} />
      </section>

      {/* capabilities */}
      <section className="relative z-10 mx-auto max-w-[1180px] px-5 pb-16 sm:px-8">
        <Reveal>
          <h2 className="max-w-[720px] text-balance text-[clamp(1.7rem,3.6vw,2.6rem)] font-semibold leading-tight tracking-[-0.03em]">
            Everything a teammate has, inside a little face.
          </h2>
          <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-neutral-500">
            Not a chat window with a personality. A Bot keeps a desktop, a memory and a goal list, and it uses them.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item, i) => (
            <Reveal key={item.title} delay={i * 60}>
              <div className="group relative h-full overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.025] p-5 transition duration-500 hover:border-white/15 hover:bg-white/[0.05]">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-[#7c9bff]/10 blur-3xl transition duration-700 group-hover:bg-[#7c9bff]/25"
                />
                <div className="grid size-10 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.05] text-[#a8c0ff]">
                  <Icon name={item.icon} size={17} />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-white">{item.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-neutral-500">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="relative z-10 mx-auto max-w-[1180px] px-5 pb-16 sm:px-8">
        <Reveal>
          <div className="overflow-hidden rounded-[32px] border border-white/[0.07] bg-gradient-to-b from-white/[0.04] to-transparent">
            <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.05fr] lg:items-center">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#7c9bff]">Three steps</div>
                <h2 className="mt-3 text-balance text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-tight tracking-[-0.03em]">
                  Make one. Tell it what you want. Watch it work.
                </h2>
                <ol className="mt-6 space-y-4">
                  {[
                    ["Pick a face", "A shape, a colour, a name. It is yours, and it stays."],
                    ["Say what matters", "Skills, goals and how you like things done. It remembers all of it."],
                    ["Hand over the job", "It uses its computer, drafts the work, and checks in before anything leaves."],
                  ].map(([title, body], i) => (
                    <li key={title} className="flex gap-3.5">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-[11.5px] font-semibold tabular-nums text-neutral-300">
                        {i + 1}
                      </span>
                      <div>
                        <div className="text-[13.5px] font-medium text-white">{title}</div>
                        <p className="mt-0.5 text-[13px] leading-relaxed text-neutral-500">{body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* mock conversation, animated in place */}
              <div className="relative">
                <div aria-hidden className="land-glow absolute -inset-6 rounded-[40px] bg-[#7c9bff]/10 blur-3xl" />
                <div className="relative space-y-2.5 rounded-3xl border border-white/[0.08] bg-[#0a0a0d]/80 p-3.5 backdrop-blur">
                  <div className="flex items-center gap-2 px-1 pb-1">
                    <BotAvatar shape="squircle" color="violet" size={22} follow={false} />
                    <span className="text-[12px] font-medium text-neutral-300">Byte</span>
                    <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-neutral-600">
                      <span className="size-1 rounded-full bg-emerald-400" /> working
                    </span>
                  </div>
                  <div className="ml-auto w-fit max-w-[86%] rounded-2xl rounded-br-md bg-white/[0.09] px-3.5 py-2 text-[12.5px] leading-relaxed text-neutral-200">
                    Ship the pricing page by Friday and email the team when it&rsquo;s live.
                  </div>
                  <div className="w-fit max-w-[92%] rounded-2xl rounded-bl-md border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                      <Icon name="brain" size={12} /> Thought for 2 seconds
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-black/40 px-2 py-1.5 font-mono text-[11px] text-neutral-400">
                      <Icon name="terminal" size={11} /> Ran commands <span className="ml-auto tabular-nums">3</span>
                    </div>
                    <p className="mt-2.5 text-[12.5px] leading-relaxed text-neutral-300">
                      Page is built and deployed. Draft for the team is ready — want me to send it?
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-black">Send</span>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-neutral-400">Edit</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* closing call */}
      <section className="relative z-10 mx-auto max-w-[1180px] px-5 pb-24 sm:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-[36px] border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center sm:px-10">
            <div aria-hidden className="land-aurora absolute inset-x-0 -top-40 h-[420px] opacity-60" />
            <div className="land-grid absolute inset-0 opacity-60" />
            <div className="relative">
              <h2 className="mx-auto max-w-[640px] text-balance text-[clamp(1.8rem,4vw,3rem)] font-semibold leading-tight tracking-[-0.035em]">
                {signedIn ? "Back to work." : "Give a Bot its first job."}
              </h2>
              <p className="mx-auto mt-3 max-w-[440px] text-[14.5px] leading-relaxed text-neutral-400">
                {signedIn
                  ? "Your Bots are waiting. Pick one up where you left off."
                  : "Sign up in seconds, bring your own key, and meet the little face that does the boring part."}
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
                <Link
                  href={signedIn ? "/bots" : "/login?intent=signup"}
                  className="rounded-full bg-white px-5 py-2.5 text-[13.5px] font-semibold text-black transition hover:bg-neutral-200 active:scale-[0.98]"
                >
                  {signedIn ? "Open your Bots" : "Create your account"}
                </Link>
                <Link
                  href="/login"
                  className="rounded-full border border-white/12 px-5 py-2.5 text-[13.5px] font-medium text-neutral-200 transition hover:border-white/25 hover:bg-white/[0.06] active:scale-[0.98]"
                >
                  I already have one
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="relative z-10 mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-7 text-[12px] text-neutral-600 sm:px-8">
        <div className="flex items-center gap-2">
          <LogoMark size={18} />
          <span>
            {BRAND.name} — {BRAND.tagline}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {signedIn ? (
            <Link href="/bots" className="transition hover:text-neutral-300">
              Your Bots
            </Link>
          ) : (
            <>
              <Link href="/login" className="transition hover:text-neutral-300">
                Sign in
              </Link>
              <Link href="/login?intent=signup" className="transition hover:text-neutral-300">
                Sign up
              </Link>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
