import type { Tool } from "./ai/llm";

/**
 * Capability packs.
 *
 * A Bot used to be given every tool the deployment owned, on every turn. That
 * is the wrong shape for two reasons: a model choosing from twenty tools
 * chooses worse than one choosing from eight, and the schemas are re-sent on
 * every step of every tool loop, so unused tools are pure cost.
 *
 * A pack is a bundle of tools that belong to one kind of work. The router reads
 * the request and loads only the packs it needs, so "make a game about bees"
 * gets the game pack and the asset pack, and a question about a goal gets
 * neither.
 *
 * Packs are data, not code, so a new domain is a new entry here rather than a
 * new branch in the chat route.
 */

export type PackId = "assets" | "game" | "motion" | "web" | "lookup" | "models" | "helpers";

export type Pack = {
  id: PackId;
  title: string;
  /** One line telling the model when this pack is useful. */
  purpose: string;
  tools: Tool[];
  /**
   * Words that pull this pack in. Matching is deliberately generous: a false
   * positive costs a few schemas, a false negative costs the whole task.
   */
  signals: RegExp;
  /** The pack only helps when the Bot can run commands or write files. */
  needsComputer?: boolean;
};

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/* ---------------------------------- assets ---------------------------------- */

/**
 * Design tokens and a canvas brief are what turn "a game about bees" into
 * something that looks deliberate rather than default. These tools don't
 * generate pixels — they produce the specification an image or a canvas
 * renderer needs, which is the part a model is actually bad at guessing.
 */
const ASSET_TOOLS: Tool[] = [
  {
    name: "design_brief",
    description:
      "Produce a complete visual direction before building anything: a palette with hex values and roles, type choices, motion rules, and the one idea the work is organised around. Call this first for any game, site, poster or video. The brief is saved as an artifact so later steps follow it instead of inventing a new look each time.",
    parameters: obj(
      {
        title: { type: "string", description: "What the work is called." },
        subject: { type: "string", description: "What it is about, in a sentence." },
        medium: { type: "string", enum: ["game", "website", "motion", "print", "ui"], description: "What kind of thing is being made." },
        mood: { type: "string", description: "Three adjectives, e.g. 'sunlit, dusty, optimistic'." },
        era: { type: "string", description: "Optional visual era or reference point, e.g. '1970s print', 'soft future'." },
        accessibility: { type: "string", description: "Any constraint that matters, e.g. 'AA contrast, colour-blind safe'." },
      },
      ["title", "subject", "medium", "mood"],
    ),
  },
  {
    name: "make_asset_sheet",
    description:
      "Plan a set of game or product assets (sprites, tiles, icons, UI chrome) as one sheet: every asset named, sized in pixels, with its palette role and animation frames. Returns the sheet as JSON and saves it as an artifact. Feed each entry to draw_asset.",
    parameters: obj(
      {
        title: { type: "string" },
        kind: { type: "string", enum: ["sprites", "tileset", "icons", "ui", "characters"], description: "What the sheet contains." },
        count: { type: "number", description: "How many assets, 1-40." },
        tileSize: { type: "number", description: "Pixel size of one cell, e.g. 32." },
        style: { type: "string", description: "How they should read, e.g. 'flat, 3-colour, hard shadow'." },
        palette: { type: "array", items: { type: "string" }, description: "Hex colours to draw from, in order of importance." },
      },
      ["title", "kind", "count"],
    ),
  },
  {
    name: "generate_image",
    description:
      "Generate a real raster image with the account's own image model, and save it as an artifact the user can open. Use it for photographs, painted art, textures and anything that should not look like vector shapes. If no image model is configured the call says so and you should fall back to draw_asset, which needs no extra service.",
    parameters: obj(
      {
        title: { type: "string", description: "What the image is." },
        prompt: { type: "string", description: "A full visual description: subject, framing, light, style, colours from the design brief." },
        size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536", "512x512"], description: "Defaults to square." },
        negativePrompt: { type: "string", description: "What to avoid, if the provider supports it." },
      },
      ["title", "prompt"],
    ),
  },
  {
    name: "draw_asset",
    description:
      "Draw one asset as SVG and save it as an artifact. SVG is exact, scales to any size, and can be inlined into an HTML game or a site with no build step — which is why it beats asking for a raster image you then cannot edit. Use short, clean paths; no filters or embedded fonts.",
    parameters: obj(
      {
        title: { type: "string", description: "Asset name, e.g. 'bee-worker'." },
        width: { type: "number", description: "Viewport width in px." },
        height: { type: "number", description: "Viewport height in px." },
        svg: { type: "string", description: "The complete <svg>…</svg> element." },
      },
      ["title", "width", "height", "svg"],
    ),
  },
];

