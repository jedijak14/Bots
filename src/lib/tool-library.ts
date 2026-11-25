import type { Tool } from "./ai/llm";

/**
 * The tool library.
 *
 * A thousand tools is not the same as a thousand tools in the prompt. Sending
 * every schema on every step is what makes models worse at choosing: they pick
 * from a long list badly and the request grows without bound. So the library
 * holds the definitions, each tagged with the words that mean it is relevant,
 * and the run only puts a matched subset in front of the model.
 *
 * The tools themselves are generated from real operations rather than written
 * one by one. Every project tool drives the same `project` action (create,
 * open, list, duplicate...), and every media tool drives `produce`. That keeps
 * each entry honest — there is one implementation behind it, and this file
 * cannot drift from it — while still giving the model a precise name to ask for
 * ("create_project_starter_game" rather than "do something with a game").
 */

export type LibraryCategory = "project" | "code" | "media" | "research" | "design" | "data" | "business" | "learning" | "writing" | "life";

export type LibraryTool = {
  name: string;
  category: LibraryCategory;
  /** Words that pull this tool in. Kept short and specific. */
  keywords: string[];
  summary: string;
  /** What the executor does with it. */
  action: string;
  /** Free-form arguments folded into the action. */
  preset?: Record<string, string>;
  tool: Tool;
  /**
   * Words that name this tool specifically, as opposed to the family it
   * belongs to. "developer" distinguishes write_readme_for_developer from the
   * other four readme variants; "readme" does not.
   */
  specific: string[];
};

const PROJECT_SUBJECTS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "platformer", label: "a platformer", words: ["platformer", "jump", "platform"] },
  { key: "puzzle", label: "a puzzle game", words: ["puzzle", "match", "logic"] },
  { key: "shooter", label: "a shooter", words: ["shooter", "shoot", "bullet"] },
  { key: "rpg", label: "an RPG", words: ["rpg", "quest", "character", "party"] },
  { key: "racing", label: "a racing game", words: ["racing", "race", "car", "driving"] },
  { key: "idle", label: "an idle game", words: ["idle", "clicker", "incremental"] },
  { key: "card", label: "a card game", words: ["card", "deck", "poker"] },
  { key: "tower", label: "a tower defence game", words: ["tower", "defence", "defense"] },
  { key: "endless-runner", label: "an endless runner", words: ["runner", "endless", "dash"] },
  { key: "word", label: "a word game", words: ["word", "spelling", "crossword"] },
  { key: "sandbox", label: "a sandbox", words: ["sandbox", "building", "craft"] },
  { key: "landing-page", label: "a landing page", words: ["landing", "launch", "waitlist"] },
  { key: "portfolio", label: "a portfolio", words: ["portfolio", "showcase", "work"] },
  { key: "store", label: "a storefront", words: ["store", "shop", "ecommerce", "products"] },
  { key: "blog", label: "a blog", words: ["blog", "article", "writing"] },
  { key: "dashboard", label: "a dashboard", words: ["dashboard", "metrics", "admin"] },
  { key: "pricing-page", label: "a pricing page", words: ["pricing", "plans", "tiers"] },
  { key: "waitlist", label: "a waitlist page", words: ["waitlist", "signup", "early"] },
  { key: "docs-site", label: "a docs site", words: ["docs", "documentation", "guide"] },
  { key: "restaurant-site", label: "a restaurant site", words: ["restaurant", "menu", "cafe", "bakery"] },
  { key: "event-site", label: "an event site", words: ["event", "conference", "wedding"] },
  { key: "agency-site", label: "an agency site", words: ["agency", "studio", "services"] },
  { key: "link-in-bio", label: "a link page", words: ["link", "bio", "links"] },
  { key: "quiz", label: "a quiz", words: ["quiz", "trivia", "test"] },
  { key: "calculator", label: "a calculator", words: ["calculator", "estimate", "quote"] },
  { key: "timeline", label: "a timeline", words: ["timeline", "history", "milestones"] },
  { key: "map", label: "a map", words: ["map", "location", "geography"] },
  { key: "chat-app", label: "a chat app", words: ["chat", "messaging", "inbox"] },
  { key: "habit-tracker", label: "a habit tracker", words: ["habit", "streak", "tracker"] },
  { key: "budget-tool", label: "a budget tool", words: ["budget", "expense", "money", "finance"] },
  { key: "recipe-app", label: "a recipe app", words: ["recipe", "cooking", "ingredients"] },
  { key: "workout", label: "a workout app", words: ["workout", "exercise", "fitness", "gym"] },
  { key: "flashcards", label: "a flashcard app", words: ["flashcard", "study", "memory", "learn"] },
  { key: "kanban", label: "a kanban board", words: ["kanban", "board", "tasks", "todo"] },
  { key: "calendar", label: "a calendar", words: ["calendar", "schedule", "appointments"] },
  { key: "invoice", label: "an invoice tool", words: ["invoice", "billing", "receipt"] },
  { key: "survey", label: "a survey", words: ["survey", "form", "questionnaire", "feedback"] },
  { key: "resume", label: "a resume site", words: ["resume", "cv", "hiring"] },
  { key: "wiki", label: "a wiki", words: ["wiki", "knowledge", "notes"] },
  { key: "music-player", label: "a music player", words: ["music", "player", "audio", "playlist"] },
  { key: "weather", label: "a weather page", words: ["weather", "forecast", "temperature"] },
  { key: "photo-gallery", label: "a photo gallery", words: ["photo", "gallery", "images", "album"] },
  { key: "booking", label: "a booking flow", words: ["booking", "reserve", "appointment"] },
  { key: "checkout", label: "a checkout flow", words: ["checkout", "cart", "payment", "buy"] },
  { key: "onboarding", label: "an onboarding flow", words: ["onboarding", "signup", "welcome", "tutorial"] },
  { key: "settings-page", label: "a settings page", words: ["settings", "preferences", "account"] },
  { key: "pricing-table", label: "a pricing table", words: ["pricing", "table", "compare"] },
  { key: "changelog", label: "a changelog", words: ["changelog", "releases", "updates"] },
  { key: "faq", label: "an FAQ", words: ["faq", "questions", "answers"] },
  { key: "error-page", label: "an error page", words: ["error", "404", "500"] },
  { key: "splash", label: "a splash screen", words: ["splash", "loading", "skeleton"] },
  { key: "leaderboard", label: "a leaderboard", words: ["leaderboard", "ranking", "scores"] },
  { key: "search-page", label: "a search page", words: ["search", "filter", "results"] },
  { key: "auth-flow", label: "an auth flow", words: ["auth", "login", "password"] },
  { key: "api-docs", label: "API docs", words: ["api", "endpoints", "reference"] },
];

const PROJECT_VERBS: Array<{ key: string; label: string; words: string[]; action: string }> = [
  { key: "create", label: "Create", words: ["create", "make", "new", "build", "start"], action: "create_project" },
  { key: "brief", label: "Plan", words: ["plan", "brief", "spec", "outline"], action: "create_project" },
  { key: "check", label: "Check", words: ["check", "audit", "review", "test", "verify"], action: "audit_project" },
];

