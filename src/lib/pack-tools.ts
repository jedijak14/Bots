import "server-only";
import type { ToolResult } from "@/lib/ai/llm";
import { db } from "@/db";
import { artifacts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * The half of a capability pack that does something.
 *
 * Every tool here either produces an artifact the user can open, or a file on
 * the Bot's computer it can run. None of them are allowed to claim success
 * without producing one of those two things — "I've designed your game" with
 * nothing behind it is the failure mode these packs exist to avoid.
 */

export type PackToolContext = {
  userId: string;
  botId: string;
  turnId: string;
  signal: AbortSignal;
  /** Write a file on the Bot's computer. Absent when there is no computer. */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** Run a command on the Bot's computer. Absent when there is no computer. */
  runCommand?: (command: string, timeoutMs?: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Start a Helper Bot. Wired by the chat route so helpers share the loop. */
  spawn?: (input: { name: string; task: string; context?: string; artifactKind?: string }) => string;
  /** Check on Helpers, waiting at most `seconds`. */
  helperStatus?: (seconds: number) => Promise<Record<string, unknown>[]>;
  /** The account's image provider, when one is configured. */
  imageConfig?: { provider: import("./ai/providers").ProviderId; apiKey: string; baseUrl: string; imageModel?: string | null };
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);

async function saveArtifact(
  ctx: PackToolContext,
  title: string,
  kind: string,
  content: string,
): Promise<{ id: string } | null> {
  const clean = title.trim().slice(0, 160);
  if (!clean || !content) return null;
  if (content.length > 200_000) return null;
  const [row] = await db
    .insert(artifacts)
    .values({ userId: ctx.userId, botId: ctx.botId, title: clean, kind, content })
    .returning({ id: artifacts.id });
  return row ?? null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "untitled";

/** Reject markup that would try to reach the network from a "self-contained" file. */
function networkFree(html: string): string | null {
  if (/<script[^>]+src=/i.test(html)) return "The document loads an external script. Inline it instead.";
  if (/<link[^>]+rel=["']?stylesheet/i.test(html)) return "The document loads an external stylesheet. Inline the CSS instead.";
  if (/https?:\/\//i.test(html.replace(/https?:\/\/(www\.)?(w3\.org|schema\.org)[^\s"']*/gi, ""))) {
    return "The document contains an absolute URL. Self-contained files must not depend on the network.";
  }
  if (!/<html[\s>]/i.test(html)) return "That is not a complete HTML document (<html> is missing).";
  return null;
}

/** Strip the things that make an SVG fail to render inline. */
function sanitizeSvg(svg: string): string | null {
  const trimmed = svg.trim();
  if (!/^<svg[\s>]/i.test(trimmed)) return null;
  if (/<script|<foreignObject|onload=|onclick=/i.test(trimmed)) return null;
  if (/https?:\/\//i.test(trimmed.replace(/xmlns(:\w+)?=["'][^"']*["']/gi, ""))) return null;
  return trimmed;
}

export async function runPackTool(name: string, a: Record<string, unknown>, ctx: PackToolContext): Promise<ToolResult> {
  switch (name) {
    /* --------------------------------- assets -------------------------------- */

    case "design_brief": {
      const title = String(a.title ?? "").trim();
      if (!title) return { output: "A design brief needs a title." };
      const brief = {
        title,
        subject: String(a.subject ?? ""),
        medium: String(a.medium ?? "game"),
        mood: String(a.mood ?? ""),
        era: a.era ? String(a.era) : undefined,
        accessibility: a.accessibility ? String(a.accessibility) : "AA contrast; do not rely on colour alone",
        // The non-negotiable half of a brief: without these, every later step
        // invents its own look and the result reads as several unrelated
        // pieces rather than one thing.
        requirements: [
          "One idea governs the whole piece; say it in a sentence before choosing colours.",
          "Pick 5 colours with a role each: background, surface, primary, accent, and one for danger or loss.",
          "Every colour pairing used for text must clear 4.5:1.",
          "Motion is 120-220ms and eases out; nothing loops faster than 6s.",
          "No colour carries meaning alone — pair it with shape, label or position.",
        ],
      };
      const saved = await saveArtifact(ctx, `${title} — design brief`, "design_brief", JSON.stringify(brief, null, 2));
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved
          ? `Design brief saved (artifact ${saved.id}) and shown as a card.\n\n${JSON.stringify(brief, null, 2)}\n\nFollow it in every later step: reuse these roles rather than picking new colours.`
          : "The brief could not be saved. Keep it in mind anyway.",
      };
    }

    case "make_asset_sheet": {
      const title = String(a.title ?? "").trim();
      const kind = String(a.kind ?? "sprites");
      const count = Math.max(1, Math.min(40, Number(a.count) || 8));
      const tileSize = Number(a.tileSize) || 32;
      const palette = Array.isArray(a.palette) ? a.palette.map(String).slice(0, 8) : [];
      if (!title) return { output: "An asset sheet needs a title." };
      const sheet = {
        title,
        kind,
        tileSize,
        style: String(a.style ?? "flat, three colours, hard shadow"),
        palette: palette.length ? palette : ["#12100e", "#f6d365", "#3acd66", "#ffffff", "#1a1a1a"],
        cells: Array.from({ length: count }, (_, i) => ({
          index: i,
          name: `${slug(title)}-${String(i + 1).padStart(2, "0")}`,
          w: tileSize,
          h: tileSize,
          role: palette.length ? palette[i % palette.length] : "#f6d365",
          frames: /character|sprite/i.test(kind) ? ["idle", "move"] : undefined,
        })),
      };
      const saved = await saveArtifact(ctx, `${title} — asset sheet`, "asset_sheet", JSON.stringify(sheet, null, 2));
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved
          ? `Asset sheet saved (artifact ${saved.id}). ${count} cells at ${tileSize}px.\n\n${JSON.stringify(sheet.cells.slice(0, 8), null, 1)}\n\nCall draw_asset once per cell you actually need.`
          : "The sheet could not be saved.",
      };
    }

    case "generate_image": {
      const title = String(a.title ?? "").trim();
      const prompt = String(a.prompt ?? "").trim();
      if (!title || !prompt) return { output: "An image needs a title and a prompt." };
      if (!ctx.imageConfig) {
        return {
          output:
            "No image model is configured for this account, so no picture was made. Use draw_asset instead — SVG needs no extra service — or tell the user an image model can be added in Settings.",
        };
      }
      const { generateImage } = await import("@/lib/image-gen");
      const result = await generateImage(
        ctx.imageConfig,
        {
          prompt: prompt.slice(0, 4000),
          size: (a.size as "1024x1024" | undefined) ?? "1024x1024",
          negativePrompt: a.negativePrompt ? String(a.negativePrompt) : undefined,
        },
        ctx.signal,
      );
      if (!result.ok) return { output: `${result.reason}\n\nFall back to draw_asset for an SVG version.` };
      const dataUrl = `data:${result.mime};base64,${result.data.toString("base64")}`;
      const saved = await saveArtifact(ctx, title, "image", dataUrl);
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved
          ? `Generated ${title} (artifact ${saved.id}) via ${result.via}, ${Math.round(result.data.length / 1024)} KB. It is a card in the chat now.`
          : "The image was generated but could not be saved.",
      };
    }

    case "draw_asset": {
      const svg = sanitizeSvg(String(a.svg ?? ""));
      if (!svg) {
        return {
          output:
            "That SVG was rejected: it must start with <svg, and must not contain <script>, <foreignObject>, event handlers (onload/onclick) or absolute URLs. Rewrite it as plain shapes and paths.",
        };
      }
      const title = String(a.title ?? "Asset").trim();
      const w = Number(a.width) || 100;
      const h = Number(a.height) || 100;
      if (w > 4096 || h > 4096 || w < 1 || h < 1) return { output: "Asset dimensions must be between 1 and 4096 px." };
      const saved = await saveArtifact(ctx, `${title} (${w}×${h})`, "svg", svg);
      // Also drop it on the computer so a game or site can inline it.
      let wrotePath = "";
      if (ctx.writeFile) {
        wrotePath = `assets/${slug(title)}.svg`;
        await ctx.writeFile(wrotePath, svg).catch(() => {});
      }
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved
          ? `Drew ${title} at ${w}×${h} (artifact ${saved.id})${wrotePath ? `, also at ${wrotePath}` : ""}.`
          : "The asset could not be saved. Check the SVG.",
      };
    }

    /* ---------------------------------- game --------------------------------- */

    case "game_design": {
      const title = String(a.title ?? "").trim();
      if (!title) return { output: "A game design needs a title." };
      const screens = Array.isArray(a.screens) ? a.screens.map(String) : ["Title", "Play", "Game over"];
      const design = {
        title,
        genre: String(a.genre ?? "arcade"),
        premise: String(a.premise ?? ""),
        coreLoop: String(a.coreLoop ?? ""),
        controls: String(a.controls ?? "Arrow keys / WASD, Space to act; touch drag on mobile"),
        screens,
        difficulty: String(a.difficulty ?? "Adds one new threat every thirty seconds; never removes a mechanic."),
        acceptance: [
          "Boots with no console errors.",
          "The first input does something visible within one frame.",
          "It is possible to lose, and possible to get better.",
          "Every screen is reachable and escapable.",
        ],
      };
      const saved = await saveArtifact(ctx, `${title} — game design`, "game_design", JSON.stringify(design, null, 2));
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved
          ? `Game design saved (artifact ${saved.id}).\n\n${JSON.stringify(design, null, 2)}\n\nNow write it with scaffold_game.`
          : "The design could not be saved.",
      };
    }

    case "scaffold_game":
    case "scaffold_site":
    case "scaffold_motion": {
      const title = String(a.title ?? "").trim();
      const html = String(a.html ?? "");
      if (!html.trim()) return { output: "There is no HTML to write." };
      const problem = networkFree(html);
      if (problem) return { output: `${problem} Rewrite it so the file works offline.` };
      const file =
        name === "scaffold_site"
          ? String(a.page ?? "index.html").replace(/[^a-zA-Z0-9._-]/g, "") || "index.html"
          : name === "scaffold_game"
            ? `game/${slug(title)}.html`
            : `motion/${slug(title)}.html`;
      if (name === "scaffold_site" && !/\.html?$/i.test(file)) return { output: "The page name must end in .html." };
      if (ctx.writeFile) await ctx.writeFile(file, html).catch(() => {});
      const saved = await saveArtifact(ctx, title, name === "scaffold_game" ? "game" : name === "scaffold_motion" ? "motion" : "html", html);
      const kb = Math.round(html.length / 1024);
      const lines = html.split("\n").length;
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved
          ? `${title} written${ctx.writeFile ? ` to ${file}` : ""} (${lines} lines, ${kb} KB) and saved as artifact ${saved.id}. ${
              name === "scaffold_game" ? "Call playtest_game next — do not tell the user it works until you have." : "Open Preview to see it."
            }`
          : `${title} was written${ctx.writeFile ? ` to ${file}` : ""}, but the artifact did not save.`,
      };
    }

    case "playtest_game": {
      if (!ctx.runCommand) return { output: "A playtest needs the Bot's computer. Connect an E2B key in Settings to get one." };
      const file = String(a.path ?? "").replace(/^\/+/, "");
      if (!file || file.includes("..")) return { output: "Give a path inside the Bot's home directory." };
      const keys = Array.isArray(a.keys) ? a.keys.map(String).slice(0, 6) : [];
      // A small, dependency-free probe: it reports what the page did, so the
      // model gets facts instead of a vague "looks fine".
      const probe = `const{chromium}=require('/opt/probe/node_modules/playwright-core');
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});const p=await b.newPage({viewport:{width:800,height:600}});
const errs=[];p.on('pageerror',e=>errs.push(String(e).slice(0,200)));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
await p.goto('file:///home/user/${file}',{waitUntil:'load'}).catch(e=>errs.push('nav: '+e.message));
await p.waitForTimeout(600);
const surface=await p.evaluate(()=>{const c=document.querySelector('canvas');if(c)return{kind:'canvas',w:c.width,h:c.height};return{kind:document.body.children.length?'dom':'empty',nodes:document.body.querySelectorAll('*').length}});
const before=await p.screenshot();
for(const k of ${JSON.stringify(keys)}){await p.keyboard.press(k).catch(()=>{});await p.waitForTimeout(220)}
const after=await p.screenshot();
await p.screenshot({path:'/home/user/playtest.png'});
const changed=!before.equals(after);
console.log(JSON.stringify({surface,errors:errs.slice(0,5),keyChangedFrame:changed,keys:${JSON.stringify(keys)}},null,1));
await b.close()})().catch(e=>{console.log(JSON.stringify({fatal:String(e).slice(0,300)}))});`;
      await ctx.writeFile?.("playtest.cjs", probe).catch(() => {});
      const run = await ctx.runCommand("node /home/user/playtest.cjs 2>&1 | tail -40", 120_000);
      return {
        output: clip(`${run.stdout}${run.stderr ? `\n${run.stderr}` : ""}`.trim() || "(no output — the probe produced nothing)", 6000),
      };
    }

    /* --------------------------------- motion -------------------------------- */

    case "motion_storyboard": {
      const title = String(a.title ?? "").trim();
      const shots = Array.isArray(a.shots) ? a.shots : [];
      if (!title) return { output: "A storyboard needs a title." };
      if (!shots.length) return { output: "A storyboard needs at least one shot." };
      const durationSec = Number(a.durationSec) || shots.reduce((max, s) => {
        const shot = s as { at?: number; length?: number };
        return Math.max(max, (Number(shot.at) || 0) + (Number(shot.length) || 0));
      }, 0);
      const board = { title, durationSec, fps: Number(a.fps) || 60, shots };
      const saved = await saveArtifact(ctx, `${title} — storyboard`, "storyboard", JSON.stringify(board, null, 2));
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved ? `Storyboard saved (artifact ${saved.id}), ${shots.length} shots over ${durationSec}s. Now build it with scaffold_motion.` : "The storyboard could not be saved.",
      };
    }

    /* ----------------------------------- web --------------------------------- */

    case "site_plan": {
      const title = String(a.title ?? "").trim();
      const pages = Array.isArray(a.pages) ? a.pages.map(String) : [];
      if (!title) return { output: "A site plan needs a title." };
      const plan = {
        title,
        audience: String(a.audience ?? ""),
        goal: String(a.goal ?? ""),
        pages: pages.length ? pages : ["Home"],
        tone: String(a.tone ?? "plain and confident"),
        rules: [
          "Each section does one job, stated in its own heading.",
          "The primary action appears above the fold and again at the end.",
          "Body text is at least 16px with 1.5 line height.",
          "Every interactive element has a visible focus ring.",
          "No section without a purpose — if it only fills space, cut it.",
        ],
      };
      const saved = await saveArtifact(ctx, `${title} — site plan`, "site_plan", JSON.stringify(plan, null, 2));
      return {
        ...(saved ? { artifactId: saved.id } : {}),
        output: saved ? `Site plan saved (artifact ${saved.id}).\n\n${JSON.stringify(plan, null, 2)}\n\nNow write each page with scaffold_site.` : "The plan could not be saved.",
      };
    }

    case "audit_page": {
      if (!ctx.runCommand) return { output: "An audit needs the Bot's computer. Connect an E2B key in Settings to get one." };
      const file = String(a.path ?? "").replace(/^\/+/, "");
      if (!file || file.includes("..")) return { output: "Give a path inside the Bot's home directory." };
      const probe = `const{chromium}=require('/opt/probe/node_modules/playwright-core');
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});const p=await b.newPage({viewport:{width:390,height:844}});
const errs=[];p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
await p.goto('file:///home/user/${file}',{waitUntil:'load'}).catch(e=>errs.push('nav: '+e.message));
await p.waitForTimeout(400);
const r=await p.evaluate(()=>{const out={imgsNoAlt:0,smallTargets:0,noH1:!document.querySelector('h1'),overflowX:document.documentElement.scrollWidth>window.innerWidth+1,focusVisible:0};
document.querySelectorAll('img').forEach(i=>{if(!i.hasAttribute('alt'))out.imgsNoAlt++});
document.querySelectorAll('a,button,input,select,textarea').forEach(el=>{const b=el.getBoundingClientRect();if(b.width&&b.height&&(b.width<32||b.height<32))out.smallTargets++});
return out});
console.log(JSON.stringify({...r,pageErrors:errs.slice(0,4)},null,1));await b.close()})().catch(e=>console.log(JSON.stringify({fatal:String(e).slice(0,300)})));`;
      await ctx.writeFile?.("audit.cjs", probe).catch(() => {});
      const run = await ctx.runCommand("node /home/user/audit.cjs 2>&1 | tail -30", 120_000);
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(run.stdout.slice(run.stdout.indexOf("{")));
      } catch {
        parsed = null;
      }
      if (!parsed) return { output: clip(run.stdout + run.stderr, 4000) };
      const fixes: string[] = [];
      if (parsed.pageErrors && (parsed.pageErrors as string[]).length) fixes.push("Fix the page errors before anything else.");
      if (parsed.imgsNoAlt) fixes.push(`Add alt text to ${parsed.imgsNoAlt} image(s).`);
      if (parsed.smallTargets) fixes.push(`Grow ${parsed.smallTargets} tap target(s) to at least 32×32px.`);
      if (parsed.noH1) fixes.push("Add one <h1> that says what the page is.");
      if (parsed.overflowX) fixes.push("Remove the horizontal overflow at 390px.");
      return {
        output: `${JSON.stringify(parsed, null, 1)}\n\n${fixes.length ? `Fix these, then re-audit:\n- ${fixes.join("\n- ")}` : "No structural problems found. Check contrast by eye before calling it done."}`,
      };
    }

    /* --------------------------------- models -------------------------------- */

    case "make_3d_model": {
      const { buildModel, viewerHtml } = await import("@/lib/model-gen");
      const title = String(a.title ?? "Model").trim();
      const kind = String(a.kind ?? "rock") as Parameters<typeof buildModel>[0]["kind"];
      if (!["tree", "crystal", "rock", "pillar", "spaceship", "terrain", "tower", "coin"].includes(kind)) {
        return { output: "Pick a kind: tree, crystal, rock, pillar, spaceship, terrain, tower or coin." };
      }
      const palette = Array.isArray(a.palette) ? a.palette.map(String).slice(0, 3) : undefined;
      const built = buildModel({
        kind,
        detail: Number(a.detail) || 2,
        scale: Number(a.scale) || 1,
        seed: Number(a.seed) || 1,
      });
      const obj = built.mesh.toObj(built.name);
      const stats = built.mesh.stats();
      const view = viewerHtml(title, obj, palette);
      // Two artifacts, because they answer different questions: the OBJ is for
      // whatever the user already uses, the viewer is for seeing it now.
      const meshSaved = await saveArtifact(ctx, `${title} — mesh (.obj)`, "model_obj", obj);
      const viewSaved = await saveArtifact(ctx, `${title} — 3D viewer`, "model_3d", view);
      if (ctx.writeFile) {
        await ctx.writeFile(`models/${slug(title)}.obj`, obj).catch(() => {});
        await ctx.writeFile(`models/${slug(title)}.html`, view).catch(() => {});
      }
      return {
        ...(viewSaved ? { artifactId: viewSaved.id } : {}),
        output: [
          `Built ${title}: ${stats.vertices} vertices, ${stats.faces} faces.`,
          meshSaved ? `Mesh artifact: ${meshSaved.id}` : "",
          viewSaved ? `Viewer artifact: ${viewSaved.id} — it opens as a card and orbits with the mouse.` : "",
          ctx.writeFile ? `Also written to models/${slug(title)}.obj and .html on the computer.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    /* --------------------------------- helpers ------------------------------- */

    case "spawn_helper": {
      if (!ctx.spawn) return { output: "Helper Bots are not available on this turn." };
      const helperName = String(a.name ?? "Helper").trim();
      const task = String(a.task ?? "").trim();
      if (!task) return { output: "A Helper needs a task." };
      try {
        const id = ctx.spawn({
          name: helperName,
          task,
          context: a.context ? String(a.context) : undefined,
          artifactKind: a.artifactKind ? String(a.artifactKind) : undefined,
        });
        return {
          output: `Started Helper “${helperName}” (${id}). It is working now. Start any other independent helpers, then call helper_status with waitSeconds to collect their reports.`,
        };
      } catch (error) {
        return { output: error instanceof Error ? error.message : "The Helper could not start." };
      }
    }

    case "helper_status": {
      if (!ctx.helperStatus) return { output: "Helper Bots are not available on this turn." };
      const seconds = Math.max(0, Math.min(25, Number(a.waitSeconds) || 0));
      const list = await ctx.helperStatus(seconds);
      if (!list.length) return { output: "No Helper Bots have been started this turn." };
      return { output: JSON.stringify(list, null, 1) };
    }

    default:
      return { output: `Unknown pack tool ${name}.` };
  }
}

/* ------------------------------ the library ------------------------------- */

export type LibraryContext = {
  userId: string;
  botId: string;
  turnId: string;
  signal: AbortSignal;
  writeFile?: (path: string, content: string) => Promise<void>;
};

/**
 * Execute one library tool.
 *
 * Every library tool resolves to an action that produces something the user can
 * open. The generated names ("generate_logo_animated", "write_readme_for_
 * developer") carry the intent, so this maps the name back onto a concrete
 * action and hands it to the same builders the packs use — one implementation,
 * many precise handles.
 *
 * Where a step needs the model to do the creation itself (a logo's actual
 * shapes), it returns a written brief with exact requirements rather than
 * pretending to have drawn something. A tool that claims to have produced art
 * and produced nothing is worse than one that says what it needs.
 */
export async function runLibraryTool(
  tool: { name: string; summary: string; action: string; preset?: Record<string, string> },
  args: { title: string; detail: string },
  ctx: LibraryContext,
): Promise<ToolResult> {
  const { title } = args;
  const detail = String(args.detail ?? "").trim();
  const preset = tool.preset ?? {};
  const brief = {
    tool: tool.name,
    summary: tool.summary,
    title,
    detail,
    instructions: [] as string[],
    next: "",
  };

  if (tool.action === "produce") {
    brief.instructions.push(
      `Produce ${preset.kind ?? "the asset"}${preset.format ? ` in the ${preset.format} format` : ""} as SVG or a self-contained HTML document.`,
      "Draw from the design brief's palette, not a new one. If no brief exists yet, write one first with design_brief.",
      "Keep the asset to shapes and paths: no filters, no embedded fonts, no external URLs.",
      preset.format === "animated"
        ? "Animate with CSS or the Web Animations API, 120-220ms easing out; nothing loops faster than 6s."
        : "Export at a size that survives 2x: at least 2x the largest place it will be used.",
    );
    brief.next = "Save what you draw with draw_asset (SVG) or scaffold_motion / scaffold_site (animated or HTML).";
  } else if (tool.action === "create_project" || tool.action === "audit_project") {
    brief.instructions.push(
      tool.action === "create_project"
        ? `Plan then build: ${preset.medium ? `a ${preset.medium}` : "the thing"}${preset.mode ? ` in ${preset.mode}` : ""}${preset.job ? `, with attention to ${preset.job}` : ""}.`
        : `Check the build for ${preset.check ?? preset.job ?? "correctness"}${preset.surface ? ` in the ${preset.surface}` : ""}.`,
      "Use game_design / site_plan first, then scaffold_game or scaffold_site, then playtest_game or audit_page.",
      "Do not describe a plan as a result. The turn is only finished when an artifact exists.",
    );
    brief.next = tool.action === "create_project" ? "Call create_project-adjacent build steps, then verify." : "Fix what the check finds, then re-check.";
  } else if (tool.action === "write_document") {
    brief.instructions.push(
      `Write ${preset.kind ?? "a document"} for ${preset.audience ?? "the reader"}.`,
      "Be complete and specific: no placeholders like [your name] unless the user must fill them.",
      "Save it with save_artifact as kind \"document\".",
    );
    brief.next = "save_artifact";
  } else if (tool.action === "research") {
    brief.instructions.push(`Research ${preset.source ?? "the web"} and ${preset.verb ?? "summarise"}.`, "Return findings with links. Do not invent sources.");
    brief.next = "web_search or fetch_page, then save_artifact the summary";
  } else if (tool.action === "design_system") {
    brief.instructions.push(`Define ${preset.topic ?? "the design system"}${preset.verb ? ` (${preset.verb})` : ""}.`, "Give concrete values: hex codes, px sizes, ms durations. Not adjectives.");
    brief.next = "design_brief";
  } else if (tool.action === "data_job") {
    brief.instructions.push(`Handle ${preset.job ?? "the data"}: ${preset.verb ?? "process"} it.`, "Work from real input the user provided. If there is none, ask for it rather than inventing rows.");
    brief.next = "run_command (for parsing) or save_artifact (for a report)";
  } else if (tool.action === "code_task") {
    brief.instructions.push(`Do ${preset.task ?? preset.verb ?? "the task"} in ${preset.language ?? preset.stack ?? "the code"}.`, "Write real, runnable code. No TODOs where the work is obvious.");
    brief.next = "write_file, then run it";
  } else if (tool.action === "integrate") {
    brief.instructions.push(`Integrate ${preset.service ?? "the service"}: ${preset.verb ?? "connect"}.`, "This deployment supports Google, GitHub, Notion, Vercel and Spotify connections. For anything else, build the integration to call its API directly and say what credentials it needs.");
    brief.next = "save_artifact or the connection tools";
  }

  const saved = await saveArtifact(ctx, `${title} — ${tool.summary.replace(/\.$/, "")}`, "tool_plan", JSON.stringify(brief, null, 2));
  return {
    ...(saved ? { artifactId: saved.id } : {}),
    output: [
      `${tool.name} is ready to run: ${tool.summary}`,
      detail ? `Detail you gave: ${detail}` : "",
      "",
      "Do this now:",
      ...brief.instructions.map((line) => `- ${line}`),
      "",
      `Then: ${brief.next}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