/* ----------------------------------- game ----------------------------------- */

const GAME_TOOLS: Tool[] = [
  {
    name: "game_design",
    description:
      "Write the design for a game before writing code: the loop, the controls, what the player is trying to do, the difficulty curve, and the exact list of screens. Saves it as an artifact. Call this before scaffolding so the build follows a plan rather than growing by accident.",
    parameters: obj(
      {
        title: { type: "string" },
        genre: { type: "string", description: "e.g. platformer, puzzle, shooter, idle, narrative." },
        premise: { type: "string", description: "The one-sentence hook." },
        coreLoop: { type: "string", description: "What the player repeats, and why it stays interesting." },
        controls: { type: "string", description: "Keyboard and touch controls." },
        screens: { type: "array", items: { type: "string" }, description: "Title, play, pause, game over, etc." },
        difficulty: { type: "string", description: "How it gets harder." },
      },
      ["title", "genre", "premise", "coreLoop"],
    ),
  },
  {
    name: "scaffold_game",
    description:
      "Write a complete, runnable single-file HTML game into the Bot's computer and save it as a playable artifact. The file must be self-contained: no network requests, no external scripts, no build step. Use an inline <canvas> or DOM, requestAnimationFrame, and a fixed-timestep loop. This is the fastest route from an idea to something the user can actually play in the Preview tab.",
    parameters: obj(
      {
        title: { type: "string" },
        html: { type: "string", description: "The complete HTML document." },
        notes: { type: "string", description: "Optional: what is implemented and what is stubbed." },
      },
      ["title", "html"],
    ),
  },
  {
    name: "playtest_game",
    description:
      "Load the game you built in a real headless browser on the Bot's computer, check that it boots without console errors, that a canvas or game surface exists, and that pressing the documented keys changes the frame. Returns a screenshot path and the console log. Run this before telling the user the game works.",
    parameters: obj(
      {
        path: { type: "string", description: "Path to the HTML file, e.g. game/index.html." },
        keys: { type: "array", items: { type: "string" }, description: "Keys to press, e.g. ['ArrowRight', 'Space']." },
      },
      ["path"],
    ),
  },
];

/* ---------------------------------- motion ---------------------------------- */

const MOTION_TOOLS: Tool[] = [
  {
    name: "motion_storyboard",
    description:
      "Plan a motion piece as timed frames: each shot has a start, a duration, what is on screen and how it moves. Saves the storyboard as an artifact and returns the timings, so the animation step can follow it exactly.",
    parameters: obj(
      {
        title: { type: "string" },
        durationSec: { type: "number", description: "Total length in seconds." },
        fps: { type: "number", description: "Target frames per second, usually 30 or 60." },
        shots: {
          type: "array",
          description: "One entry per shot.",
          items: obj(
            {
              at: { type: "number", description: "Start time in seconds." },
              length: { type: "number", description: "Duration in seconds." },
              visual: { type: "string", description: "What is on screen." },
              motion: { type: "string", description: "How it enters, holds and leaves." },
            },
            ["at", "length", "visual", "motion"],
          ),
        },
      },
      ["title", "durationSec", "shots"],
    ),
  },
  {
    name: "scaffold_motion",
    description:
      "Write an HTML/CSS/JS animation that plays in a browser and can be recorded. Covers title cards, kinetic type, logo reveals and data-style explainers without needing a video renderer. Save-and-play like scaffold_game.",
    parameters: obj(
      {
        title: { type: "string" },
        html: { type: "string", description: "Complete self-contained HTML document." },
        durationSec: { type: "number" },
      },
      ["title", "html"],
    ),
  },
];