const MEDIA_SUBJECTS: Array<{ key: string; label: string; words: string[]; kind: string }> = [
  { key: "logo", label: "logo", words: ["logo", "mark", "wordmark"], kind: "logo" },
  { key: "icon-set", label: "icon set", words: ["icon", "icons", "glyphs"], kind: "icon_set" },
  { key: "poster", label: "poster", words: ["poster", "flyer", "print"], kind: "poster" },
  { key: "social-card", label: "social card", words: ["social", "og", "share", "card"], kind: "social_card" },
  { key: "avatar", label: "avatar", words: ["avatar", "profile", "face"], kind: "avatar" },
  { key: "sprite", label: "sprite", words: ["sprite", "character", "pixel"], kind: "sprite" },
  { key: "tileset", label: "tileset", words: ["tileset", "tile", "level"], kind: "tileset" },
  { key: "ui-kit", label: "UI kit", words: ["ui", "kit", "components", "buttons"], kind: "ui_kit" },
  { key: "pattern", label: "pattern", words: ["pattern", "texture", "background"], kind: "pattern" },
  { key: "badge", label: "badge", words: ["badge", "sticker", "label"], kind: "badge" },
  { key: "thumbnail", label: "thumbnail", words: ["thumbnail", "cover", "youtube"], kind: "thumbnail" },
  { key: "invitation", label: "invitation", words: ["invitation", "invite", "announcement"], kind: "invitation" },
  { key: "title-card", label: "title card", words: ["title", "intro", "opening"], kind: "title_card" },
  { key: "lower-third", label: "lower third", words: ["lower third", "caption", "name plate"], kind: "lower_third" },
  { key: "storyboard", label: "storyboard", words: ["storyboard", "shots", "frames"], kind: "storyboard" },
  { key: "kinetic-type", label: "kinetic type", words: ["kinetic", "type", "typography", "text"], kind: "kinetic_type" },
  { key: "transition", label: "transition", words: ["transition", "wipe", "cut"], kind: "transition" },
  { key: "chart", label: "chart", words: ["chart", "graph", "data", "viz"], kind: "chart" },
  { key: "diagram", label: "diagram", words: ["diagram", "flow", "architecture"], kind: "diagram" },
  { key: "map-illustration", label: "map illustration", words: ["map", "illustration", "cartography"], kind: "map" },
  { key: "book-cover", label: "book cover", words: ["book", "cover", "novel"], kind: "book_cover" },
  { key: "packaging", label: "packaging", words: ["packaging", "box", "product"], kind: "packaging" },
  { key: "menu", label: "menu", words: ["menu", "food", "restaurant"], kind: "menu" },
  { key: "certificate", label: "certificate", words: ["certificate", "award", "diploma"], kind: "certificate" },
  { key: "wallpaper", label: "wallpaper", words: ["wallpaper", "background", "desktop"], kind: "wallpaper" },
  { key: "banner", label: "banner", words: ["banner", "header", "hero"], kind: "banner" },
  { key: "sticker-pack", label: "sticker pack", words: ["sticker", "emoji", "reaction"], kind: "sticker_pack" },
  { key: "invoice-template", label: "invoice template", words: ["invoice", "receipt", "billing"], kind: "invoice" },
  { key: "resume-template", label: "resume template", words: ["resume", "cv", "applicant"], kind: "resume" },
  { key: "presentation", label: "presentation deck", words: ["presentation", "deck", "slides"], kind: "presentation" },
  { key: "logo-animation", label: "logo animation", words: ["logo", "reveal", "animation"], kind: "logo_animation" },
  { key: "data-animation", label: "animated chart", words: ["chart", "data", "animate"], kind: "data_animation" },
  { key: "explainer", label: "explainer frames", words: ["explainer", "how it works", "steps"], kind: "explainer" },
  { key: "social-story", label: "story graphics", words: ["story", "instagram", "tiktok"], kind: "social_story" },
  { key: "email-signature", label: "email signature", words: ["signature", "email", "footer"], kind: "email_signature" },
  { key: "letterhead", label: "letterhead", words: ["letterhead", "stationery", "company"], kind: "letterhead" },
  { key: "business-card", label: "business card", words: ["business card", "contact", "networking"], kind: "business_card" },
  { key: "t-shirt", label: "t-shirt graphic", words: ["shirt", "apparel", "merch"], kind: "tshirt" },
  { key: "merch-mockup", label: "merch mockup", words: ["merch", "mockup", "product"], kind: "merch" },
  { key: "album-cover", label: "album cover", words: ["album", "cover", "music"], kind: "album_cover" },
];

const RESEARCH_SOURCES: Array<{ key: string; label: string; words: string[] }> = [
  { key: "web", label: "the open web", words: ["web", "internet", "google", "search"] },
  { key: "docs", label: "library documentation", words: ["docs", "documentation", "api", "reference"] },
  { key: "pricing", label: "pricing pages", words: ["pricing", "cost", "plans", "cheap"] },
  { key: "competitors", label: "competitors", words: ["competitor", "compare", "versus", "alternatives"] },
  { key: "reviews", label: "reviews", words: ["review", "rating", "opinion"] },
  { key: "papers", label: "papers", words: ["paper", "research", "study", "arxiv"] },
  { key: "news", label: "news", words: ["news", "latest", "announcement"] },
  { key: "jobs", label: "job postings", words: ["job", "hiring", "salary"] },
  { key: "recipes", label: "recipes", words: ["recipe", "cook", "food"] },
  { key: "travel", label: "travel options", words: ["travel", "flight", "hotel", "trip"] },
  { key: "local", label: "local businesses", words: ["local", "nearby", "restaurant"] },
  { key: "events", label: "events", words: ["event", "tickets", "concert"] },
];

const DESIGN_TOPICS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "palette", label: "a palette", words: ["palette", "colour", "color", "scheme"] },
  { key: "type-scale", label: "a type scale", words: ["type", "font", "scale", "typography"] },
  { key: "spacing", label: "a spacing scale", words: ["spacing", "layout", "grid", "rhythm"] },
  { key: "elevation", label: "elevation rules", words: ["shadow", "elevation", "depth"] },
  { key: "motion", label: "motion rules", words: ["motion", "easing", "duration", "animation"] },
  { key: "contrast", label: "a contrast check", words: ["contrast", "accessibility", "wcag", "a11y"] },
  { key: "iconography", label: "an iconography rule", words: ["icon", "iconography", "stroke"] },
  { key: "voice", label: "a voice and tone guide", words: ["brand voice", "writing style", "copywriting"] },
];

const DATA_JOBS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "parse-csv", label: "CSV", words: ["csv", "spreadsheet", "table"] },
  { key: "parse-json", label: "JSON", words: ["json", "api", "object"] },
  { key: "summarise", label: "a summary", words: ["summarise", "summarize", "summary", "count"] },
  { key: "chart-data", label: "a chart", words: ["chart", "plot", "graph"] },
  { key: "clean", label: "cleaning", words: ["clean", "dedupe", "duplicate", "messy"] },
  { key: "convert", label: "converting", words: ["convert", "format", "transform"] },
];

/**
 * Business documents people actually have to produce.
 *
 * Each entry is a real deliverable with a known shape — a scope of work has
 * sections a contract has and a blog post does not. That shape is what the
 * library is for: it turns "write an SOW" into a brief with the right headings
 * instead of a generic document.
 */
const BUSINESS_DOCS: Array<{ key: string; label: string; words: string[]; sections: string }> = [
  { key: "sow", label: "a statement of work", words: ["sow", "statement of work", "scope of work", "contract"] , sections: "scope, deliverables, timeline, assumptions, out of scope, acceptance, fees" },
  { key: "proposal", label: "a project proposal", words: ["proposal", "pitch deck", "bid", "quote"], sections: "problem, approach, deliverables, timeline, team, pricing, why us" },
  { key: "invoice", label: "an invoice", words: ["invoice", "bill", "receipt", "payment"], sections: "from, to, items with quantities and rates, subtotal, tax, total, terms, payment details" },
  { key: "estimate", label: "an estimate", words: ["estimate", "quote", "cost breakdown"], sections: "items, hours, rate, contingency, total, validity, exclusions" },
  { key: "meeting-notes", label: "meeting notes", words: ["meeting", "notes", "minutes", "standup"], sections: "attendees, decisions, actions with owners and dates, open questions" },
  { key: "status-report", label: "a status report", words: ["status", "update", "progress report"], sections: "summary, done, in progress, blocked, next, risks" },
  { key: "one-pager", label: "a one-pager", words: ["one pager", "brief", "summary sheet"], sections: "the problem, the offer, the evidence, the ask" },
  { key: "job-post", label: "a job posting", words: ["job posting", "hiring", "job description", "role"], sections: "role, responsibilities, must-haves, nice-to-haves, salary, process" },
  { key: "press-release", label: "a press release", words: ["press release", "pr", "announcement"], sections: "headline, dateline, lede, quote, detail, boilerplate, contact" },
  { key: "case-study", label: "a case study", words: ["case study", "success story", "testimonial"], sections: "client, problem, what we did, results with numbers, quote" },
  { key: "policy", label: "a policy document", words: ["policy", "handbook", "rules", "guidelines"], sections: "purpose, scope, who it applies to, the rules, exceptions, review date" },
  { key: "runbook", label: "a runbook", words: ["runbook", "playbook", "procedure", "sop"], sections: "trigger, prerequisites, steps, verification, rollback, who to call" },
  { key: "contract-review", label: "a contract review memo", words: ["contract review", "legal review", "redline"], sections: "parties, term, obligations, risk clauses, missing protections, recommendation" },
  { key: "budget", label: "a budget", words: ["budget", "spending plan", "forecast"], sections: "categories, monthly figures, annual total, assumptions, contingencies" },
  { key: "pitch-email", label: "a pitch email", words: ["cold email", "outreach", "pitch email"], sections: "subject, why you, one specific proof, one clear ask, short signature" },
  { key: "swot", label: "a SWOT analysis", words: ["swot", "strengths", "analysis"], sections: "strengths, weaknesses, opportunities, threats, so what" },
  { key: "okrs", label: "OKRs", words: ["okr", "objectives", "key results"], sections: "three objectives, two to four measurable key results each, owner, check-in cadence" },
  { key: "faq", label: "an FAQ", words: ["faq", "questions", "help page"], sections: "the ten questions people actually ask, answered plainly" },
];