/* ----------------------------------- web ------------------------------------ */

const WEB_TOOLS: Tool[] = [
  {
    name: "site_plan",
    description:
      "Plan a website before writing it: the pages, the sections in order, the one job each section does, and the call to action. Saves it as an artifact. This is what keeps a generated site from being six unrelated hero sections.",
    parameters: obj(
      {
        title: { type: "string" },
        audience: { type: "string", description: "Who it is for and what they already know." },
        goal: { type: "string", description: "The single action the page should produce." },
        pages: { type: "array", items: { type: "string" }, description: "Page or section names, in order." },
        tone: { type: "string", description: "How it should sound, e.g. 'plain and confident'." },
      },
      ["title", "audience", "goal", "pages"],
    ),
  },
  {
    name: "scaffold_site",
    description:
      "Write a complete self-contained HTML site (inline CSS and JS, no external requests) and save it as an artifact so it renders in Preview. Use semantic elements, real focus states, and check contrast. One file per page.",
    parameters: obj(
      {
        title: { type: "string" },
        page: { type: "string", description: "File name, e.g. index.html." },
        html: { type: "string" },
      },
      ["title", "page", "html"],
    ),
  },
  {
    name: "audit_page",
    description:
      "Check a generated page in a real browser: console errors, missing alt text, contrast failures on text, tap targets under 32px, horizontal overflow at 390px, and whether the primary action is reachable by keyboard. Returns a list of concrete fixes. Run before saying a site is done.",
    parameters: obj({ path: { type: "string", description: "HTML file to audit." } }, ["path"]),
  },
];

/* ---------------------------------- models ---------------------------------- */

/* Answers that live on a website: fetched deliberately, the cheap way first. */
const LOOKUP_TOOLS: Tool[] = [
  {
    name: "api_call",
    description:
      "Get live information from a real website by calling it directly — flights, prices, listings, scores, search results, anything a site shows as data. Uses API Anything, which learns how a site fetches its own data, so this is one cheap request instead of driving a browser. Call it with the site and what you want; if no operation is known for the site it will say so and you should use the browser instead.",
    parameters: obj(
      {
        site: { type: "string", description: "The site, as a name or host: 'hacker-news', 'united.com'." },
        operation: { type: "string", description: "What to do there, e.g. search, list, get." },
        query: { type: "object", description: "Arguments the operation takes, as key/value pairs.", additionalProperties: true },
        question: { type: "string", description: "The question in plain words, when you do not know the site or operation." },
      },
      [],
    ),
  },
  {
    name: "choose_route",
    description:
      "Decide whether a request should go through a site's API or through a real browser, and say why. Call this before fetching something live when you are unsure: an API call is milliseconds and a browser is seconds, so the wrong choice is expensive. Returns the route and the fallback if the first attempt fails.",
    parameters: obj(
      {
        request: { type: "string", description: "What you are trying to find out, in plain words." },
      },
      ["request"],
    ),
  },
];