/**
 * Things people learn, at the level a tutor would pitch them.
 *
 * A lesson plan has a shape too: what the learner can already do, what this
 * adds, one worked example, one thing to try alone. Naming it turns "teach me
 * recursion" into a plan rather than a paragraph.
 */
const LEARNING_TOPICS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "lesson-plan", label: "a lesson plan", words: ["lesson", "teach", "taught", "teaching", "class", "curriculum", "learn", "recursion"] },
  { key: "study-guide", label: "a study guide", words: ["study", "revise", "exam", "test prep"] },
  { key: "flashcards", label: "flashcards", words: ["flashcard", "flashcards", "memorise", "memorize", "cards", "spaced repetition", "vocab", "vocabulary", "verbs"] },
  { key: "practice-set", label: "a practice set", words: ["practice", "exercises", "problems", "drill"] },
  { key: "explainer", label: "an explainer", words: ["explain", "how does", "what is", "eli5"] },
  { key: "worked-example", label: "a worked example", words: ["example", "walkthrough", "step by step"] },
  { key: "syllabus", label: "a syllabus", words: ["syllabus", "course", "module"] },
  { key: "quiz", label: "a quiz", words: ["quiz", "questions", "assessment"] },
  { key: "cheat-sheet", label: "a cheat sheet", words: ["cheat sheet", "reference card", "quick reference"] },
  { key: "learning-path", label: "a learning path", words: ["learning path", "roadmap", "from scratch", "become"] },
];

/**
 * Writing that is not a document: things with a voice and a length.
 */
const WRITING_JOBS: Array<{ key: string; label: string; words: string[]; shape: string }> = [
  { key: "blog-post", label: "a blog post", words: ["blog", "article", "post"], shape: "a hook, a promise, three or four sections, a close that earns its ending" },
  { key: "newsletter", label: "a newsletter", words: ["newsletter", "email blast", "digest"], shape: "subject line, one idea, one link list, a sign-off" },
  { key: "landing-copy", label: "landing page copy", words: ["landing page", "hero copy", "headline"], shape: "headline, subhead, three benefits with proof, objection handling, single call to action" },
  { key: "product-description", label: "product descriptions", words: ["product description", "shop listing", "ecommerce"], shape: "one sentence of what it is, three of why it is different, specs, sizes" },
  { key: "social-post", label: "social posts", words: ["social post", "tweet", "thread", "linkedin post"], shape: "a line that stops the scroll, the substance, one ask, no hashtag soup" },
  { key: "video-script", label: "a video script", words: ["script", "video", "youtube"], shape: "hook in the first five seconds, setup, payoff, call to action, timings marked" },
  { key: "speech", label: "a speech", words: ["speech", "talk", "toast", "keynote"], shape: "opening that names the room, one throughline, three beats, a close that lands" },
  { key: "bio", label: "a bio", words: ["bio", "about me", "biography", "speaker profile"], shape: "first person, third person and one-line versions" },
  { key: "cover-letter", label: "a cover letter", words: ["cover letter", "application", "applying"], shape: "why this role, one piece of evidence, what you would do first, brief close" },
  { key: "resume", label: "a resume", words: ["resume", "cv", "curriculum vitae"], shape: "summary, roles with outcomes not duties, skills, education" },
  { key: "apology", label: "an apology or correction", words: ["apology", "sorry", "correction", "retraction"], shape: "what happened, what it affected, what changes, no hedging" },
  { key: "negotiation-email", label: "a negotiation email", words: ["negotiate", "counter offer", "raise", "salary"], shape: "the ask with a number, the case for it, what you will do, room to respond" },
];

/**
 * Everyday jobs with a real structure, not small talk.
 */
const LIFE_JOBS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "meal-plan", label: "a meal plan", words: ["meal plan", "meals", "meal", "menu", "food", "diet", "weekly meals", "cook", "dinner"] },
  { key: "shopping-list", label: "a shopping list", words: ["shopping list", "groceries", "grocery", "buy", "shop"] },
  { key: "workout-plan", label: "a workout plan", words: ["workout", "exercise", "gym", "training"] },
  { key: "travel-itinerary", label: "a travel itinerary", words: ["itinerary", "trip", "travel", "holiday"] },
  { key: "moving-checklist", label: "a moving checklist", words: ["move", "moving", "relocation"] },
  { key: "event-plan", label: "an event plan", words: ["event", "party", "wedding", "conference"] },
  { key: "packing-list", label: "a packing list", words: ["pack", "packing", "luggage"] },
  { key: "cleaning-schedule", label: "a cleaning schedule", words: ["clean", "chores", "housework"] },
  { key: "budget-plan", label: "a personal budget", words: ["budget", "money", "savings", "expenses"] },
  { key: "care-plan", label: "a care plan", words: ["care", "plant", "pet", "garden"] },
  { key: "gift-list", label: "a gift list", words: ["gift", "present", "birthday"] },
  { key: "home-project", label: "a home project plan", words: ["renovate", "diy", "build", "repair"] },
];

const CODE_TASKS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "scaffold", label: "scaffold a file", words: ["scaffold", "boilerplate", "template", "starter"] },
  { key: "explain", label: "explain code", words: ["explain", "understand", "how does"] },
  { key: "fix", label: "fix a bug", words: ["fix", "bug", "broken", "error"] },
  { key: "refactor", label: "refactor", words: ["refactor", "clean up", "simplify"] },
  { key: "test", label: "write tests", words: ["test", "spec", "coverage"] },
  { key: "types", label: "add types", words: ["types", "typescript", "typing"] },
  { key: "perf", label: "improve performance", words: ["performance", "slow", "optimise", "optimize"] },
  { key: "a11y", label: "improve accessibility", words: ["accessibility", "a11y", "screen reader", "keyboard"] },
];

/**
 * The formats an asset can be delivered in. These are real differences, not
 * renames: an animated piece ships as frames or as a browser animation, a
 * print piece ships as vector for the printer or PNG for review.
 */
const FORMATS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "svg", label: "as SVG", words: ["svg", "vector", "scalable"] },
  { key: "animated", label: "animated", words: ["animated", "motion", "moving"] },
  { key: "print", label: "print-ready", words: ["print", "300dpi", "bleed"] },
  { key: "web", label: "optimised for the web", words: ["web", "lightweight", "page"] },
];

function makeTool(
  name: string,
  category: LibraryCategory,
  keywords: string[],
  summary: string,
  action: string,
  preset: Record<string, string>,
  specific: string[] = [],
): LibraryTool {
  return {
    name,
    category,
    keywords,
    summary,
    action,
    preset,
    specific,
    tool: {
      name,
      description: `${summary} Then hand off to the ${action} step: it produces a real artifact you can open, not a description of one.`,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short name for what is being produced." },
          detail: { type: "string", description: "The specifics: subject, audience, constraints, anything the step needs." },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  };
}


/** Real ecosystems a build can target, each with its own idioms and pitfalls. */
const STACKS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "react", label: "React", words: ["react", "jsx", "component"] },
  { key: "nextjs", label: "Next.js", words: ["next", "nextjs", "app router"] },
  { key: "vue", label: "Vue", words: ["vue", "nuxt"] },
  { key: "svelte", label: "Svelte", words: ["svelte", "sveltekit"] },
  { key: "vanilla-js", label: "plain JavaScript", words: ["vanilla", "javascript", "js", "dom"] },
  { key: "canvas", label: "Canvas", words: ["canvas", "2d", "draw"] },
  { key: "webgl", label: "WebGL", words: ["webgl", "shader", "3d", "gpu"] },
  { key: "css", label: "CSS", words: ["css", "style", "layout"] },
  { key: "tailwind", label: "Tailwind", words: ["tailwind", "utility", "classes"] },
  { key: "svg", label: "SVG", words: ["svg", "vector", "path"] },
  { key: "python", label: "Python", words: ["python", "py", "script"] },
  { key: "node", label: "Node", words: ["node", "npm", "server"] },
  { key: "supabase", label: "Supabase", words: ["supabase", "postgres", "auth", "database"] },
  { key: "firebase", label: "Firebase", words: ["firebase", "firestore", "google"] },
  { key: "stripe", label: "Stripe", words: ["stripe", "payments", "billing", "subscription"] },
  { key: "openai", label: "an LLM API", words: ["openai", "llm", "gpt", "claude", "model api"] },
  { key: "threejs", label: "Three.js", words: ["three", "threejs", "scene", "mesh"] },
  { key: "phaser", label: "Phaser", words: ["phaser", "gameframework"] },
  { key: "unity", label: "Unity", words: ["unity", "csharp", "prefab"] },
  { key: "godot", label: "Godot", words: ["godot", "gdscript", "scene tree"] },
  { key: "flutter", label: "Flutter", words: ["flutter", "dart", "mobile"] },
  { key: "react-native", label: "React Native", words: ["react native", "expo", "ios", "android"] },
  { key: "electron", label: "Electron", words: ["electron", "desktop app", "window"] },
  { key: "wordpress", label: "WordPress", words: ["wordpress", "cms", "theme", "plugin"] },
  { key: "shopify", label: "Shopify", words: ["shopify", "store", "liquid"] },
];

/** Jobs a build needs done regardless of stack. */
const BUILD_JOBS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "routing", label: "routing", words: ["route", "page", "navigation", "link"] },
  { key: "state", label: "state management", words: ["state", "store", "redux", "context"] },
  { key: "forms", label: "forms", words: ["form", "input", "validation", "submit"] },
  { key: "loading", label: "loading states", words: ["loading", "skeleton", "spinner", "wait"] },
  { key: "empty-states", label: "empty states", words: ["empty", "nothing", "zero", "first run"] },
  { key: "errors", label: "error handling", words: ["error", "failure", "retry", "exception"] },
  { key: "responsive", label: "responsive layout", words: ["responsive", "mobile", "breakpoint", "wide"] },
  { key: "dark-mode", label: "dark mode", words: ["dark", "theme", "light mode"] },
  { key: "animation", label: "animation", words: ["animation", "transition", "motion", "ease"] },
  { key: "seo", label: "SEO", words: ["seo", "meta", "search", "crawl"] },
  { key: "analytics", label: "analytics", words: ["analytics", "track", "event", "measure"] },
  { key: "auth", label: "authentication", words: ["auth", "login", "session", "user"] },
  { key: "performance", label: "performance", words: ["performance", "speed", "bundle", "lazy"] },
  { key: "testing", label: "tests", words: ["test", "spec", "assert", "mock"] },
  { key: "deploy", label: "deployment", words: ["deploy", "host", "build", "ci"] },
  { key: "data-fetching", label: "data fetching", words: ["fetch", "request", "api", "cache"] },
  { key: "accessibility", label: "accessibility", words: ["accessibility", "a11y", "aria", "focus"] },
  { key: "i18n", label: "localisation", words: ["i18n", "translation", "locale", "language"] },
  { key: "security", label: "security", words: ["security", "xss", "csrf", "injection"] },
  { key: "payments", label: "payments", words: ["payment", "checkout", "price", "stripe"] },
];

/** Integrations: things a Bot can wire into a build. */
const INTEGRATIONS: Array<{ key: string; label: string; words: string[] }> = [
  { key: "github", label: "GitHub", words: ["github", "repo", "pull request"] },
  { key: "vercel", label: "Vercel", words: ["vercel", "deploy", "preview"] },
  { key: "gmail", label: "Gmail", words: ["gmail", "inbox", "email"] },
  // "page" alone belongs to landing pages and web pages far more often than to
  // Notion. Notion's own name and "workspace" are unambiguous.
  { key: "notion", label: "Notion", words: ["notion", "workspace", "notion doc"] },
  { key: "spotify", label: "Spotify", words: ["spotify", "track", "playlist"] },
  { key: "youtube", label: "YouTube", words: ["youtube", "video", "channel"] },
  { key: "slack", label: "Slack", words: ["slack", "message", "channel"] },
  { key: "discord", label: "Discord", words: ["discord", "server", "bot"] },
  { key: "sheets", label: "Google Sheets", words: ["sheet", "spreadsheet", "rows"] },
  { key: "airtable", label: "Airtable", words: ["airtable", "base", "record"] },
  { key: "calendar", label: "a calendar", words: ["calendar", "event", "invite"] },
  { key: "maps", label: "maps", words: ["map", "location", "address"] },
];

/** Written deliverables a build or a business actually needs. */
const DOCUMENTS: Array<{ key: string; label: string; words: string[]; kind: string }> = [
  { key: "readme", label: "a README", words: ["readme", "install", "usage"], kind: "readme" },
  { key: "landing-copy", label: "landing page copy", words: ["copy", "headline", "hero text"], kind: "landing_copy" },
  { key: "product-spec", label: "a product spec", words: ["spec", "requirements", "scope"], kind: "spec" },
  { key: "prd", label: "a PRD", words: ["prd", "product doc"], kind: "prd" },
  { key: "release-notes", label: "release notes", words: ["release", "changelog", "notes"], kind: "release_notes" },
  { key: "onboarding-email", label: "an onboarding email", words: ["onboarding", "welcome", "sequence", "nurture", "drip"], kind: "email" },
  { key: "pitch-deck", label: "a pitch deck", words: ["pitch", "deck", "investor"], kind: "pitch" },
  { key: "case-study", label: "a case study", words: ["case study", "results", "client"], kind: "case_study" },
  { key: "faq-copy", label: "FAQ copy", words: ["faq", "questions", "answers"], kind: "faq" },
  { key: "terms", label: "terms of service", words: ["terms", "legal", "policy"], kind: "terms" },
  { key: "privacy-policy", label: "a privacy policy", words: ["privacy", "policy", "data"], kind: "privacy" },
  { key: "style-guide", label: "a style guide", words: ["style", "guide", "brand"], kind: "style_guide" },
  { key: "user-persona", label: "user personas", words: ["persona", "audience", "user"], kind: "persona" },
  { key: "roadmap", label: "a roadmap", words: ["roadmap", "milestones", "quarters"], kind: "roadmap" },
  { key: "test-plan", label: "a test plan", words: ["test", "qa", "coverage"], kind: "test_plan" },
  { key: "runbook", label: "a runbook", words: ["runbook", "ops", "incident"], kind: "runbook" },
  { key: "interview-questions", label: "interview questions", words: ["interview", "hiring", "candidate"], kind: "interview" },
  { key: "email-sequence", label: "an email sequence", words: ["sequence", "drip", "campaign"], kind: "sequence" },
  { key: "seo-brief", label: "an SEO brief", words: ["seo", "keywords", "ranking"], kind: "seo" },
  { key: "postmortem", label: "a postmortem", words: ["postmortem", "incident", "retrospective"], kind: "postmortem" },
];