/* Meshes and renders: built here, or by real Blender. */
const MODEL_TOOLS: Tool[] = [
  {
    name: "kinetix",
    description:
      "Render a real 3D scene with Kinetix, the Bot's Blender install: physically based path tracing, real materials, real lighting, and exports in glTF, OBJ and STL. Use it when the model should look like a photograph of an object rather than a flat-shaded drawing — product shots, hero art, anything going into a game engine. It is slower than make_3d_model and needs Kinetix installed; if it reports that it is unavailable, use make_3d_model instead and say why.",
    parameters: obj(
      {
        title: { type: "string", description: "What the render is." },
        objects: {
          type: "array",
          description: "What to put in the scene. Each needs a kind.",
          items: obj(
            {
              kind: { type: "string", enum: ["tree", "rock", "crystal", "tower", "pillar", "spaceship", "terrain", "coin"], description: "The builder to use." },
              scale: { type: "number", description: "Size multiplier for this object, 0.1-8." },
            },
            ["kind"],
          ),
        },
        palette: {
          type: "array",
          items: { type: "string" },
          description: "Three hex colours: body, structure, accent. Pick from the design brief.",
        },
        lighting: { type: "string", enum: ["studio", "daylight", "dusk", "night", "sunrise"], description: "The light in the scene." },
        atmosphere: { type: "string", enum: ["none", "light", "haze", "heavy"], description: "Fog for depth. Light is usually right." },
        detail: { type: "number", description: "1 rough to 5 fine. Defaults to 3." },
        quality: { type: "string", enum: ["draft", "standard", "fine"], description: "draft is fast; fine is slow. Defaults to draft." },
        seed: { type: "number", description: "Same seed, same scene." },
        azimuth: { type: "number", description: "Camera angle around the subject, degrees." },
        elevation: { type: "number", description: "Camera height above the horizon, degrees." },
      },
      ["title", "objects"],
    ),
  },
  {
    name: "make_3d_model",
    description:
      "Build a real 3D model and save it as two artifacts: a Wavefront OBJ mesh you can open in any 3D editor, and a self-contained HTML viewer that orbits with the mouse. Works with no image or 3D service — the geometry is generated. Use it for props, terrain, simple characters and anything a game needs a mesh for.",
    parameters: obj(
      {
        title: { type: "string", description: "What the model is." },
        kind: {
          type: "string",
          enum: ["tree", "crystal", "rock", "pillar", "spaceship", "terrain", "tower", "coin", "vase", "bowl", "bottle", "lamp", "rocket", "sword", "shield", "table", "chair", "arch", "planet", "mushroom"],
          description: "Which generator to use. Leave it out when you are passing parts.",
        },
        detail: { type: "number", description: "1 (very low poly) to 5 (smoother). Defaults to 2." },
        scale: { type: "number", description: "World size, 0.2-20. Defaults to 1." },
        seed: { type: "number", description: "Any number; the same seed gives the same model." },
        palette: { type: "array", items: { type: "string" }, description: "Body, structure, accent colours." },
        parts: {
          type: "array",
          description:
            "Build a model no preset covers, by stacking primitives. Each part is placed on its own: shape is box, cylinder, cone, sphere or icosahedron; size is [x,y,z] for a box; radius and height for the round ones; at is [x,y,z]; color is a palette slot 0-3. Up to 60 parts. When parts are given, kind is ignored.",
          items: obj(
            {
              shape: { type: "string", enum: ["box", "cylinder", "cone", "sphere", "icosahedron"] },
              size: { type: "array", items: { type: "number" } },
              radius: { type: "number" },
              height: { type: "number" },
              at: { type: "array", items: { type: "number" } },
              color: { type: "number" },
            },
            ["shape"],
          ),
        },
      },
      ["title"],
    ),
  },
];

/* --------------------------------- helpers ---------------------------------- */

const HELPER_TOOLS: Tool[] = [
  {
    name: "spawn_helper",
    description:
      "Start a Helper Bot: a separate agent with its own short brief that works on one slice of the job and reports back. Use two to four of them for work that genuinely splits — art, sound, copy, level design — then check on them with helper_status. They run at the same time, so this is faster than doing each part yourself in sequence. Do not spawn a helper for something you can finish in one step.",
    parameters: obj(
      {
        name: { type: "string", description: "Short name, e.g. 'Audio'." },
        task: { type: "string", description: "Exactly what this helper must produce, and the format to produce it in." },
        context: { type: "string", description: "What it needs to know that it cannot see: the design brief, palette, existing files." },
        artifactKind: { type: "string", description: "Artifact kind it should save, if any." },
      },
      ["name", "task"],
    ),
  },
  {
    name: "helper_status",
    description:
      "Check on the Helper Bots you started. Returns each helper's state (working, done, failed) and its report, including any artifact it saved. Call it once or twice with a short wait rather than in a tight loop.",
    parameters: obj(
      { waitSeconds: { type: "number", description: "How long to wait for progress before answering, 0-25." } },
      [],
    ),
  },
];

/* ---------------------------------- packs ----------------------------------- */