const AUDIENCES: Array<{ key: string; label: string; words: string[] }> = [
  // Plurals are listed: "release notes for developers" named the audience in a
  // form the singular word did not match, so all five variants tied.
  { key: "developer", label: "a developer", words: ["developer", "developers", "engineer", "engineers", "technical", "dev"] },
  { key: "executive", label: "an executive", words: ["executive", "executives", "leadership", "brief", "board"] },
  { key: "customer", label: "a customer", words: ["customer", "customers", "user", "users", "buyer", "buyers", "client"] },
  { key: "investor", label: "an investor", words: ["investor", "investors", "funding", "raise", "vc"] },
  { key: "beginner", label: "a beginner", words: ["beginner", "beginners", "simple", "plain english", "non-technical"] },
];

const GAME_MODES: Array<{ key: string; label: string; words: string[] }> = [
  { key: "2d-topdown", label: "2D top-down", words: ["top down", "topdown", "2d"] },
  // "platformer" is a genre, not a camera. Keeping it in the mode words meant
  // build_game_card_2d_side advertised itself as a platformer, so asking for a
  // platformer was answered with a card game.
  { key: "2d-side", label: "2D side-on", words: ["side", "sidescroll", "side on"] },
  { key: "3d", label: "3D", words: ["3d", "three", "perspective"] },
  { key: "isometric", label: "isometric", words: ["isometric", "iso", "tiles"] },
  { key: "first-person", label: "first person", words: ["first person", "fps", "pov"] },
  { key: "turn-based", label: "turn based", words: ["turn", "tactics", "strategy"] },
  { key: "multiplayer-local", label: "local multiplayer", words: ["multiplayer", "two player", "coop"] },
  { key: "touch", label: "touch first", words: ["touch", "mobile", "swipe", "tap"] },
];