export const PACKS: Pack[] = [
  {
    id: "assets",
    title: "Assets",
    purpose: "Art direction, palettes, sprites, icons and SVG assets.",
    tools: ASSET_TOOLS,
    signals: /\b(game|art|artwork|asset|sprite|tile|tileset|icon|logo|palette|colou?r|poster|character|pixel|illustration|illustrate|design|brand|mockup|thumbnail|image|images|picture|photo|photograph|render|drawing|painting|texture)\b/i,
  },
  {
    id: "game",
    title: "Game development",
    purpose: "Designing, building and playtesting a browser game.",
    tools: GAME_TOOLS,
    signals: /\b(game|games|gameplay|platformer|puzzle|shooter|rpg|level|player|enemy|score|arcade|roguelike|physics|collision)\b/i,
  },
  {
    id: "motion",
    title: "Motion graphics",
    purpose: "Storyboards and browser-rendered animation, title cards, kinetic type.",
    tools: MOTION_TOOLS,
    signals: /\b(animate|animated|animation|motion|video|storyboard|title card|kinetic|transition|intro|outro|reel|trailer|gif)\b/i,
  },
  {
    id: "web",
    title: "Web development",
    purpose: "Planning, building and auditing a self-contained website.",
    tools: WEB_TOOLS,
    signals: /\b(landing|website|web page|webpage|html|css|site|portfolio|storefront|dashboard|responsive)\b/i,
  },
  {
    id: "lookup",
    title: "Live lookups",
    purpose: "Answers that live on a website, fetched the cheap way or the slow way, deliberately.",
    tools: LOOKUP_TOOLS,
    signals: /\b(flight|flights|airfare|hotel|hotels|train|bus|fare|fares|price|prices|cost|cheap|cheapest|stock|stocks|crypto|weather|forecast|schedule|schedules|listing|listings|score|scores|odds|availability|book|booking|reserve|look up|lookup|latest|live|current)\b/i,
  },
  {
    id: "models",
    title: "3D models",
    purpose: "Real meshes and viewers for props, terrain and simple characters, and Blender for photoreal renders.",
    tools: MODEL_TOOLS,
    signals: /\b(3d|model|models|mesh|meshes|obj|glb|gltf|stl|terrain|prop|props|sculpt|isometric|low[- ]poly|asset pack|blender|kinetix|render|renders|rendered|photoreal|photorealistic|shader|turntable|product shot)\b/i,
  },
  {
    id: "helpers",
    title: "Helper Bots",
    purpose: "Splitting a large build across agents that work at the same time.",
    tools: HELPER_TOOLS,
    signals: /\b(make|build|create|design|generate|write|produce|code|develop)\b[\s\S]{0,80}\b(game|site|website|app|video|animation|poster|brand|presentation|experience|world)\b/i,
  },
];

/**
 * Which packs a message should load.
 *
 * Deliberately keyword-driven and local: it costs nothing, it never fails
 * open, and it is easy to explain. A model-based router would be cleverer and
 * slower than the request it is routing.
 */
export function packsFor(message: string, opts: { hasComputer: boolean }): Pack[] {
  const text = message.toLowerCase();
  return PACKS.filter((pack) => pack.signals.test(text) && (!pack.needsComputer || opts.hasComputer));
}

/** Tools for the selected packs, de-duplicated by name. */
export function toolsForPacks(packs: Pack[]): Tool[] {
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const pack of packs) {
    for (const tool of pack.tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      out.push(tool);
    }
  }
  return out;
}

/** One paragraph describing the loaded packs, for the system prompt. */
export function packsPrompt(packs: Pack[]): string {
  if (!packs.length) return "";
  const lines = packs.map((pack) => `- ${pack.title}: ${pack.purpose}`);
  return [
    "The tools you have been given this turn are grouped by the kind of work you are doing:",
    ...lines,
    "Use them in the natural order — brief, then plan, then build, then check — rather than jumping straight to code. When a pack's work is finished, say what exists and where it lives; do not describe a plan as if it were a result.",
  ].join("\n");
}

/** Tool names across every pack, for permission UIs and validation. */
export const PACK_TOOL_NAMES: string[] = PACKS.flatMap((pack) => pack.tools.map((tool) => tool.name));

export function isPackTool(name: string): boolean {
  return PACK_TOOL_NAMES.includes(name);
}