/** Built once at module load: ~1000 entries, each a few hundred bytes. */
function buildLibrary(): LibraryTool[] {
  const out: LibraryTool[] = [];

  // projects (30 subjects x create/plan/check)
  for (const subject of PROJECT_SUBJECTS) {
    for (const verb of PROJECT_VERBS) {
      out.push(
        makeTool(
          `${verb.key}_${subject.key.replace(/-/g, "_")}`,
          "project",
          // Only the subject goes in the searchable keywords. The verb is
          // already encoded in the tool's action and its first name segment, so
          // repeating "create", "make", "new", "build", "start" here made every
          // one of the thirty subjects match the word "build" — which is how
          // "build a svelte site" returned three unrelated *_site tools.
          [...subject.words],
          `${verb.label} ${subject.label}.`,
          verb.action,
          { medium: subject.key, ...(verb.key === "check" ? {} : { verb: verb.key }) },
          subject.words,
        ),
      );
    }
  }

  // media (24 kinds x 2: generate and plan)
  for (const kind of MEDIA_SUBJECTS) {
    for (const verb of [
      { key: "generate", label: "Generate", words: ["generate", "draw", "make", "create"] },
      { key: "plan", label: "Plan", words: ["plan", "spec", "brief", "think"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${kind.key.replace(/-/g, "_")}`,
          "media",
          [...kind.words, ...verb.words],
          `${verb.label} ${kind.label}.`,
          "produce",
          { kind: kind.kind, verb: verb.key },
        ),
      );
    }
  }

  // media delivery: every kind, in every format it can actually ship in
  for (const kind of MEDIA_SUBJECTS) {
    for (const format of FORMATS) {
      out.push(
        makeTool(
          `${kind.key.replace(/-/g, "_")}_${format.key}`,
          "media",
          [...kind.words, ...format.words],
          `${kind.label[0].toUpperCase()}${kind.label.slice(1)} ${format.label}.`,
          "produce",
          { kind: kind.kind, format: format.key },
        ),
      );
    }
  }

  // research (12 sources x 3: search, summarise, extract)
  for (const source of RESEARCH_SOURCES) {
    for (const verb of [
      { key: "search", label: "Search", words: ["search", "look up", "find"] },
      { key: "summarise", label: "Summarise", words: ["summarise", "summary", "tl;dr"] },
      { key: "compare", label: "Compare", words: ["compare", "diff", "versus"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${source.key.replace(/-/g, "_")}`,
          "research",
          [...source.words, ...verb.words],
          `${verb.label} ${source.label}.`,
          "research",
          { source: source.key, verb: verb.key },
          source.words,
        ),
      );
    }
  }

  // design (8 topics x 4 verbs)
  for (const topic of DESIGN_TOPICS) {
    for (const verb of [
      { key: "define", label: "Define", words: ["define", "choose", "pick", "set"] },
      { key: "audit", label: "Audit", words: ["audit", "check", "review"] },
      { key: "apply", label: "Apply", words: ["apply", "use", "adopt"] },
      { key: "document", label: "Document", words: ["document", "write down", "record"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${topic.key.replace(/-/g, "_")}`,
          "design",
          [...topic.words, ...verb.words],
          `${verb.label} ${topic.label}.`,
          "design_system",
          { topic: topic.key, verb: verb.key },
        ),
      );
    }
  }

  // data (6 jobs x 4 verbs)
  for (const job of DATA_JOBS) {
    for (const verb of [
      { key: "read", label: "Read", words: ["read", "load", "open"] },
      { key: "analyse", label: "Analyse", words: ["analyse", "analyze", "inspect"] },
      { key: "transform", label: "Transform", words: ["transform", "convert", "reshape"] },
      { key: "report", label: "Report", words: ["report", "summarise", "write up"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${job.key.replace(/-/g, "_")}`,
          "data",
          [...job.words, ...verb.words],
          `${verb.label} ${job.label}.`,
          "data_job",
          { job: job.key, verb: verb.key },
        ),
      );
    }
  }

  // code (8 tasks x 5 languages)
  for (const language of ["typescript", "html", "sql"]) {
    for (const task of CODE_TASKS) {
      out.push(
        makeTool(
          `${task.key}_${language}`,
          "code",
          [language, ...task.words],
          `${task.label} in ${language}.`,
          "code_task",
          { language, task: task.key },
        ),
      );
    }
  }

  // stacks: for each real ecosystem, the four things you actually do with it
  for (const stack of STACKS) {
    for (const verb of [
      { key: "scaffold", label: "Set up", words: ["set up", "scaffold", "boilerplate"] },
      { key: "integrate", label: "Integrate", words: ["integrate", "add", "connect"] },
      { key: "debug", label: "Debug", words: ["debug", "broken", "not working", "error"] },
      { key: "optimise", label: "Optimise", words: ["optimise", "optimize", "speed", "improve"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${stack.key.replace(/-/g, "_")}`,
          "code",
          [...stack.words],
          `${verb.label} ${stack.label}.`,
          "code_task",
          { stack: stack.key, verb: verb.key },
          // The stack name is what makes scaffold_svelte different from
          // scaffold_react. Without it the four verbs of a stack were
          // indistinguishable from every other code task.
          stack.words,
        ),
      );
    }
  }

  // build jobs: the universal list, done for a project
  for (const job of BUILD_JOBS) {
    out.push(
      makeTool(
        `add_${job.key.replace(/-/g, "_")}`,
        "project",
        job.words,
        `Add ${job.label} to a build.`,
        "create_project",
        { job: job.key },
      ),
    );
    out.push(
      makeTool(
        `review_${job.key.replace(/-/g, "_")}`,
        "project",
        [...job.words.map((w) => w), "review", "check", "audit"],
        `Review ${job.label} in a build.`,
        "audit_project",
        { job: job.key },
      ),
    );
  }

  // integrations: connect, read from, write to
  for (const integration of INTEGRATIONS) {
    for (const verb of [
      { key: "connect", label: "Connect", words: ["connect", "link", "set up", "authorise"] },
      { key: "read", label: "Read from", words: ["read", "get", "fetch", "list"] },
      { key: "write", label: "Write to", words: ["write", "send", "post", "publish"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${integration.key.replace(/-/g, "_")}`,
          "code",
          [...integration.words, ...verb.words],
          `${verb.label} ${integration.label}.`,
          "integrate",
          { service: integration.key, verb: verb.key },
          integration.words,
        ),
      );
    }
  }

  // documents: every deliverable for every audience it is written for
  for (const doc of DOCUMENTS) {
    for (const audience of AUDIENCES) {
      out.push(
        makeTool(
          `write_${doc.key.replace(/-/g, "_")}_for_${audience.key}`,
          "data",
          [...doc.words, ...audience.words],
          `Write ${doc.label} for ${audience.label}.`,
          "write_document",
          { kind: doc.kind, audience: audience.key },
          // The document's own subject is what makes it specific. Passing the
          // audience here instead meant the only "specific" words were
          // "beginner"/"developer"/"investor": someone asking for release notes
          // named none of those, so all five variants fell into the verb-only
          // bucket and write_meeting_notes won on the word "notes" alone.
          [...doc.words, ...audience.words],
        ),
      );
    }
  }

  // game modes: the perspective changes the whole build, so it is its own axis
  for (const mode of GAME_MODES) {
    for (const subject of PROJECT_SUBJECTS.slice(0, 12)) {
      out.push(
        makeTool(
          `build_game_${subject.key.replace(/-/g, "_")}_${mode.key.replace(/-/g, "_")}`,
          "project",
          // The subject is the subject. Only one of its words is taken, because
          // a second word (often a near-synonym like "card"/"deck") made two
          // different subjects tie for the same query.
          [...subject.words.slice(0, 1), ...mode.words],
          `Build ${subject.label} as a ${mode.label} game.`,
          "create_project",
          { medium: subject.key, mode: mode.key, kind: "game" },
          subject.words,
        ),
      );
    }
  }

  // checks: the passes a build needs before it is called finished
  const CHECKS = [
    { key: "accessibility", label: "accessibility", words: ["accessibility", "a11y", "contrast", "keyboard"] },
    { key: "performance", label: "performance", words: ["performance", "speed", "load time"] },
    { key: "security", label: "security", words: ["security", "vulnerability", "exposure"] },
    { key: "responsive", label: "responsive layout", words: ["responsive", "mobile", "tablet"] },
    { key: "content", label: "copy and content", words: ["copy", "wording", "content"] },
    { key: "seo", label: "search visibility", words: ["seo", "meta", "indexing"] },
    { key: "errors", label: "error handling", words: ["errors", "edge cases", "failure"] },
    { key: "tests", label: "test coverage", words: ["tests", "coverage", "regression"] },
  ];
  const SURFACES = [
    { key: "game", label: "a game", words: ["game", "gameplay"] },
    { key: "website", label: "a website", words: ["website", "site", "page"] },
    { key: "app", label: "an app", words: ["app", "application", "flow"] },
    { key: "motion", label: "a motion piece", words: ["motion", "animation", "video"] },
    { key: "asset", label: "an asset", words: ["asset", "art", "sprite", "logo"] },
  ];
  for (const check of CHECKS) {
    for (const surface of SURFACES) {
      out.push(
        makeTool(
          `check_${surface.key}_${check.key}`,
          "project",
          [...surface.words, ...check.words],
          `Check ${surface.label} for ${check.label}.`,
          "audit_project",
          { surface: surface.key, check: check.key },
        ),
      );
    }
  }

  // Language work: the reading-and-writing jobs people ask for by name, none of
  // which the generated families covered. "transcribe" and "translate" used to
  // search the whole library, match nothing, and fall through to accessibility
  // checkers, which is worse than silence.
  const LANGUAGE_JOBS: Array<{ key: string; label: string; words: string[] }> = [
    { key: "transcribe", label: "an audio or video file into text", words: ["transcribe", "transcription", "caption", "subtitles", "srt", "speech to text"] },
    { key: "translate", label: "text into another language", words: ["translate", "translation", "localise", "localize", "language"] },
    { key: "proofread", label: "correct grammar and spelling", words: ["proofread", "grammar", "spelling", "typo", "copy edit"] },
    { key: "tone", label: "rewrite in a different tone", words: ["tone", "rewrite", "friendly", "formal", "concise"] },
    { key: "extract", label: "pull structured data out of text", words: ["extract", "parse", "entities", "key value", "structured"] },
    { key: "ocr", label: "read text out of an image or PDF", words: ["ocr", "scan", "screenshot", "read text", "pdf text"] },
  ];
  for (const job of LANGUAGE_JOBS) {
    out.push(
      makeTool(
        `${job.key}_text`,
        "data",
        job.words,
        `${job.label[0].toUpperCase()}${job.label.slice(1)}.`,
        "language_job",
        { job: job.key },
        [job.key],
      ),
    );
  }

  // Audio production. The library had music players and lyric videos, but
  // nothing for the job people most often ask for by name — turning a script or
  // a set of notes into a spoken piece. A podcast is not a music player.
  const AUDIO_JOBS: Array<{ key: string; label: string; words: string[] }> = [
    { key: "podcast", label: "a podcast episode", words: ["podcast", "episode", "show notes", "spoken"] },
    { key: "voiceover", label: "a voiceover", words: ["voiceover", "voice over", "narration", "read aloud"] },
    { key: "audiobook", label: "an audiobook chapter", words: ["audiobook", "chapter", "narrate"] },
    { key: "sound-design", label: "a sound design plan", words: ["sound design", "sfx", "audio cues", "foley"] },
  ];
  for (const job of AUDIO_JOBS) {
    for (const verb of [
      { key: "write", label: "Write", words: ["write", "script"] },
      { key: "produce", label: "Produce", words: ["produce", "make", "generate"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${job.key.replace(/-/g, "_")}`,
          "media",
          [...job.words, verb.words[1]],
          `${verb.label} ${job.label}.`,
          "audio_job",
          { job: job.key, verb: verb.key },
          job.words,
        ),
      );
    }
  }

  // A game with no genre named. Every game tool in the library is a subject ×
  // camera combination, so "make a game" had nothing to match and returned the
  // first alphabetical combination — a card game, whatever the user wanted.
  // These are the honest general entry points: pick a genre, or ask.
  for (const verb of [
    { key: "create", label: "Create", words: ["create", "make", "build", "new"] },
    { key: "brief", label: "Plan", words: ["plan", "brief", "spec", "outline"] },
  ]) {
    out.push(
      makeTool(
        `${verb.key}_a_game`,
        "project",
        ["game", "gameplay", "arcade", "video game"],
        `${verb.label} a game, choosing a genre that suits what the user asked for.`,
        "create_project",
        { medium: "game", kind: "game", choose: "genre" },
        ["game", "gameplay", "arcade"],
      ),
    );
  }

  // Test writing as its own family. "unit test" previously matched a quiz
  // because "test" is the only shared word and the code family is filed under
  // languages the query never named.
  const TEST_KINDS: Array<{ key: string; label: string; words: string[] }> = [
    { key: "unit", label: "unit tests", words: ["unit test", "unit", "jest", "vitest", "pytest"] },
    { key: "integration", label: "integration tests", words: ["integration", "end to end", "e2e"] },
    { key: "snapshot", label: "snapshot tests", words: ["snapshot", "golden", "regression"] },
    { key: "coverage", label: "the coverage report", words: ["coverage", "uncovered", "branch"] },
  ];
  for (const kind of TEST_KINDS) {
    for (const verb of [
      { key: "write", label: "Write", words: ["write"] },
      { key: "run", label: "Run", words: ["run"] },
    ]) {
      out.push(
        makeTool(
          `${verb.key}_${kind.key}_tests`,
          "code",
          [...kind.words, verb.words[0]],
          `${verb.label} ${kind.label}.`,
          "code_task",
          { task: "test", kind: kind.key, verb: verb.key },
          kind.words,
        ),
      );
    }
  }

  // business documents (18 kinds x write / review)
  for (const doc of BUSINESS_DOCS) {
    out.push(
      makeTool(
        `write_${doc.key.replace(/-/g, "_")}`,
        "business",
        [...doc.words],
        `Write ${doc.label}. A good one has: ${doc.sections}.`,
        "write_document",
        { kind: doc.key, sections: doc.sections },
        doc.words,
      ),
    );
    out.push(
      makeTool(
        `review_${doc.key.replace(/-/g, "_")}`,
        "business",
        [...doc.words, "review", "check"],
        `Review ${doc.label} for what is missing, vague or risky. Compare it against: ${doc.sections}.`,
        "write_document",
        { kind: `${doc.key} review`, sections: doc.sections },
        doc.words,
      ),
    );
  }

  // learning (10 topics x plan / practice)
  for (const topic of LEARNING_TOPICS) {
    out.push(
      makeTool(
        `${topic.key === "explainer" ? "explain" : "plan"}_${topic.key.replace(/-/g, "_")}`,
        "learning",
        [...topic.words],
        `Build ${topic.label} for one specific learner: what they already know, what this adds, one worked example, one thing to try alone.`,
        "write_document",
        { kind: topic.key },
        topic.words,
      ),
    );
    out.push(
      makeTool(
        `practise_${topic.key.replace(/-/g, "_")}`,
        "learning",
        [...topic.words, "test", "quiz", "exercise"],
        `Write practice material for ${topic.label}: real questions with answers, graded from easy to hard, each with the reasoning shown.`,
        "write_document",
        { kind: `${topic.key} practice` },
        topic.words,
      ),
    );
  }

  // writing (13 jobs x draft / edit)
  for (const job of WRITING_JOBS) {
    out.push(
      makeTool(
        `draft_${job.key.replace(/-/g, "_")}`,
        "writing",
        [...job.words],
        `Draft ${job.label}. Its shape: ${job.shape}.`,
        "write_document",
        { kind: job.key, shape: job.shape },
        job.words,
      ),
    );
    out.push(
      makeTool(
        `edit_${job.key.replace(/-/g, "_")}`,
        "writing",
        [...job.words, "edit", "tighten", "rewrite"],
        `Edit ${job.label}: cut what does not earn its place, keep the voice, make the first line work. Expect the shape to be ${job.shape}.`,
        "write_document",
        { kind: `${job.key} edit`, shape: job.shape },
        job.words,
      ),
    );
  }

  // everyday (12 jobs x plan / checklist, all of which are documents)
  for (const job of LIFE_JOBS) {
    out.push(
      makeTool(
        `plan_${job.key.replace(/-/g, "_")}`,
        "life",
        [...job.words],
        `Plan ${job.label} for a specific person and situation, with dates, quantities and costs where they apply.`,
        "write_document",
        { kind: job.key },
        job.words,
      ),
    );
    out.push(
      makeTool(
        `checklist_${job.key.replace(/-/g, "_")}`,
        "life",
        [...job.words, "checklist", "list", "steps"],
        `Write a checklist for ${job.label}: ordered, tickable, and complete enough that nothing gets missed.`,
        "write_document",
        { kind: `${job.key} checklist` },
        job.words,
      ),
    );
  }

  return out;
}

export const TOOL_LIBRARY: LibraryTool[] = buildLibrary();

export const LIBRARY_SIZE = TOOL_LIBRARY.length;

export type LibraryMatch = LibraryTool & { score: number };

// "make", "build" and "create" used to sit in this list, which meant they were
// stripped before anything could read them — the intent scorer never saw the
// verb, and the ranking tiebreaker could not prefer a tool named for it. They
// are stop words in prose, but here they are the whole request: "make a react
// app" and "react app" are not the same question. Only genuine filler remains.
const STOP = new Set(
  "a an the and or but if then than that this these those i you we they it is are was were be been being do does did doing have has had having to of in on at for with about from as by into over under again more most some such only own same so too very can will just should now please me my your our more lot really want need help".split(
    /\s+/,
  ),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

/**
 * Rank the library against a request.
 *
 * Deliberately cheap: token overlap, weighted so a keyword match in the
 * request beats a generic verb. Nothing here calls a model, because it runs on
 * every turn.
 */
/**
 * The verbs a request uses, mapped to the action they imply. This is what
 * separates "build me a game" (create) from "check my game" (audit): the noun
 * is identical, and only the verb tells them apart.
 */
const INTENT_VERBS: Array<{ pattern: RegExp; actions: string[]; boost: number }> = [
  { pattern: /\b(game|games|gameplay)\b/i, actions: ["create_project"], boost: 4 },
  { pattern: /\b(make|build|create|start|scaffold|set ?up|new|generate|design|produce|write|draw)\b/i, actions: ["create_project", "produce", "write_document", "design_system", "code_task", "research"], boost: 6 },
  { pattern: /\b(check|audit|review|test|verify|fix|lint|validate|debug)\b/i, actions: ["audit_project", "code_task"], boost: 6 },
  { pattern: /\b(connect|integrate|link|set ?up|authorise|authorize)\b/i, actions: ["integrate"], boost: 6 },
  { pattern: /\b(search|find|research|look ?up|compare|summarise|summarize)\b/i, actions: ["research"], boost: 6 },
  { pattern: /\b(read|parse|analyse|analyze|convert|clean)\b/i, actions: ["data_job"], boost: 5 },
];

function intentActions(query: string): Map<string, number> {
  const wanted = new Map<string, number>();
  for (const rule of INTENT_VERBS) {
    if (!rule.pattern.test(query)) continue;
    for (const action of rule.actions) {
      wanted.set(action, Math.max(wanted.get(action) ?? 0, rule.boost));
    }
  }
  return wanted;
}

export function searchToolLibrary(query: string, limit = 40): LibraryMatch[] {
  const words = tokens(query);
  if (!words.length) return [];
  const wanted = new Set(words);
  const intents = intentActions(query);
  const scored: LibraryMatch[] = [];
  // Collected separately so they can still be offered when nothing meaningful
  // matched — a weak suggestion is better than "no such tool" when the library
  // genuinely has one behind a shared verb.
  const verbOnly: LibraryMatch[] = [];
  for (const tool of TOOL_LIBRARY) {
    let score = 0;
    // Subject overlap: what the thing is about.
    //
    // A multi-word keyword ("business card", "music player") is a phrase, and a
    // phrase that appears in the request is far stronger evidence than the same
    // words scattered: "make a card game" matched generate_business_card
    // because both contain "card", and beat the actual card-game tool.
    const q = ` ${tokens(query).join(" ")} `;
    for (const keyword of tool.keywords) {
      const parts = tokens(keyword);
      if (parts.length > 1 && q.includes(` ${parts.join(" ")} `)) score += 12;
      for (const part of parts) {
        // A keyword the user did not write should not dominate the score.
        if (wanted.has(part)) score += 2;
      }
    }
    // The differentiating word ("stripe", "developer", "accessibility") must
    // beat the family word shared by every sibling, or all five readme
    // variants score identically and the order is alphabetical noise.
    for (const word of tool.specific) {
      for (const part of tokens(word)) {
        // 8 was too weak against a name match plus an intent boost: "svelte"
        // is specific to scaffold_svelte, yet three *_site tools won on the
        // strength of the word "site" alone.
        if (wanted.has(part)) score += 14;
      }
    }
    for (const part of tokens(tool.name)) {
      if (wanted.has(part) && part.length > 3) score += 2;
    }
    // A match on the verb alone is not a match on the tool.
    //
    // Searching "database schema" used to return connect_notion / read_notion /
    // write_notion: every integration shares the words "connect", "read" and
    // "write", Notion's own keywords were absent from the query, and a shared
    // verb was enough to rank. Offering Notion to someone who asked for a
    // database is worse than offering nothing, because it reads as confident.
    // So a tool that overlaps only on words every sibling also has is held back
    // — offered only when nothing with a real subject matched at all.
    if (score > 0 && !sharesSubject(tool, wanted)) {
      verbOnly.push({ ...tool, score });
      continue;
    }
    // Intent: what they want done with it. Capped so a generic verb cannot
    // outweigh a subject: "create" boosts create_project, produce and code_task
    // alike, and without a ceiling "build a svelte site" ranked three unrelated
    // "create_*_site" tools above anything mentioning Svelte.
    const boost = intents.get(tool.action) ?? 0;
    if (boost && score > 0) score += Math.min(boost, 3);
    if (score > 0) {
      // Searching "podcast" scored nothing above zero and fell through to a
      // verb match, answering with accessibility checkers. A library that
      // cannot answer should say so; "no match" makes find_tools tell the model
      // to build it instead, which is the truth.
      scored.push({ ...tool, score });
    }
  }
  // Ties were broken alphabetically, so asking to *create* a database schema
  // ranked debug_supabase above scaffold_supabase — all four supabase tools
  // share the subject words and scored identically, and "debug" sorts first.
  // The verb the user chose is the tiebreaker: prefer the tool whose own name
  // opens with the action they asked for.
  const wantedVerbs = tokens(query).filter((w) => LEADING_VERBS.has(w));
  // Stacks and integrations come in four fixed verbs; two of them are spelled
  // differently in the tool name than in a request ("create" → scaffold,
  // "create" → integrate). Without this map, "create a database schema" still
  // ranked debug_supabase first because no tool is called create_supabase.
  const SYNONYM: Record<string, string[]> = {
    create: ["scaffold", "generate", "write", "produce", "integrate"],
    start: ["scaffold", "produce"],
    make: ["scaffold", "generate", "write", "produce"],
    build: ["scaffold", "create", "produce", "generate"],
    set: ["scaffold", "integrate"],
    fix: ["debug", "optimise"],
    improve: ["optimise"],
    translate: ["translate"],
    summarise: ["summarise"],
  };
  // Ranked rather than a set: when a request says "create", the tool that
  // starts something (scaffold) is a better answer than one that connects an
  // existing service (integrate), even though both are legal readings of the
  // word. The index in the expanded list is the rank.
  const headRank = new Map<string, number>();
  for (const v of wantedVerbs) {
    [v, ...(SYNONYM[v] ?? [])].forEach((h, i) => {
      const prior = headRank.get(h);
      if (prior === undefined || i < prior) headRank.set(h, i);
    });
  }
  const verbRank = (tool: LibraryTool) => {
    const head = tokens(tool.name)[0] ?? "";
    return headRank.get(head) ?? 99;
  };
  // The verb decides only among tools that are already plausible.
  //
  // Applied to the whole list, it was actively harmful: "build a music player"
  // put every build_game_* tool above create_music_player, because they open
  // with the requested word "build" while the right answer opens with "create"
  // — a perfect verb on the wrong subject beat a synonym on the right one, 7
  // points to 36. So tools are bucketed by whether they *share the subject* of
  // the strongest match, and the verb only orders inside a bucket.
  // The threshold has to be the *best* score, not the first one collected.
  // `scored` is in library order until the sort at the end, and the project
  // tools are built first — so `scored[0]` was whatever project tool happened
  // to match at all, and a 21-point `write_faq` became the bar that the
  // 49-point `draft_landing_copy` had to clear. It cleared it, but the verb
  // tiebreak then ran across both anyway and put the wiki page first.
  const top = scored.reduce((best, t) => Math.max(best, t.score), 0);
  const strong = (t: LibraryMatch) => (t.score >= top * 0.6 ? 0 : 1);
  // A general tool (create_a_game) exists precisely for requests that name no
  // genre — so it must be *demoted* the moment a genre is named, not merely
  // out-scored. It ties with the genre combos (both match "game", both get the
  // create boost) and then won on the verb tiebreak, answering "make a card
  // game" with a tool that does not know it is a card game.
  const generic = (t: LibraryMatch) => (/^(create|brief)_a_/.test(t.name) ? 1 : 0);
  // Only the general tool wins when the query is a bare subject with no genre,
  // camera or subject word attached — otherwise "make a card game" would be
  // answered by the same generic tool it does not need.
  const bareSubject = ![...GENRE_WORDS].some((w) => wanted.has(w));
  scored.sort(
    (a, b) =>
      strong(a) - strong(b) ||
      // Both ways round: a bare "game" belongs to the general tool, and a named
      // genre ("card game") belongs to the genre tool. The general tool is
      // never the right answer once a genre is named.
      (bareSubject ? generic(b) - generic(a) : generic(a) - generic(b)) ||
      verbRank(a) - verbRank(b) ||
      b.score - a.score ||
      a.name.localeCompare(b.name),
  );
  if (scored.length) return scored.slice(0, limit);
  verbOnly.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return verbOnly.slice(0, limit);
}

/**
 * Does this tool overlap the query on anything more than a shared verb?
 *
 * "Subject" here means: a word from the tool's own keywords that is not a
 * generic action, or one of its `specific` words, or a word of its name. Those
 * are what distinguish write_readme_for_developer from read_gmail; "write" does
 * not. The vocabulary below is deliberately the same one the intent scorer
 * boosts, so a word cannot count as an intent in one place and a subject in the
 * other.
 */
const GENERIC_VERBS = new Set([
  "write", "read", "create", "make", "draw", "plan", "generate", "brief", "check",
  "search", "find", "summarise", "summarize", "compare", "define", "audit", "apply",
  "document", "transform", "report", "analyse", "analyze", "connect", "send",
  "fetch", "list", "build", "add", "review", "scaffold", "integrate", "debug",
  "optimise", "optimize", "fix", "explain", "test", "set", "pick", "use", "record",
  "choose", "adopt", "get", "link", "post", "publish", "load", "open", "convert",
  "clean", "count", "inspect", "visit", "call", "close", "rename", "delete",
]);

/** Words that name a kind of game, so the generic game tool must stand down. */
const GENRE_WORDS = new Set([
  "card", "puzzle", "platformer", "shooter", "idle", "runner", "rpg", "racing",
  "strategy", "tactics", "horror", "sim", "simulation", "sports", "trivia",
  "card", "deck", "fighter", "pong", "snake", "memory", "word",
]);

/** Action words that may legitimately open a tool name, for tiebreaking. */
const LEADING_VERBS = new Set([
  "write", "read", "create", "make", "build", "scaffold", "generate", "draw",
  "plan", "brief", "check", "audit", "review", "run", "add", "connect",
  "integrate", "debug", "optimise", "fix", "explain", "test", "search",
  "summarise", "compare", "define", "apply", "document", "transform", "report",
  "analyse", "transcribe", "translate", "proofread", "extract", "ocr", "produce",
]);

function sharesSubject(tool: LibraryTool, wanted: Set<string>): boolean {
  const subjectHit = (words: string[]) =>
    words.some((w) => tokens(w).some((part) => wanted.has(part) && !GENERIC_VERBS.has(part)));
  if (subjectHit(tool.keywords)) return true;
  if (subjectHit(tool.specific)) return true;
  // A distinctive part of the name counts, but only a long one: short fragments
  // like "for" or "the" from `write_readme_for_developer` mean nothing.
  return tokens(tool.name).some((part) => wanted.has(part) && part.length > 3 && !GENERIC_VERBS.has(part));
}

/** The meta-tools that make the library reachable without loading all of it. */
export const LIBRARY_META_TOOLS: Tool[] = [
  {
    name: "find_tools",
    description:
      "Search a library of about a thousand specific tools by describing what you want to do. Use this before writing something from scratch: it will tell you whether there is a purpose-built step for it already. Returns the best matches with the name to call.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you are trying to do, in a few words." },
        limit: { type: "number", description: "How many results, 1-25. Defaults to 10." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "run_tool",
    description:
      "Execute one tool from the library by the exact name find_tools gave you. The tool produces a real artifact. Always search first — you cannot call a library tool that you have not found.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact tool name from find_tools." },
        title: { type: "string", description: "Name for what is being produced." },
        detail: { type: "string", description: "Specifics: subject, audience, constraints." },
      },
      required: ["name", "title"],
      additionalProperties: false,
    },
  },
];

/**
 * The best score any tool can reach without a real subject overlap.
 *
 * `sharesSubject` already keeps verb-only matches out of the main list, so a
 * score at or below this ceiling means the match is a keyword coincidence
 * rather than a tool that does the job. `find_tools` uses it to warn the model
 * instead of letting it run something plausible and wrong.
 */
export const WEAK_MATCH_SCORE = 5;

export function libraryToolByName(name: string): LibraryTool | undefined {
  return TOOL_LIBRARY.find((tool) => tool.name === name);
}
