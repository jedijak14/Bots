import "server-only";
import { isUuid } from "./ids";
import { splitRecipients } from "./email";
import type { Sandbox } from "@e2b/desktop";
import path from "node:path";
import type { Tool, ToolResult } from "@/lib/ai/llm";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, privacySessions, type ChoicesRecord, type StepRecord } from "@/db/schema";
import { getConnectionToken } from "@/lib/connectors";
import { TOOL_CONNECTOR } from "@/lib/skill-permissions";
import { ensureDesktop, normalizeUrl, openInBrowser, shot, sleep, type BotRef } from "@/lib/sandbox";
import { runLibraryTool, runPackTool } from "@/lib/pack-tools";
import {
  addAudioPart,
  addAudioTrack,
  addVideoClip,
  duplicateVideoClip,
  editAudioTrack,
  editVideoClip,
  moveAudioPart,
  openAudioStudio,
  openVideoStudio,
  readAudioProject,
  readVideoProject,
  removeAudioPart,
  repeatAudioPart,
  removeVideoClip,
  splitVideoClip,
  tightenVideoTrack,
  narrateVideo,
} from "@/lib/studios";
import { LIBRARY_META_TOOLS, libraryToolByName, searchToolLibrary, WEAK_MATCH_SCORE } from "@/lib/tool-library";
import { helperSummary, helpersFor, spawnHelper, waitForHelpers, type Helper } from "@/lib/helpers";

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const ASK: Tool = {
  name: "ask_user",
  description:
    "Ask the user a multiple-choice question with 2-5 short options. After calling this, stop and wait for their reply.",
  parameters: obj(
    {
      question: { type: "string", description: "The question to show." },
      options: { type: "array", items: { type: "string" }, description: "2-5 short answer options." },
    },
    ["question", "options"],
  ),
};

const CORE_TOOLS: Tool[] = [
  {
    name: "goals",
    description:
      "Read and change the shared goal list every Bot can see. Actions: list (default), add, update, complete, remove. Use it when the user sets an intention ('I want to launch by June'), when you finish something on it, or when they ask what is left. Give status as open, doing or done.",
    parameters: obj(
      {
        action: { type: "string", enum: ["list", "add", "update", "complete", "remove"], description: "What to do. Defaults to list." },
        id: { type: "string", description: "Goal id, for update/complete/remove." },
        title: { type: "string", description: "Short goal title, for add/update." },
        detail: { type: "string", description: "Optional detail or acceptance criteria." },
        status: { type: "string", enum: ["open", "doing", "done"], description: "New status, for update." },
        due: { type: "string", description: "Optional ISO date the goal is due." },
      },
      [],
    ),
  },
  {
    name: "make_lyric_video",
    description:
      "Build an interactive lyric-video player from uploaded audio and lyrics. This does not render or export an MP4. Use the artifact ids from their upload message. Prefer lyricsId over retyping the file.",
    parameters: obj(
      {
        title: { type: "string", description: "Song title." },
        artist: { type: "string", description: "Artist, if known." },
        audioId: { type: "string", description: "Artifact id of the uploaded song." },
        artId: { type: "string", description: "Artifact id of the uploaded cover art, if any." },
        lyricsId: { type: "string", description: "Artifact id of the uploaded lyrics file (preferred)." },
        lyrics: { type: "string", description: "Only when there is no lyrics artifact: the lyrics text, verbatim." },
        lyricFormat: { type: "string", enum: ["lrc", "srt", "ttml", "qrc", "plain"], description: "Format of the lyrics text, if known." },
        preset: { type: "string", enum: ["aurora", "ember", "mint", "mono"], description: "Colour look. Defaults to aurora." },
        accent: { type: "string", description: "Optional CSS colour for the sung line." },
      },
      ["title", "audioId"],
    ),
  },
  {
    name: "save_artifact",
    description: "Save substantial work (story, document, website source) to Artifacts. It appears as a chat card immediately.",
    parameters: obj({ title: { type: "string" }, kind: { type: "string", enum: ["story", "document", "html", "website"] }, content: { type: "string" } }, ["title", "kind", "content"]),
  },
  {
    name: "draft_email",
    description: "Draft an email. It appears as an editable card with a Send button and is never sent without the user pressing it.",
    parameters: obj(
      {
        to: { type: "string", description: "Recipient address, or several separated by commas. Display names are fine: Ada <ada@example.com>." },
        subject: { type: "string", description: "One line, no line breaks." },
        body: { type: "string", description: "Plain text body." },
      },
      ["to", "subject", "body"],
    ),
  },
  {
    name: "search_gmail",
    description: "Search the user's Gmail. Returns subjects, senders, dates and short snippets only.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "search_youtube",
    description: "Search YouTube videos using the user's connected Google account. Returns video titles and links only.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "search_notion",
    description: "Search the user's connected Notion workspace. Returns page titles and links only.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "list_saved_spotify_tracks",
    description: "List the user's 10 most recently saved Spotify tracks.",
    parameters: obj({}, []),
  },
  {
    name: "list_github_repositories",
    description: "List the user's recently updated GitHub repositories.",
    parameters: obj({}, []),
  },
  {
    name: "list_vercel_projects",
    description: "List the user's Vercel projects.",
    parameters: obj({}, []),
  },
  {
    name: "get_current_time",
    description: "Current date and time in an IANA timezone (e.g. America/New_York).",
    parameters: obj({ timezone: { type: "string" } }, ["timezone"]),
  },
];

/**
 * A workspace that exists without a computer.
 *
 * `write_file` and `read_file` need a desktop, so an account with no E2B key
 * could not keep a scratch file between two calls — every multi-step job that
 * needs a note, a draft, or a slice of a long document had to hold it in the
 * conversation. These store the same thing as artifacts, which every account
 * already has, and are found back by path. They are deliberately named
 * differently from the desktop tools so a model cannot confuse a path on a
 * machine with a path in the workspace.
 */
const WORKSPACE_TOOLS: Tool[] = [
  {
    name: "workspace_write",
    description:
      "Save a named file in this Bot's workspace, so it survives between steps and turns. Use it for notes, drafts, or a slice of data you will need again. Works with no computer. Overwrites a file of the same path.",
    parameters: obj(
      {
        path: { type: "string", description: "Name for the file, e.g. notes.md or data/rows.json" },
        content: { type: "string", description: "Exact contents to store." },
      },
      ["path", "content"],
    ),
  },
  {
    name: "workspace_read",
    description:
      "Read back a file saved with workspace_write, by path. Also lists the workspace when called with no path. A file too long for one reply comes back a slice at a time: the reply says which slice, how many there are, and the offsets to ask for the next one.",
    parameters: obj(
      {
        path: { type: "string", description: "Path to read. Leave empty to list what is stored." },
        offset: { type: "number", description: "Character offset to start from, for a long file. Leave empty for the start." },
      },
      [],
    ),
  },
];

/** How much of a long file one workspace_read returns. */
const PART_CHARS = 20_000;

/**
 * Arithmetic the model cannot do in its head.
 *
 * A small model gets long division, percentages and date maths wrong often
 * enough to matter, and without a computer there was nothing to check it
 * against — `run_command` needs a desktop. This evaluates a single expression
 * with no names, no calls and no state, so it cannot reach anything: the input
 * is checked against an allowlist of characters and the parser only ever sees
 * numbers and operators.
 */
const CALC_TOOL: Tool = {
  name: "calculate",
  description:
    "Do exact arithmetic. Use it for any sum you would otherwise estimate: percentages, division, unit conversion, compound growth. Accepts numbers, + - * / % ** and parentheses, plus sqrt, abs, round, floor, ceil, min, max and pi. Works with no computer.",
  parameters: obj({ expression: { type: "string", description: "e.g. (1250 * 0.08) / 3 or sqrt(2) * 100" } }, ["expression"]),
};

/**
 * Exact work, as tools.
 *
 * These are the questions a language model answers with a plausible guess:
 * how many miles that is, what date 45 days from now lands on, how many words
 * are in a draft, what a spreadsheet's column adds up to. Each one is a real
 * calculation with no model in the loop, so the answer is the answer.
 */
const EXACT_TOOLS: Tool[] = [
  {
    name: "describe_numbers",
    description: "Calculate descriptive statistics for a list: mean, median, quartiles, range, sum, population and sample standard deviation. Quartiles use linear interpolation. No computer or paid calls required.",
    parameters: obj({ values: { type: "array", items: { type: "number" }, description: "1–10000 finite numbers." } }, ["values"]),
  },
  {
    name: "convert_time_zones",
    description: "Convert an unambiguous instant to multiple IANA time zones using daylight saving rules. Input must include Z or an explicit UTC offset; do not guess an ambiguous local time.",
    parameters: obj({ instant: { type: "string", description: "ISO timestamp with Z or offset, e.g. 2026-11-24T12:00:00Z." }, zones: { type: "array", items: { type: "string" }, description: "IANA zone names such as America/Los_Angeles." } }, ["instant", "zones"]),
  },
  {
    name: "estimate_loan",
    description: "Estimate fixed-rate loan payments, total payments and interest. Excludes fees, taxes and insurance; not a lender quote.",
    parameters: obj({ principal: { type: "number", description: "Loan principal." }, annualRate: { type: "number", description: "Annual interest rate as a percentage, e.g. 6.5." }, months: { type: "number", description: "Number of monthly payments." } }, ["principal", "annualRate", "months"]),
  },
  {
    name: "compare_texts",
    description: "Compare two versions of text line by line, identifying added, removed and unchanged lines using a longest common subsequence. Use for reviewing edits.",
    parameters: obj({ before: { type: "string", description: "Original text." }, after: { type: "string", description: "Revised text." } }, ["before", "after"]),
  },
  {
    name: "convert_units",
    description:
      "Convert between units exactly. Length, mass, volume, area, speed, data and time all convert, and temperature converts between c, f and k. Use it instead of estimating: 12 km is 7.456454 miles, not 'about 7.5'. Works with no computer.",
    parameters: obj(
      {
        amount: { type: "number", description: "How much, e.g. 12." },
        from: { type: "string", description: "Unit to convert from, e.g. km, lb, GiB, c, mph." },
        to: { type: "string", description: "Unit to convert to, e.g. mi, kg, MB, f, km/h." },
      },
      ["amount", "from", "to"],
    ),
  },
  {
    name: "date_math",
    description:
      "Work out dates exactly: which weekday a date is, the span between two dates in days, weeks and business days, and what date N days, months or years later is. Month and year arithmetic clamps to the end of the month. Business-day offsets skip weekends, not holidays. Works with no computer.",
    parameters: obj(
      {
        date: { type: "string", description: "The starting date as YYYY-MM-DD." },
        compare: { type: "string", description: "Optional second date, YYYY-MM-DD, to measure from the first." },
        addDays: { type: "number", description: "Days to add; negative goes backwards." },
        addMonths: { type: "number", description: "Months to add." },
        addYears: { type: "number", description: "Years to add." },
        addBusinessDays: { type: "number", description: "Weekdays to add, excluding weekends but not holidays; negative goes backwards." },
      },
      ["date"],
    ),
  },
  {
    name: "analyze_text",
    description:
      "Measure a piece of writing: characters, words, sentences, paragraphs, reading time, the most-used words, and every email address, URL and number in it. Use it for word counts and when someone asks whether something fits a limit. Works with no computer.",
    parameters: obj({ text: { type: "string", description: "The text to measure." } }, ["text"]),
  },
  {
    name: "summarize_table",
    description:
      "Read a CSV table and report what is in it: the columns, how many rows, the min, max, sum and mean of every numeric column, how many cells are empty, and whether any rows are duplicates. Use it on exported data instead of reading the CSV by eye. Works with no computer.",
    parameters: obj(
      {
        csv: { type: "string", description: "The CSV, with a header row." },
        delimiter: { type: "string", description: "Column separator if it is not a comma, e.g. ; or \t." },
      },
      ["csv"],
    ),
  },
  {
    name: "json_query",
    description:
      "Read one value out of a JSON document by path, e.g. user.tags[1], or list the top-level keys so you can see what is there. Use it on API responses too long to read whole. Works with no computer.",
    parameters: obj(
      {
        json: { type: "string", description: "The JSON text." },
        path: { type: "string", description: "Dot path with optional [index], e.g. data.items[0].name. Leave empty with list true." },
        list: { type: "boolean", description: "True to list the top-level keys instead of reading a path." },
      },
      ["json"],
    ),
  },
  {
    name: "transform_text",
    description:
      "Change text in one exact way: slug, kebab, snake, camel, title, upper, lower, sentence, trim, dedupe-lines, sort-lines, reverse-lines, remove-blank-lines, number-lines, trim-lines, base64, unbase64, urlencode or urldecode. Use it instead of hand-editing strings, which is where quoting and case mistakes come from. Works with no computer.",
    parameters: obj(
      {
        text: { type: "string", description: "The text to transform." },
        op: {
          type: "string",
          enum: ["slug", "kebab", "snake", "camel", "title", "upper", "lower", "sentence", "trim", "dedupe-lines", "sort-lines", "reverse-lines", "remove-blank-lines", "number-lines", "trim-lines", "base64", "unbase64", "urlencode", "urldecode"],
          description: "Which transformation.",
        },
      },
      ["text", "op"],
    ),
  },
];

/** Colour and money: exact answers a design or a till needs. */
const DESIGN_TOOLS: Tool[] = [
  {
    name: "check_contrast",
    description:
      "Measure the WCAG contrast between two colours and say whether the text passes. Returns the ratio and the AA, AA-large and AAA verdicts. Use it whenever you pick a text and background colour — mid grey on white is 4.48:1, which fails AA body text, and a guess will not tell you that. Works with no computer.",
    parameters: obj(
      {
        foreground: { type: "string", description: "Text colour: #rrggbb, rgb(...) or a name like white." },
        background: { type: "string", description: "Background colour." },
      },
      ["foreground", "background"],
    ),
  },
  {
    name: "color_palette",
    description:
      "Derive a usable palette from one colour: the base, a lighter and darker version, a near-white tint, a deep shade, and the complement. Use it to build a design system from a brand colour instead of inventing hex values that do not sit together. Works with no computer.",
    parameters: obj({ color: { type: "string", description: "The seed colour, e.g. #ff6600." } }, ["color"]),
  },
  {
    name: "money_math",
    description:
      "Exact money arithmetic. kind sum adds a list without floating-point drift, kind tax applies a percentage and rounds to cents, kind split divides an amount into equal parts with the remainder on the first ones. Use it for invoices, splits and totals: 0.1 + 0.2 is 0.30000000000000004 in a language model's head. Works with no computer.",
    parameters: obj(
      {
        kind: { type: "string", enum: ["sum", "tax", "split"], description: "Which calculation." },
        amounts: { type: "array", items: { type: "number" }, description: "For sum: the amounts." },
        amount: { type: "number", description: "For tax and split: the single amount." },
        rate: { type: "number", description: "For tax: the percentage, e.g. 8.25." },
        parts: { type: "number", description: "For split: how many ways." },
      },
      ["kind"],
    ),
  },
  {
    name: "spell_number",
    description:
      "Write a number in words, correctly, up to billions. Use it for cheques, legal amounts and anywhere a number has to appear as text. Works with no computer.",
    parameters: obj({ value: { type: "number", description: "The number." } }, ["value"]),
  },
];

/**
 * The studios, as tools.
 *
 * Both are pure data: the Bot edits a timeline and the browser draws or plays
 * it. Nothing is rendered on the server, so both work with no computer, and a
 * Bot can build a film or a track while a person watches the project fill up.
 */
const STUDIO_TOOLS: Tool[] = [
  {
    name: "video_studio",
    description:
      "Open or create a video project and see its timeline. Returns the clip ids on each track. Use video_add / video_edit / video_remove to build the film. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string", description: "Project title. Opening an existing one uses the same title." },
        preset: { type: "string", enum: ["landscape", "portrait", "square", "wide"], description: "Frame size when creating a new project." },
        brief: { type: "string", description: "One line on what the video is for." },
      },
      ["title"],
    ),
  },
  {
    name: "video_add",
    description:
      "Add a clip to a video project. kind text adds a title or caption; image and video take an artifact id or https URL; audio takes an artifact id. Without start, the clip lands in the next free slot on its track so it never covers existing footage.",
    parameters: obj(
      {
        title: { type: "string", description: "Project title." },
        kind: { type: "string", enum: ["text", "image", "video", "audio"], description: "What the clip is." },
        source: { type: "string", description: "Artifact id or URL, for image/video/audio. Leave empty for text." },
        text: { type: "string", description: "The words, for a text clip." },
        style: { type: "string", enum: ["title", "subtitle", "caption"], description: "Text size, for a text clip." },
        start: { type: "number", description: "Seconds from the beginning. Defaults to the next free slot." },
        duration: { type: "number", description: "How long it shows, in seconds." },
        speed: { type: "number", description: "Playback rate, e.g. 0.5 for slow motion." },
        opacity: { type: "number", description: "0-1, for overlays." },
        fadeIn: { type: "number", description: "Fade-in seconds." },
        fadeOut: { type: "number", description: "Fade-out seconds." },
        speak: { type: "string", description: "For an audio clip the studio should voice: the line to say." },
        grade: {
          type: "object",
          description:
            "Colour grading. brightness, contrast and saturate default to 1 (unchanged); hue is degrees; blur is px; sepia and gray are 0-1. e.g. {saturate: 1.3, contrast: 1.1} for punch, {gray: 1} for black and white, {brightness: 1.2, hue: -10} for warm.",
        },
        transition: {
          type: "string",
          enum: ["fade", "wipe", "flash", "slide", "iris"],
          description: "How the clip enters: fade from black, wipe from the left, a white flash on the cut, slide in, or iris.",
        },
        label: { type: "string", description: "A short name shown on the clip." },
      },
      ["title", "kind"],
    ),
  },
  {
    name: "video_edit",
    description:
      "Change one clip in a video project. Only the fields you pass change, so a missing field never resets a value. Can also move the clip to another track and clear a grade or transition by passing an empty object.",
    parameters: obj(
      {
        title: { type: "string" },
        id: { type: "string", description: "Clip id from video_studio or video_read." },
        start: { type: "number" },
        duration: { type: "number" },
        text: { type: "string", description: "New words, for a text clip." },
        style: { type: "string", enum: ["title", "subtitle", "caption"], description: "New text size." },
        opacity: { type: "number" },
        speed: { type: "number" },
        in: { type: "number", description: "Seconds into the source where the clip starts." },
        fadeIn: { type: "number" },
        fadeOut: { type: "number" },
        track: { type: "string", description: "Move the clip to this track: v1, o1, t1 or a1." },
        grade: { type: "object", description: "Colour grading, e.g. {saturate: 1.3}. An empty object clears it." },
        transition: { type: "string", enum: ["fade", "wipe", "flash", "slide", "iris"], description: "Entry effect. An empty string clears it." },
      },
      ["title", "id"],
    ),
  },
  {
    name: "video_remove",
    description: "Remove one clip from a video project, by id.",
    parameters: obj({ title: { type: "string" }, id: { type: "string" } }, ["title", "id"]),
  },
  {
    name: "video_narrate",
    description:
      "Write narration into a film. Give the lines and the studio places them back to back on the audio track, timing each to how long it takes to say (about 150 words a minute), and the player speaks them. Use it instead of adding one audio clip per sentence by hand. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        script: { type: "string", description: "The narration. Each line or sentence becomes one clip." },
        lines: { type: "array", items: { type: "string" }, description: "Alternative to script: the lines already split." },
        start: { type: "number", description: "Seconds in. Defaults to the end of the audio track." },
        voice: { type: "string", enum: ["normal", "slow", "fast"], description: "Speaking rate used to time the lines. Defaults to normal." },
      },
      ["title"],
    ),
  },
  {
    name: "video_split",
    description:
      "Cut a clip in two at a time on the timeline. Both halves keep playing continuously — the second one's source in-point moves forward. Use it to cut away mid-shot, put a title over the middle of a clip, or trim one section. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        id: { type: "string", description: "The clip to split." },
        at: { type: "number", description: "Timeline seconds where the cut happens." },
      },
      ["title", "id", "at"],
    ),
  },
  {
    name: "video_duplicate",
    description:
      "Copy a clip. Without a start time the copy lands in the next free slot on the same track, so it never covers the original. Use it to repeat a shot or a title. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        id: { type: "string" },
        start: { type: "number", description: "Where the copy goes, in seconds." },
      },
      ["title", "id"],
    ),
  },
  {
    name: "video_tighten",
    description:
      "Close every gap on the visual, overlay and text tracks so clips play back to back. Audio is left alone, because a music bed usually starts before the picture. Pass a track id to tighten only that track. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        track: { type: "string", description: "v1, o1 or t1. Omit for all non-audio tracks." },
      },
      ["title"],
    ),
  },
  {
    name: "video_read",
    description:
      "Read a video project back as text: every track, every clip id, its times, fades, grading, transitions and speed. Call this before editing a project you did not just build, so you have the ids. Works with no computer.",
    parameters: obj({ title: { type: "string" } }, ["title"]),
  },
  {
    name: "audio_studio",
    description:
      "Open or create an audio project and see its tracks. Returns what is on each. Use audio_add to build parts. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string", description: "Project title. Opening an existing one uses the same title." },
        preset: { type: "string", enum: ["beat", "pop", "cinematic", "chiptune", "ambient", "house", "trap", "lofi", "rock", "waltz", "bossa", "synthwave", "podcast"], description: "Tempo and feel, when creating." },
        brief: { type: "string", description: "One line on what it is for." },
      },
      ["title"],
    ),
  },
  {
    name: "audio_add",
    description:
      "Add a part to an audio project. A composed part is notes as “C4:0:1 E4:1:1 G4:2:2” (pitch:beat:length) or a noteList. kind drums writes a beat in a given style and number of bars. kind sample places an audio artifact. The kit is addressed by pitch: C2 kick, D2 snare, F#2 closed hat, A#2 open hat, C#2 clap, D3 tom, F2 rim, A3 crash, G2 shaker, C3 cowbell.",
    parameters: obj(
      {
        title: { type: "string", description: "Project title." },
        track: { type: "string", description: "lead, bass, drums or pad." },
        kind: { type: "string", enum: ["notes", "drums", "sample"], description: "What to add." },
        notes: { type: "string", description: "For kind notes: “C4:0:1 E4:1:1 G4:2:2”." },
        noteList: { type: "array", description: "Alternative to notes: [{pitch, at, beats}].", items: obj({ pitch: { type: "string" }, at: { type: "number" }, beats: { type: "number" } }, ["pitch", "at", "beats"]) },
        bars: { type: "number", description: "For kind drums: how many bars." },
        style: {
          type: "string",
          enum: ["pop", "rock", "house", "trap", "halftime", "breaks", "lofi", "bossa", "waltz"],
          description: "For kind drums: the idiom. house is four-on-the-floor with off-beat hats, trap rolls triplets, breaks is a 16th-note breakbeat, lofi is behind the beat, bossa is brushed with no backbeat, waltz is 3/4.",
        },
        wave: { type: "string", enum: ["sine", "square", "sawtooth", "triangle"], description: "Tone. sine is soft, square is chiptune, sawtooth is strings, triangle is a bell." },
        source: { type: "string", description: "For kind sample: the audio artifact id." },
        start: { type: "number", description: "Seconds from the start. Defaults to after what is already on the track." },
        gain: { type: "number", description: "0-1 loudness." },
        label: { type: "string" },
      },
      ["title"],
    ),
  },
  {
    name: "audio_mix",
    description:
      "Change an audio project: tempo, a track's level, pan, mute or name, and the sound of a composed part — its wave, brightness, envelope, detune, echo and vibrato. Give a clip id to change one part, or just a track to change everything on it. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        bpm: { type: "number", description: "New tempo. Composed parts re-time to it." },
        track: { type: "string", description: "Which track to change, e.g. lead." },
        name: { type: "string", description: "Rename the track." },
        muted: { type: "boolean" },
        gain: { type: "number", description: "0-1." },
        pan: { type: "number", description: "0-1, 0.5 is centre." },
        clip: { type: "string", description: "One part's id, to change only that part. Omit to change every part on the track." },
        wave: { type: "string", enum: ["sine", "square", "sawtooth", "triangle"], description: "Tone of a composed part." },
        cutoff: { type: "number", description: "Lowpass cutoff in Hz. 800 is muffled and warm, 8000 is bright." },
        attack: { type: "number", description: "Seconds to reach full volume. 0.4 is a pad; 0.005 is a pluck." },
        release: { type: "number", description: "Seconds to fade after the note." },
        detune: { type: "number", description: "Cents between two voices, 6-20 for width. 0 is one voice." },
        echo: { type: "object", description: "A delayed copy: {time: 0.33, feedback: 0.3, mix: 0.25}. mix 0 removes it." },
        vibrato: { type: "object", description: "Pitch wobble: {rate: 5, depth: 12} in Hz and cents. depth 0 removes it." },
      },
      ["title"],
    ),
  },
  {
    name: "audio_track",
    description:
      "Add a new track to an audio project, for a part the four standard tracks do not cover — a counter-melody, a vocal line, a second drum bus. Returns the new track id for audio_add. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        name: { type: "string", description: "The track's name, e.g. 'Counter-melody'. Its id is derived from this." },
        gain: { type: "number", description: "0-1, defaults to 0.18." },
        pan: { type: "number", description: "0-1, 0.5 is centre." },
        muted: { type: "boolean", description: "Start muted." },
      },
      ["title", "name"],
    ),
  },
  {
    name: "audio_repeat",
    description:
      "Repeat a part along its track. A song is a loop: asking for sixteen bars means writing one bar and repeating it, not sixteen bars of notes. The count includes the original, so times 4 gives four playthroughs. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        id: { type: "string", description: "The part to repeat." },
        track: { type: "string", description: "Which track it is on." },
        times: { type: "number", description: "Total playthroughs including the original. Defaults to 4." },
      },
      ["title", "id"],
    ),
  },
  {
    name: "audio_remove",
    description:
      "Remove a part by id, or a whole track when no id is given. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        id: { type: "string", description: "The part to remove. Omit to remove the whole track." },
        track: { type: "string", description: "Which track the part is on, or the track to remove." },
      },
      ["title"],
    ),
  },
  {
    name: "audio_move",
    description:
      "Move a part to a new time on its track, or onto a different track. Use it to shift a section earlier, line a bass note up with a drum hit, or move a part to a track with a different level. Works with no computer.",
    parameters: obj(
      {
        title: { type: "string" },
        id: { type: "string", description: "The part to move." },
        track: { type: "string", description: "Where it is now." },
        to: { type: "string", description: "The track to move it to." },
        start: { type: "number", description: "Its new start, in seconds." },
      },
      ["title", "id"],
    ),
  },
  {
    name: "audio_read",
    description: "Read an audio project back: tempo, length, and what is on each track.",
    parameters: obj({ title: { type: "string" } }, ["title"]),
  },
];

/**
 * Check written code and data before it is presented as finished.
 *
 * A small model's JSON is wrong about as often as it is right — a trailing
 * comma, a single quote, a key it forgot to close — and it has no way to find
 * out, because it cannot run anything. The same goes for a regex it never
 * compiles and an HTML page with an unclosed tag. Nothing here executes what it
 * is given: JSON is parsed with JSON.parse, a regex is compiled, and HTML is
 * counted tag by tag.
 */
const CHECK_TOOL: Tool = {
  name: "check_code",
  description:
    "Check something you wrote before you hand it over. Use it on JSON you generated (kind json), a regular expression (kind regex), HTML (kind html), or a JavaScript expression (kind js). Returns either 'It parses' or the exact line and problem. Nothing is executed. Works with no computer.",
  parameters: obj(
    {
      kind: { type: "string", enum: ["json", "regex", "html", "js"], description: "What kind of text this is." },
      text: { type: "string", description: "The exact text to check." },
    },
    ["kind", "text"],
  ),
};

/** The line and column of an offset, so a model can fix the right place. */
function where(text: string, index: number): string {
  const before = text.slice(0, Math.max(0, index));
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  return `line ${line}, column ${column}`;
}

/** Count HTML tags, ignoring void elements and anything inside a comment. */
function htmlProblem(html: string): string | null {
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "!doctype"]);
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const stack: { tag: string; at: number }[] = [];
  const re = /<(\/?)([a-zA-Z!][\w:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const [, closing, rawName, rest, selfClose] = m;
    const tag = rawName.toLowerCase();
    if (tag === "!doctype" || VOID.has(tag) || selfClose || /\/$/.test(rest ?? "")) continue;
    if (!closing) {
      stack.push({ tag, at: m.index });
    } else {
      const open = stack.pop();
      if (!open) return `</${tag}> closes a tag that was never opened (${where(html, m.index)}).`;
      if (open.tag !== tag) return `</${tag}> closes <${open.tag}> that opened at ${where(html, open.at)} (${where(html, m.index)}).`;
    }
  }
  if (stack.length) {
    const last = stack[stack.length - 1];
    return `<${last.tag}> opened at ${where(html, last.at)} is never closed.`;
  }
  return null;
}

function checkCode(kind: string, text: string): string {
  const body = text.trim();
  if (!body) return "There is nothing to check: the text was empty.";
  if (kind === "json") {
    try {
      const value = JSON.parse(body) as unknown;
      const shape = Array.isArray(value) ? `an array of ${value.length}` : value && typeof value === "object" ? `an object with ${Object.keys(value as object).length} key${Object.keys(value as object).length === 1 ? "" : "s"}` : `a ${typeof value}`;
      return `It parses: ${shape}.`;
    } catch (e) {
      const message = e instanceof Error ? e.message : "invalid JSON";
      // V8 reports "at position N"; turning that into a line and column is the
      // difference between a hint and something a model can act on.
      const pos = /position (\d+)/.exec(message);
      const at = pos ? ` (${where(body, Number(pos[1]))})` : "";
      const nearby = pos ? `\nNear: ${body.slice(Math.max(0, Number(pos[1]) - 40), Number(pos[1]) + 40).replace(/\n/g, " ")}` : "";
      return `Invalid JSON${at}: ${message}.${nearby}`;
    }
  }
  if (kind === "regex") {
    const src = body.replace(/^\//, "").replace(/\/[a-z]*$/i, "");
    try {
      new RegExp(src);
      return "It compiles.";
    } catch (e) {
      return `That regular expression does not compile: ${e instanceof Error ? e.message : "unknown problem"}.`;
    }
  }
  if (kind === "html") {
    const problem = htmlProblem(body);
    return problem ?? "Every tag is opened and closed in order.";
  }
  if (kind === "js") {
    // Parsed, never run: the whole program is wrapped in a function that is
    // never called, so a syntax error surfaces and nothing else happens.
    try {
      new Function(body);
      return "It parses as JavaScript.";
    } catch (e) {
      return `That is not valid JavaScript: ${e instanceof Error ? e.message : "unknown problem"}.`;
    }
  }
  return `Unknown kind “${kind}”. Use json, regex, html or js.`;
}

/**
 * Reading the web without a computer.
 *
 * `web_search` and `fetch_page` run `curl` inside the desktop sandbox, so an
 * account with no E2B key had no way to look anything up at all — and the
 * system prompt told it to say so. But searching and reading a page are plain
 * HTTP; nothing about them needs a machine. These two do the same work from the
 * server, and the desktop versions are still preferred when one exists because
 * there the page renders the way a person would see it.
 *
 * These are `look_up` and `read_link`, not `search_web` / `open_page`: the 957
 * tool library already uses `search_web` for a planner stub that writes a brief
 * and does no searching at all.
 */
async function httpRaw(url: string, signal?: AbortSignal): Promise<string> {
  const res = await doFetch(url, signal);
  if (!res.ok) throw new Error(`That page answered ${res.status}.`);
  return (await res.text()).slice(0, 400_000);
}

async function httpText(url: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await doFetch(url, signal);
  } catch (e) {
    // A bare "fetch failed" gives a model nothing to act on and gives the user
    // nothing to fix. Name the failure the way the chat route already names
    // provider failures.
    const code = (e as Error & { cause?: { code?: string } }).cause?.code ?? "";
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) throw new Error(`The address for ${hostOf(url)} could not be resolved.`);
    if (/CERT|TLS|SSL|VERIFY|LEAF|SIGNATURE/i.test(code)) throw new Error(`The certificate for ${hostOf(url)} could not be verified.`);
    if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR/.test(code)) throw new Error(`${hostOf(url)} did not respond.`);
    throw new Error(`Could not reach ${hostOf(url)}.`);
  }
  if (!res.ok) {
    throw new Error(`That page answered ${res.status}. ${res.status === 403 || res.status === 429 ? "It is likely blocking automated reads; tell the user the link and what to open." : ""}`.trim());
  }
  const type = res.headers.get("content-type") ?? "";
  if (/json|xml|text\/plain|csv/.test(type)) return (await res.text()).slice(0, 60_000);
  return stripHtml(await res.text());
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "that address";
  }
}

async function doFetch(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    signal,
    redirect: "follow",
    headers: {
      // DuckDuckGo's HTML endpoint answers this UA and refuses a bare one; most
      // sites serve a readable page rather than a bot wall for the same reason.
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    },
  });
}

/** Turn a page into the words on it. Deliberately crude: tags out, entities in. */
function stripHtml(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

const WEB_TOOLS: Tool[] = [
  {
    name: "look_up",
    description:
      "Search the live web and get back a numbered list of results with their links. Use it for anything current, factual, or that you are not certain of — then read the one that matters with read_link. Works with no computer.",
    parameters: obj(
      { query: { type: "string", description: "What to search for." } },
      ["query"],
    ),
  },
  {
    name: "read_link",
    description:
      "Fetch a web page and return the text on it, with scripts and styling removed. Use it after look_up, or on any link the user gives you. Works with no computer.",
    parameters: obj({ url: { type: "string", description: "The http or https address." } }, ["url"]),
  },
];

/** The links in a DuckDuckGo HTML result page, in the order they appear. */
function resultLinks(html: string): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 8) {
    // DuckDuckGo wraps the destination in /l/?uddg=<encoded>.
    const raw = m[1].replace(/&amp;/g, "&");
    const target = /uddg=([^&]+)/.exec(raw);
    const url = target ? decodeURIComponent(target[1]) : raw;
    const title = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (/^https?:/i.test(url) && title) out.push({ title, url });
  }
  return out;
}

async function searchWeb(query: string, signal?: AbortSignal): Promise<string> {
  const q = encodeURIComponent(query);
  // The links have to come out of the markup, so this one reads the page raw:
  // `httpText` returns the words with every tag removed, and an `<a href>` is
  // precisely what a search result is.
  const html = await httpRaw(`https://html.duckduckgo.com/html/?q=${q}`, signal).catch(() => "");
  const links = resultLinks(html);
  if (links.length) {
    // The snippets are worth less than the pages themselves, and clickable
    // addresses are what a model needs to take the next step.
    return [
      `Results for “${query}”:`,
      ...links.map((l, n) => `${n + 1}. ${l.title}\n   ${l.url}`),
      "Call read_link on the one that looks right to read it.",
    ].join("\n");
  }
  // DuckDuckGo turned us away; Bing is a second opinion, and its text is still
  // a real list of results even without the link extraction.
  const fallback = await httpText(`https://www.bing.com/search?q=${q}`, signal).catch(() => "");
  if (fallback.length > 200) return clip(fallback, 8000);
  throw new Error("The search engines did not answer. Try read_link on a specific address instead, or tell the user you could not look it up.");
}

/**
 * Evaluate an arithmetic expression.
 *
 * Not `eval`: the expression is parsed here, so `process.exit()` is a syntax
 * error rather than a call. Numbers and the functions below are the whole
 * language.
 */
function evaluate(expression: string): number {
  // `Math.sqrt(…)` and `Math.PI` are what models write out of habit; the prefix
  // carries no meaning here and removing it early keeps the parser small.
  const src = expression.replace(/\s+/g, "").replace(/Math\./g, "");
  if (!src) throw new Error("Empty expression.");
  if (src.length > 300) throw new Error("That expression is too long.");
  if (!/^[0-9+\-*/%^().,a-z]+$/i.test(src)) throw new Error("Only numbers, operators, parentheses and the listed functions are allowed.");
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    if (peek() === "(") {
      i++;
      const v = sum();
      if (peek() !== ")") throw new Error("Missing a closing parenthesis.");
      i++;
      return v;
    }
    if (peek() === "-") {
      i++;
      return -number();
    }
    if (peek() === "+") {
      i++;
      return number();
    }
    // `Math.` is stripped up front rather than handled here, but a model also
    // writes `Math.sqrt(…)` mid-expression, so drop the prefix wherever it
    // appears before parsing.
    const call = /^(sqrt|abs|round|floor|ceil|min|max|pi)/i.exec(src.slice(i));
    if (call) {
      const name = call[1].toLowerCase();
      i += call[1].length;
      if (name === "pi") {
        if (peek() === "(") i += 2;
        return Math.PI;
      }
      let args: number[] = [];
      if (peek() === "(") {
        i++;
        args = [sum()];
        while (peek() === ",") {
          i++;
          args.push(sum());
        }
        if (peek() !== ")") throw new Error(`Missing a closing parenthesis after ${name}(.`);
        i++;
      } else {
        throw new Error(`${name} needs parentheses, e.g. ${name}(9).`);
      }
      const fns: Record<string, (...xs: number[]) => number> = {
        sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
        ceil: Math.ceil, min: Math.min, max: Math.max,
      };
      return fns[name](...args);
    }
    const m = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i));
    if (!m) {
      const bad = src.slice(i, i + 14);
      throw new Error(
        /[a-z]/i.exec(bad) && !/^(sqrt|abs|round|floor|ceil|min|max|pi)/i.test(bad)
          ? `"${bad}" is not a number or one of the allowed functions. Only arithmetic is supported — there is no code to run.`
          : `Expected a number at position ${i + 1}.`,
      );
    }
    i += m[0].length;
    return Number(m[0]);
  };
  const power = (): number => {
    const base = number();
    if (peek() === "^") {
      i++;
      return Math.pow(base, power());
    }
    if (src.startsWith("**", i)) {
      i += 2;
      return Math.pow(base, power());
    }
    return base;
  };
  const product = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = src[i++];
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const result = sum();
  if (i !== src.length) throw new Error(`Unexpected "${src.slice(i, i + 12)}" at position ${i + 1}.`);
  if (!Number.isFinite(result)) throw new Error("That does not have a finite answer.");
  return result;
}

const COMPUTER_TOOLS: Tool[] = [
  {
    name: "run_command",
    description:
      "Run a bash command on your Linux desktop computer (Ubuntu). python3, node, curl, git and apt (via sudo) are available. Working directory is /home/user. Returns stdout, stderr and the exit code.",
    parameters: obj({ command: { type: "string" } }, ["command"]),
  },
  {
    name: "build_toolchain",
    description:
      "Install a real compiler toolchain on your computer and prove it works. Use this before building an Android app or a native Windows .exe — the plain desktop image has neither. " +
      'kind: "android" installs the Android SDK command-line tools, platform, build-tools and accepts licences; "windows-exe" installs the MinGW-w64 cross-compiler so C, C++ and Rust produce genuine PE32+ .exe files that run on Windows without Electron or a browser; "all" does both. ' +
      "Returns the versions it found after install, so a failed install is visible rather than assumed.",
    parameters: obj(
      {
        kind: { type: "string", enum: ["android", "windows-exe", "all"] },
      },
      ["kind"],
    ),
  },
  CALC_TOOL,
  {
    name: "web_search",
    description: "Search the web and get back the text of the results page. Also shows the results in the browser on your computer.",
    parameters: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "fetch_page",
    description: "Download a web page from your computer and return its readable text (HTML stripped).",
    parameters: obj({ url: { type: "string" } }, ["url"]),
  },
  {
    name: "open_url",
    description: "Open a URL in the browser on your computer so the user can watch it in the Computer panel.",
    parameters: obj({ url: { type: "string" } }, ["url"]),
  },
  {
    name: "write_file",
    description: "Write a text file on your computer. Relative paths are inside /home/user. Files appear in the Files tab of the user's Computer panel, and .html files can be viewed in its Preview tab.",
    parameters: obj({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  },
  {
    name: "read_file",
    description: "Read a text file from your computer.",
    parameters: obj({ path: { type: "string" } }, ["path"]),
  },
  {
    name: "click",
    description: "Left-click at screen coordinates (screen is 1024x768).",
    parameters: obj({ x: { type: "number" }, y: { type: "number" } }, ["x", "y"]),
  },
  {
    name: "type_text",
    description: "Type text with the keyboard into the focused window.",
    parameters: obj({ text: { type: "string" } }, ["text"]),
  },
  {
    name: "press_key",
    description: "Press a key or combination, e.g. 'Return', 'ctrl+l', 'Tab'.",
    parameters: obj({ key: { type: "string" } }, ["key"]),
  },
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s);
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const HOME_DIR = "/home/user";
const safePath = (input: string) => {
  const raw = input.trim();
  if (!raw) throw new Error("A file path is required.");
  const resolved = path.posix.resolve(raw.startsWith("/") ? raw : path.posix.join(HOME_DIR, raw));
  if (resolved !== HOME_DIR && !resolved.startsWith(`${HOME_DIR}/`)) throw new Error("File paths must stay inside /home/user.");
  return resolved;
};
const SCREEN_TOOLS = new Set(["run_command", "web_search", "open_url", "click", "type_text", "press_key"]);

/**
 * Run a command on the desktop and return its output regardless of failure.
 *
 * `run_command` reports the exit code to the model and lets it decide; a
 * toolchain install needs the opposite — the versions printed even when apt or
 * a download half-failed, because "which of these actually landed" is the whole
 * question. Errors become text here, never exceptions.
 */
async function sh(sb: Sandbox, command: string, timeoutMs: number): Promise<string> {
  const r = await sb.commands.run(command, { cwd: "/home/user", timeoutMs }).catch((e: { exitCode?: number; stdout?: string; stderr?: string; message?: string }) => ({
    exitCode: e.exitCode ?? 1,
    stdout: e.stdout ?? "",
    stderr: e.stderr ?? e.message ?? "",
  }));
  const text = `exit ${r.exitCode ?? 0}\n${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
  return clip(text, 3000);
}

const STRIP_PY = `import sys,re,html
t=sys.stdin.read()
t=re.sub(r'(?is)<(script|style|noscript|svg|head)[^>]*>.*?</\\1>',' ',t)
t=re.sub(r'(?s)<[^>]+>','\\n',t)
t=html.unescape(t)
t=re.sub(r'[ \\t\\r\\f\\v]+',' ',t)
t=re.sub(r'\\n\\s*\\n+','\\n',t)
print(t.strip()[:14000])
`;

export type ToolsetEvents = {
  onStepStart: (s: { id: string; name: string; label: string }) => void;
  onStepEnd: (s: StepRecord) => void;
  onShot: (b64: string) => void;
  onChoices: (c: ChoicesRecord) => void;
};

export function buildToolset(opts: {
  userId: string;
  bot: BotRef;
  e2bKey: string | null;
  wantShots: boolean;
  ev: ToolsetEvents;
  signal: AbortSignal;
  allowedTools?: string[];
  allowedConnectors?: string[];
  /**
   * Which connected accounts actually exist for this user. Tools belonging to
   * an account that is not connected are useless — the model can only call
   * them to get an error — and their schemas are re-sent on every step of every
   * tool loop. Omit the list to keep them all (used where connections are not
   * relevant, e.g. tests).
   */
  connected?: Set<string>;
  /**
   * Tools from the capability packs the request matched, with a turn id that
   * scopes any Helper Bots it starts.
   */
  packTools?: Tool[];
  /** The user message, used to pre-select a few library tools. */
  libraryQuery?: string;
  /** The account's image provider, for generate_image. */
  imageConfig?: {
    provider: import("@/lib/ai/providers").ProviderId;
    apiKey: string;
    baseUrl: string;
    imageModel?: string | null;
  };
  turnId: string;
  /** Display name of the Bot, used when a Helper introduces itself. */
  botName?: string;
  onHelper?: (helper: Helper) => void;
  helperAi?: { provider: import("@/lib/ai/providers").ProviderId; apiKey: string; baseUrl: string; model: string };
}) {
  const { userId, bot, e2bKey, ev } = opts;
  let stripScriptReady = false;
  let lastShotAt = 0;
  let lastShot: string | null = null;
  const captureShot = async (sb: Sandbox) => {
    if (lastShot && Date.now() - lastShotAt < 300) return lastShot;
    lastShot = await shot(sb);
    lastShotAt = Date.now();
    return lastShot;
  };
  const toolAllowlist = opts.allowedTools === undefined ? null : new Set(opts.allowedTools);
  const connectorAllowlist = opts.allowedConnectors === undefined ? null : new Set(opts.allowedConnectors);
  let desktop: Sandbox | null = null;

  // The library is large, so the model always gets the two meta-tools that can
  // reach all of it, and only the handful a request actually matches goes in
  // the schema. That is the difference between "a thousand tools available" and
  // "a thousand tool definitions in every prompt".
  const libraryMatches = opts.libraryQuery ? searchToolLibrary(opts.libraryQuery, 8) : [];
  const matchedLibraryTools = libraryMatches
    .map((match) => match.tool)
    // The 957-tool library contains planner stubs — `search_web` among them —
    // that save a brief and return instructions instead of doing the work. When
    // one shares a name with a real implementation, the stub wins by appearing
    // later in the schema, and the user gets "search_web is ready to run" for a
    // simple web search. A stub is never worth a name that is already taken.
    .filter((tool) => ![...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, ...EXACT_TOOLS, ...DESIGN_TOOLS, CHECK_TOOL, ...STUDIO_TOOLS, ...WEB_TOOLS, ...(e2bKey ? COMPUTER_TOOLS : []), ...(opts.packTools ?? [])].some((real) => real.name === tool.name));
  // With a desktop, `web_search` and `fetch_page` do this job inside the
  // sandbox. Without one these are the only way to read the web, so the two
  // sets are never both in the schema — a model choosing between `web_search`
  // and `search_web` would waste a step working out the difference.
  const webTools = e2bKey ? [] : WEB_TOOLS;
  const allTools = e2bKey
    ? [ASK, ...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, ...EXACT_TOOLS, ...DESIGN_TOOLS, CHECK_TOOL, ...STUDIO_TOOLS, ...COMPUTER_TOOLS, ...(opts.packTools ?? []), ...LIBRARY_META_TOOLS, ...matchedLibraryTools]
    : [ASK, ...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, ...EXACT_TOOLS, ...DESIGN_TOOLS, CHECK_TOOL, ...STUDIO_TOOLS, ...webTools, ...(opts.packTools ?? []), ...LIBRARY_META_TOOLS, ...matchedLibraryTools];
  const tools: Tool[] = allTools.filter((tool) => {
    if (tool.name === "ask_user") return true;
    if (toolAllowlist && !toolAllowlist.has(tool.name)) return false;
    const connector = TOOL_CONNECTOR[tool.name];
    if (connector && opts.connected && !opts.connected.has(connector)) return false;
    return true;
  });

  async function getDesktop(): Promise<Sandbox> {
    if (desktop) return desktop;
    if (!e2bKey) throw new Error("No E2B key configured.");
    const { sb } = await ensureDesktop(bot, e2bKey);
    desktop = sb;
    return sb;
  }

  async function fetchText(sb: Sandbox, url: string): Promise<string> {
    if (!stripScriptReady) {
      await sb.files.write("/tmp/strip.py", STRIP_PY);
      stripScriptReady = true;
    }
    const cmd = `curl -sL --max-time 25 -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' ${shq(url)} | python3 /tmp/strip.py`;
    const r = await sb.commands.run(cmd, { timeoutMs: 40_000 }).catch((e: { result?: { stdout?: string; stderr?: string }; message?: string }) => ({
      stdout: e.result?.stdout ?? "",
      stderr: e.result?.stderr ?? e.message ?? "",
    }));
    return r.stdout.trim() || `(no readable content) ${r.stderr}`.trim();
  }

  function labelFor(name: string, a: Record<string, unknown>): string {
    const s = (k: string) => String(a[k] ?? "");
    switch (name) {
      case "run_command":
        return `Ran ${clip(s("command").replace(/\s+/g, " "), 70)}`;
      case "calculate":
        return `Calculated ${clip(s("expression"), 50)}`;
      case "check_code":
        return `Checked the ${clip(s("kind"), 10)}`;
      case "check_contrast":
        return `Checked ${clip(s("foreground"), 10)} on ${clip(s("background"), 10)}`;
      case "color_palette":
        return `Built a palette from ${clip(s("color"), 12)}`;
      case "money_math":
        return `Did the ${clip(s("kind") || "sum", 6)} in money`;
      case "spell_number":
        return `Spelled out ${clip(s("value"), 16)}`;
      case "convert_units":
        return `Converted ${clip(s("amount"), 12)} ${clip(s("from"), 8)} to ${clip(s("to"), 8)}`;
      case "date_math":
        return s("compare") ? `Measured ${clip(s("date"), 12)} to ${clip(s("compare"), 12)}` : `Worked out dates from ${clip(s("date"), 12)}`;
      case "analyze_text":
        return `Measured ${clip(s("text"), 40)}`;
      case "summarize_table":
        return `Summarised a ${String(a.csv ?? "").split("\n").length}-line table`;
      case "json_query":
        return s("path") ? `Read ${clip(s("path"), 40)} from JSON` : "Looked at the shape of a JSON document";
      case "transform_text":
        return `Ran ${clip(s("op"), 16)} on text`;
      case "video_studio":
        return `Opened the video project “${clip(s("title"), 50)}”`;
      case "video_add":
        return `Added ${clip(s("kind"), 10)} to “${clip(s("title"), 40)}”`;
      case "video_edit":
        return `Edited a clip in “${clip(s("title"), 40)}”`;
      case "video_remove":
        return `Removed a clip from “${clip(s("title"), 40)}”`;
      case "audio_studio":
        return `Opened the audio project “${clip(s("title"), 50)}”`;
      case "audio_add":
        return `Added ${clip(s("kind") || "notes", 10)} to “${clip(s("title"), 40)}”`;
      case "audio_mix":
        return `Mixed “${clip(s("title"), 50)}”`;
      case "audio_read":
        return `Read “${clip(s("title"), 50)}”`;
      case "video_narrate":
        return `Wrote narration for “${clip(s("title"), 40)}”`;
      case "video_split":
        return `Split a clip in “${clip(s("title"), 40)}” at ${clip(s("at"), 8)}s`;
      case "video_duplicate":
        return `Duplicated a clip in “${clip(s("title"), 40)}”`;
      case "video_tighten":
        return `Closed gaps in “${clip(s("title"), 40)}”`;
      case "video_read":
        return `Read the video project “${clip(s("title"), 40)}”`;
      case "audio_track":
        return `Added the track “${clip(s("name"), 30)}”`;
      case "audio_repeat":
        return `Repeated a part in “${clip(s("title"), 40)}”`;
      case "audio_remove":
        return s("id") ? `Removed a part from “${clip(s("title"), 40)}”` : `Removed a track from “${clip(s("title"), 40)}”`;
      case "audio_move":
        return `Moved a part in “${clip(s("title"), 40)}”`;
      case "look_up":
        return `Searched “${clip(s("query"), 60)}”`;
      case "read_link":
        return `Read ${clip(s("url"), 70)}`;
      case "workspace_write":
        return `Saved ${clip(s("path"), 60)} to the workspace`;
      case "workspace_read":
        return s("path") ? `Read ${clip(s("path"), 60)}` : "Listed the workspace";
      case "build_toolchain":
        return s("kind") === "android" ? "Installed the Android SDK" : s("kind") === "windows-exe" ? "Installed the Windows .exe compiler" : "Installed Android and .exe toolchains";
      case "web_search":
        return `Searched “${clip(s("query"), 60)}”`;
      case "fetch_page":
        return `Read ${clip(s("url"), 70)}`;
      case "open_url":
        return `Opened ${clip(s("url"), 70)}`;
      case "write_file":
        return `Wrote ${clip(s("path"), 70)}`;
      case "read_file":
        return `Read file ${clip(s("path"), 70)}`;
      case "click":
        return `Clicked (${s("x")}, ${s("y")})`;
      case "type_text":
        return `Typed “${clip(s("text"), 40)}”`;
      case "press_key":
        return `Pressed ${s("key")}`;
      case "ask_user":
        return "Asked you a question";
      case "save_artifact":
        return `Saved artifact “${clip(s("title"), 55)}”`;
      case "draft_email":
        return `Prepared email draft for ${clip(s("to"), 55)}`;
      case "search_gmail":
        return "Searched Gmail";
      case "search_youtube":
      case "search_notion":
        return `Searched ${name === "search_youtube" ? "YouTube" : "Notion"}`;
      case "list_github_repositories":
        return "Listed GitHub repositories";
      case "list_vercel_projects":
        return "Listed Vercel projects";
      case "list_saved_spotify_tracks":
        return "Listed saved Spotify tracks";
      case "design_brief":
        return `Wrote the design brief for “${clip(s("title"), 50)}”`;
      case "make_asset_sheet":
        return `Planned ${s("count")} ${s("kind") || "assets"}`;
      case "draw_asset":
        return `Drew “${clip(s("title"), 50)}”`;
      case "game_design":
        return `Designed “${clip(s("title"), 50)}”`;
      case "scaffold_game":
        return `Built the game “${clip(s("title"), 50)}”`;
      case "scaffold_site":
        return `Built the page “${clip(s("title"), 50)}”`;
      case "scaffold_motion":
        return `Built the animation “${clip(s("title"), 50)}”`;
      case "playtest_game":
        return "Playtested the game";
      case "motion_storyboard":
        return `Storyboarded “${clip(s("title"), 50)}”`;
      case "site_plan":
        return `Planned the site “${clip(s("title"), 50)}”`;
      case "audit_page":
        return "Audited the page";
      case "spawn_helper":
        return `Started a helper: ${clip(s("name"), 40)}`;
      case "helper_status":
        return "Checked the helpers";
      default:
        return name;
    }
  }

  async function exec(name: string, a: Record<string, unknown>): Promise<ToolResult> {
    if (name === "ask_user") {
      const options = (Array.isArray(a.options) ? a.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
      ev.onChoices({ question: String(a.question ?? "Choose one"), options, ...(a.privacy === true ? { action: "privacy" as const } : {}) });
      return { output: "The question is now displayed to the user. Stop and wait for their answer.", stop: true };
    }
    if (name === "get_current_time") {
      const timezone = String(a.timezone ?? "UTC");
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "long", timeZone: timezone }).format(now);
        // "Next Tuesday" and "in three weeks" are where a small model guesses:
        // it knows today, then does the calendar in its head and gets the
        // weekday wrong. Naming the nearby days costs nothing and removes the
        // guess entirely.
        const nearby = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now.getTime() + (i + 1) * 86_400_000);
          // The weekday has to be read in the requested zone, not the server's.
          const name = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: timezone }).format(d);
          return `- ${name}${i === 0 ? " (tomorrow)" : ""}`;
        });
        const today = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(now);
        return {
          output: `${formatted}\nToday is ${today} there. The next seven days:\n${nearby.join("\n")}`,
        };
      } catch {
        return { output: `Invalid timezone: ${timezone}. Use an IANA timezone such as UTC or America/New_York.` };
      }
    }
    if (name === "goals") {
      const action = String(a.action ?? "list");
      const { listGoals, addGoal, updateGoal, deleteGoal, goalsForPrompt } = await import("@/lib/goals");
      if (action === "list") {
        const list = await listGoals(userId);
        if (!list.length) return { output: "The goal list is empty. Add one when the user sets an intention." };
        return { output: `Goals (${list.length} \u2014 shared by every Bot):\n${goalsForPrompt(list)}` };
      }
      if (action === "add") {
        const title = String(a.title ?? "").trim();
        if (!title) return { output: "A goal needs a title." };
        const goal = await addGoal(userId, { title, detail: a.detail ? String(a.detail) : "", botId: bot.id, dueAt: a.due ? String(a.due) : null });
        return { output: `Added goal ${goal.id}: ${goal.title}` };
      }
      const id = String(a.id ?? "");
      if (!id) return { output: `Give the id of the goal to ${action}.` };
      if (action === "update") {
        const goal = await updateGoal(userId, id, {
          title: a.title !== undefined ? String(a.title) : undefined,
          detail: a.detail !== undefined ? String(a.detail) : undefined,
          status: a.status as "open" | "doing" | "done" | undefined,
          dueAt: a.due !== undefined ? String(a.due) : undefined,
        });
        return { output: goal ? `Updated goal: ${goal.title} (${goal.status})` : "No goal with that id." };
      }
      if (action === "complete") {
        const goal = await updateGoal(userId, id, { status: "done" });
        return { output: goal ? `Completed: ${goal.title}` : "No goal with that id." };
      }
      if (action === "remove") {
        return { output: (await deleteGoal(userId, id)) ? "Goal removed." : "No goal with that id." };
      }
      return { output: `Unknown goal action: ${action}` };
    }
    if (name === "make_lyric_video") {
      const { LYRIC_PRESETS } = await import("@/lib/lyric-video");
      const audioId = String(a.audioId ?? "");
      const title = String(a.title ?? "").trim();
      if (!title) return { output: "A lyric video needs a song title." };
      if (!isUuid(audioId)) return { output: "I need the audio artifact id. Ask the user to upload the song in the chat first." };
      // The id must belong to this user and be a real audio upload.
      const { and, eq } = await import("drizzle-orm");
      const { db } = await import("@/db");
      const { artifacts } = await import("@/db/schema");
      const [audio] = await db.select({ id: artifacts.id, kind: artifacts.kind }).from(artifacts).where(and(eq(artifacts.id, audioId), eq(artifacts.userId, userId))).limit(1);
      if (!audio || audio.kind !== "audio") return { output: "That audio id is not one of the user's uploads. Ask them to attach the song again." };
      // Lyrics come from the uploaded file when there is one, so a long file
      // never has to be retyped into the tool call.
      const lyricsId = String(a.lyricsId ?? "");
      let lyrics = String(a.lyrics ?? "");
      if (lyricsId) {
        if (!isUuid(lyricsId)) return { output: "That lyrics artifact id is invalid. Ask the user to upload the file again." };
        const { eq: eqOp } = await import("drizzle-orm");
        const { db: mediaDb } = await import("@/db");
        const { artifacts: mediaArtifacts } = await import("@/db/schema");
        const [file] = await mediaDb
          .select({ content: mediaArtifacts.content, kind: mediaArtifacts.kind })
          .from(mediaArtifacts)
          .where(and(eqOp(mediaArtifacts.id, lyricsId), eqOp(mediaArtifacts.userId, userId)))
          .limit(1);
        if (!file || file.kind !== "lyrics") return { output: "That lyrics id is not one of the user's lyric uploads. Ask them to attach the file again." };
        lyrics = file.content;
      }
      if (!lyrics.trim()) return { output: "I need the lyrics. Ask the user to attach their .lrc, .srt or .ttml file." };
      // The lyrics must actually parse into timed lines, or the card would
      // render an empty stage and look broken.
      const { detectParser } = await import("@braccato/parsers");
      let lineCount = 0;
      try {
        lineCount = detectParser(lyrics).parse(lyrics).length;
      } catch {
        lineCount = 0;
      }
      if (!lineCount) return { output: "Those lyrics did not parse into timed lines. Ask the user for an .lrc, .srt, .ttml or .qrc file, or their plain lyrics one line at a time." };
      const presetRaw = String(a.preset ?? "aurora");
      const preset = presetRaw in LYRIC_PRESETS ? (presetRaw as keyof typeof LYRIC_PRESETS) : "aurora";
      const artId = a.artId ? String(a.artId) : undefined;
      if (artId) {
        if (!isUuid(artId)) return { output: "That cover art id is invalid. Please upload it again." };
        const [cover] = await db.select({ kind: artifacts.kind }).from(artifacts).where(and(eq(artifacts.id, artId), eq(artifacts.userId, userId))).limit(1);
        if (!cover || cover.kind !== "image") return { output: "That cover art is not one of your uploads." };
      }
      const spec = {
        version: 1 as const,
        title,
        artist: a.artist ? String(a.artist) : undefined,
        audioId,
        artId,
        lyrics,
        lyricFormat: a.lyricFormat ? String(a.lyricFormat) : undefined,
        preset,
        accent: a.accent ? String(a.accent) : undefined,
      };
      const [row] = await db.insert(artifacts).values({
        userId,
        botId: bot.id,
        title: `${title}${spec.artist ? ` — ${spec.artist}` : ""} · lyric video`,
        kind: "lyric_video",
        content: JSON.stringify(spec),
      }).returning({ id: artifacts.id });
      return { output: `Interactive lyric-video player ready (artifact ${row.id}). Tell the user to press play. This is not an MP4 file; MP4 rendering and export are not available, so do not claim a video file was generated.`, artifactId: row.id };
    }
    if (name === "save_artifact" || name === "draft_email") {
      const title = String(a.title ?? (name === "draft_email" ? `Email to ${String(a.to ?? "recipient")}` : "Untitled artifact")).trim().slice(0, 160);
      const kind = name === "draft_email" ? "email_draft" : String(a.kind ?? "document");
      const content = name === "draft_email" ? JSON.stringify({ to: String(a.to ?? "").trim(), subject: String(a.subject ?? "").trim(), body: String(a.body ?? "") }) : String(a.content ?? "");
      if (!title || !content || content.length > 100_000) return { output: "The artifact needs a title and content under 100 KB." };
      // Recipients may be bare addresses or “Name <a@x.com>”, separated by commas.
      if (name === "draft_email") {
        const recipients = splitRecipients(String(a.to ?? ""));
        const subjectLine = String(a.subject ?? "");
        if (!recipients.ok.length || recipients.invalid.length) {
          return { output: "That email draft needs at least one valid recipient (name@example.com). Separate several with commas." };
        }
        if (!subjectLine.trim() || /[\r\n]/.test(subjectLine)) {
          return { output: "That email draft needs a subject on a single line." };
        }
        if (!String(a.body ?? "").trim()) return { output: "That email draft needs a body." };
      }
      const [saved] = await db.insert(artifacts).values({ botId: bot.id, userId, title, kind, content }).returning({ id: artifacts.id });
      return {
        artifactId: saved.id,
        output:
          name === "draft_email"
            ? `Email draft saved (id ${saved.id}). It is shown as a card in the chat for the user to review and send — do not say it has been sent.`
            : `Saved to Artifacts (id ${saved.id}).`,
      };
    }
    if (["search_gmail", "search_youtube", "search_notion", "list_github_repositories", "list_vercel_projects", "list_saved_spotify_tracks"].includes(name)) {
      const provider = name === "search_gmail" || name === "search_youtube" ? "google" : name === "search_notion" ? "notion" : name === "list_github_repositories" ? "github" : name === "list_vercel_projects" ? "vercel" : "spotify";
      let token: string;
      try { token = await getConnectionToken(provider, userId); }
      catch { return { output: `Connect your ${provider === "google" ? "Google" : provider[0].toUpperCase() + provider.slice(1)} account in Settings > Connections to use this tool.` }; }
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      try {
        if (name === "list_saved_spotify_tracks") {
          const response = await fetch("https://api.spotify.com/v1/me/tracks?limit=10", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("Spotify request failed.");
          const data = await response.json();
          return { output: JSON.stringify((data.items ?? []).map((item: { added_at?: string; track?: { name?: string; artists?: Array<{ name?: string }>; album?: { name?: string }; external_urls?: { spotify?: string } } }) => ({ title: item.track?.name, artists: item.track?.artists?.map((artist) => artist.name), album: item.track?.album?.name, addedAt: item.added_at, url: item.track?.external_urls?.spotify }))) };
        }
        if (name === "search_gmail") {
          const query = String(a.query ?? "").trim().slice(0, 200);
          if (!query) return { output: "Provide a Gmail search query." };
          const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
          url.searchParams.set("q", query);
          url.searchParams.set("maxResults", "5");
          const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("Gmail search failed.");
          const data = await response.json();
          const messages = await Promise.all((data.messages ?? []).map(async (message: { id: string }) => {
            const detail = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
            if (!detail.ok) return null;
            const item = await detail.json();
            const headers = item.payload?.headers ?? [];
            return { subject: headers.find((header: { name: string }) => header.name.toLowerCase() === "subject")?.value, from: headers.find((header: { name: string }) => header.name.toLowerCase() === "from")?.value, date: headers.find((header: { name: string }) => header.name.toLowerCase() === "date")?.value, snippet: item.snippet };
          }));
          return { output: JSON.stringify(messages.filter(Boolean)) };
        }
        if (name === "search_youtube") {
          const query = String(a.query ?? "").trim().slice(0, 200);
          const url = new URL("https://www.googleapis.com/youtube/v3/search");
          url.searchParams.set("part", "snippet"); url.searchParams.set("type", "video"); url.searchParams.set("maxResults", "5"); url.searchParams.set("q", query);
          const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("YouTube search failed.");
          const data = await response.json();
          return { output: JSON.stringify((data.items ?? []).map((item: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }) => ({ title: item.snippet?.title, channel: item.snippet?.channelTitle, url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : undefined }))) };
        }
        if (name === "search_notion") {
          const response = await fetch("https://api.notion.com/v1/search", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" }, body: JSON.stringify({ query: String(a.query ?? "").trim().slice(0, 200), page_size: 10 }), cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("Notion search failed.");
          const data = await response.json();
          return { output: JSON.stringify((data.results ?? []).map((page: { id: string; url?: string; title?: Array<{ plain_text?: string }>; properties?: Record<string, { title?: Array<{ plain_text?: string }> }> }) => ({ id: page.id, url: page.url, title: page.title?.map((part) => part.plain_text).join("") ?? Object.values(page.properties ?? {}).find((p) => p.title)?.title?.map((part) => part.plain_text).join("") })) ) };
        }
        if (name === "list_github_repositories") {
          const response = await fetch("https://api.github.com/user/repos?sort=updated&per_page=10", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store", signal: opts.signal });
          if (!response.ok) throw new Error("GitHub request failed.");
          const data = await response.json();
          return { output: JSON.stringify(data.map((repo: { full_name: string; html_url: string; description?: string; private: boolean }) => ({ name: repo.full_name, url: repo.html_url, description: repo.description, private: repo.private }))) };
        }
        const response = await fetch("https://api.vercel.com/v9/projects?limit=20", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: opts.signal });
        if (!response.ok) throw new Error("Vercel request failed.");
        const data = await response.json();
        return { output: JSON.stringify((data.projects ?? []).map((project: { name: string; id: string; link?: { repo?: string } }) => ({ name: project.name, id: project.id, repository: project.link?.repo }))) };
      } catch { return { output: `Could not access ${provider}. Check the connection and requested permissions in Settings > Connections.` }; }
    }
    if (name === "find_tools") {
      const query = String(a.query ?? "").trim();
      if (!query) return { output: "Describe what you want to do." };
      const limit = Math.max(1, Math.min(25, Number(a.limit) || 10));
      const hits = searchToolLibrary(query, limit);
      if (!hits.length) {
        return { output: "Nothing in the library matches that. Build it yourself with the tools you have." };
      }
      // A weak hit is reported as weak. Without this the model ran the
      // top-scoring tool regardless of score, which is how "summarize this
      // document" ended up invoking a tool about elevation rules: the word
      // "document" was shared, the job was not. Telling it plainly that the
      // match is thin lets it decide to build the thing instead.
      const weak = hits[0].score <= WEAK_MATCH_SCORE;
      const list = hits.map((hit) => `${hit.name} — ${hit.summary} (call run_tool with this name)`).join("\n");
      return {
        output: weak
          ? `These are only loose matches — the library may not have a tool for exactly "${query}", so check the summary before running one, and build it yourself if none fits:\n${list}`
          : list,
      };
    }
    if (name === "run_tool") {
      const requested = String(a.name ?? "").trim();
      const tool = libraryToolByName(requested);
      // Only tools in the library may be run through this door — otherwise the
      // meta-tool would be an escape hatch around permissions.
      if (!tool) {
        return { output: `There is no library tool called "${requested}". Use find_tools to get an exact name.` };
      }
      const title = String(a.title ?? tool.summary).trim();
      const detail = String(a.detail ?? "").trim();
      return runLibraryTool(tool, { title, detail }, {
        userId,
        botId: bot.id,
        turnId: opts.turnId,
        signal: opts.signal,
        writeFile: e2bKey
          ? async (path, content) => {
              const sb = await getDesktop();
              await sb.files.write(safePath(path), content);
            }
          : undefined,
      });
    }
    // This runs before the handlers below, so a library stub called `look_up`
    // would swallow the real one. The filter above already keeps such names out
    // of the schema; this guards the ordering as well.
    const isRealTool = [ASK, ...CORE_TOOLS, ...WORKSPACE_TOOLS, CALC_TOOL, ...EXACT_TOOLS, ...DESIGN_TOOLS, CHECK_TOOL, ...STUDIO_TOOLS, ...WEB_TOOLS].some((t) => t.name === name);
    if (!isRealTool && opts.libraryQuery && matchedLibraryTools.some((tool) => tool.name === name)) {
      const tool = libraryToolByName(name);
      if (tool) {
        return runLibraryTool(tool, { title: String(a.title ?? tool.summary), detail: String(a.detail ?? "") }, {
          userId,
          botId: bot.id,
          turnId: opts.turnId,
          signal: opts.signal,
          writeFile: e2bKey
            ? async (path, content) => {
                const sb = await getDesktop();
                await sb.files.write(safePath(path), content);
              }
            : undefined,
        });
      }
    }

    // Capability-pack tools are executed here so they can borrow the desktop
    // and the helper registry without the chat route having to know about them.
    if (opts.packTools?.some((tool) => tool.name === name)) {
      return runPackTool(name, a, {
        userId,
        botId: bot.id,
        turnId: opts.turnId,
        signal: opts.signal,
        writeFile: e2bKey
          ? async (path, content) => {
              const sb = await getDesktop();
              await sb.files.write(safePath(path), content);
            }
          : undefined,
        readFile: e2bKey
          ? async (path) => {
              const sb = await getDesktop();
              return sb.files.read(safePath(path)).catch(() => null);
            }
          : undefined,
        readFileBase64: e2bKey
          ? async (path) => {
              const sb = await getDesktop();
              const bytes = await sb.files.read(safePath(path), { format: "bytes" }).catch(() => null);
              return bytes ? Buffer.from(bytes).toString("base64") : null;
            }
          : undefined,
        runCommand: e2bKey
          ? async (command, timeoutMs) => {
              const sb = await getDesktop();
              const r = await sb.commands.run(command, { cwd: HOME_DIR, timeoutMs: timeoutMs ?? 120_000 }).catch((e: { exitCode?: number; stdout?: string; stderr?: string; message?: string }) => ({
                exitCode: e.exitCode ?? 1,
                stdout: e.stdout ?? "",
                stderr: e.stderr ?? e.message ?? "",
              }));
              return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
            }
          : undefined,
        spawn: (input) => {
          if (!opts.helperAi) throw new Error("Helper Bots are not available on this turn.");
          const helper = spawnHelper({
            turnId: opts.turnId,
            userId,
            botId: bot.id,
            botName: opts.botName ?? "the main Bot",
            name: input.name,
            task: input.task,
            context: input.context,
            artifactKind: input.artifactKind,
            ai: opts.helperAi,
            tools,
            runTool: run,
            signal: opts.signal,
          });
          opts.onHelper?.(helper);
          return helper.id;
        },
        imageConfig: opts.imageConfig,
        helperStatus: async (seconds) => {
          await waitForHelpers(opts.turnId, seconds, opts.signal);
          return helpersFor(opts.turnId).map((helper) => helperSummary(helper));
        },
      });
    }

    // The workspace needs no computer, so it is handled before the desktop is
    // ever requested. These two cases used to fall through to `getDesktop()`,
    // which throws "No E2B key configured" on exactly the accounts that need
    // them most.
    if (name === "calculate") {
      const expression = String(a.expression ?? "").trim();
      try {
        const value = evaluate(expression);
        // Both forms: `0.30000000000000004` is technically right and useless in
        // a sentence, so a rounded value is offered alongside the exact one.
        const rounded = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
        return { output: `${expression} = ${rounded}${rounded !== String(value) ? ` (exactly ${value})` : ""}` };
      } catch (e) {
        return { output: `${e instanceof Error ? e.message : "Could not evaluate that."} Write it as plain arithmetic, e.g. (1250 * 0.08) / 3.` };
      }
    }
    if (["describe_numbers", "convert_time_zones", "estimate_loan", "compare_texts"].includes(name)) {
      const { describeNumbers, convertTime, loanEstimate, compareLines } = await import("@/lib/advanced-tools");
      const result = name === "describe_numbers" ? describeNumbers(a.values)
        : name === "convert_time_zones" ? convertTime(String(a.instant ?? ""), a.zones)
        : name === "estimate_loan" ? loanEstimate(a.principal, a.annualRate, a.months)
        : compareLines(String(a.before ?? ""), String(a.after ?? ""));
      return { output: "error" in result && result.error ? result.error : JSON.stringify(result) };
    }
    if (name === "check_contrast") {
      const { contrastRatio } = await import("@/lib/utilities");
      const result = contrastRatio(String(a.foreground ?? ""), String(a.background ?? ""));
      if ("error" in result) return { output: result.error };
      return {
        output: `${String(a.foreground)} on ${String(a.background)} is ${result.ratio}:1 — AA body text ${result.aa ? "passes" : "fails"} (needs 4.5), large text and UI ${result.aaLarge ? "passes" : "fails"} (needs 3), AAA ${result.aaa ? "passes" : "fails"} (needs 7).`,
      };
    }
    if (name === "color_palette") {
      const { paletteFrom } = await import("@/lib/utilities");
      const result = paletteFrom(String(a.color ?? ""));
      if ("error" in result) return { output: result.error };
      return {
        output: [
          `From ${result.base}:`,
          `  light ${result.light} · dark ${result.dark}`,
          `  tint ${result.tint} · shade ${result.shade}`,
          `  complement ${result.complement}`,
        ].join("\n"),
      };
    }
    if (name === "money_math") {
      const { moneySum, moneyTax, moneySplit, tidy } = await import("@/lib/utilities");
      const kind = String(a.kind ?? "sum");
      if (kind === "tax") {
        const result = moneyTax(Number(a.amount) || 0, Number(a.rate) || 0);
        return { output: `${tidy(result.amount)} plus ${tidy(Number(a.rate) || 0)}% tax is ${tidy(result.total)} — tax ${tidy(result.tax)}.` };
      }
      if (kind === "split") {
        const parts = moneySplit(Number(a.amount), Number(a.parts));
        if ("error" in parts) return { output: parts.error };
        return { output: `${tidy(Number(a.amount) || 0)} split ${parts.length} ways: ${parts.map(tidy).join(", ")} (total ${tidy(moneySum(parts).total)}).` };
      }
      const amounts = Array.isArray(a.amounts) ? a.amounts.map(Number).filter((n) => Number.isFinite(n)) : [];
      if (!amounts.length) return { output: "Give a list of amounts to add." };
      const result = moneySum(amounts);
      return { output: `${amounts.map(tidy).join(" + ")} = ${tidy(result.total)}` };
    }
    if (name === "spell_number") {
      const { numberToWords } = await import("@/lib/utilities");
      const value = Number(a.value);
      if (!Number.isFinite(value)) return { output: "Give a number." };
      return { output: `${value} is ${numberToWords(value)}.` };
    }
    if (name === "convert_units") {
      const { convertUnits, tidy } = await import("@/lib/utilities");
      const result = convertUnits(Number(a.amount), String(a.from ?? ""), String(a.to ?? ""));
      if ("error" in result) return { output: result.error };
      return {
        output: `${tidy(Number(a.amount))} ${result.from} = ${tidy(result.value)} ${result.to}${result.family === "temperature" ? " (temperature is affine, so this is not a simple ratio)" : ""}`,
      };
    }
    if (name === "date_math") {
      const { dateMath } = await import("@/lib/utilities");
      const result = dateMath({
        date: String(a.date ?? ""),
        ...(a.compare ? { compare: String(a.compare) } : {}),
        ...(a.addDays !== undefined && a.addDays !== "" ? { addDays: Number(a.addDays) } : {}),
        ...(a.addMonths !== undefined && a.addMonths !== "" ? { addMonths: Number(a.addMonths) } : {}),
        ...(a.addYears !== undefined && a.addYears !== "" ? { addYears: Number(a.addYears) } : {}),
        ...(a.addBusinessDays !== undefined && a.addBusinessDays !== "" ? { addBusinessDays: Number(a.addBusinessDays) } : {}),
      });
      if ("error" in result) return { output: result.error };
      if (result.kind === "weekday") return { output: `${result.date} is a ${result.weekday}.` };
      if (result.kind === "between") {
        const direction = result.days < 0 ? "before" : "after";
        return {
          output: `${result.to} is ${Math.abs(result.days)} days ${direction} ${result.from} — ${Math.abs(result.weeks)} weeks, or ${Math.abs(result.businessDays)} business days.`,
        };
      }
      return { output: `${result.from} plus the offset is ${result.to}, a ${result.weekday} (${result.days} days).` };
    }
    if (name === "analyze_text") {
      const { analyseText } = await import("@/lib/utilities");
      const text = String(a.text ?? "");
      if (!text.trim()) return { output: "There is no text to measure." };
      const s2 = analyseText(text);
      return {
        output: [
          `${s2.words} words, ${s2.characters} characters (${s2.charactersNoSpaces} without spaces), ${s2.sentences} sentences, ${s2.paragraphs} paragraphs.`,
          `About ${s2.readingMinutes} minutes to read aloud. Longest word: ${s2.longestWord}.`,
          s2.topWords.length ? `Most used: ${s2.topWords.map((w) => `${w.word} (${w.count})`).join(", ")}.` : "",
          s2.emails.length ? `Emails: ${s2.emails.slice(0, 10).join(", ")}.` : "",
          s2.urls.length ? `Links: ${s2.urls.slice(0, 10).join(", ")}.` : "",
          s2.numbers.length ? `Numbers: ${s2.numbers.slice(0, 20).join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    if (name === "summarize_table") {
      const { summarizeTable } = await import("@/lib/utilities");
      const result = summarizeTable(String(a.csv ?? ""), { ...(a.delimiter ? { delimiter: String(a.delimiter) } : {}) });
      if ("error" in result) return { output: result.error };
      return {
        output: [
          `${result.rows} rows, ${result.columns.length} columns: ${result.columns.join(", ")}.`,
          ...result.numeric.map((n) => `${n.column}: min ${n.min}, max ${n.max}, sum ${n.sum}, mean ${n.mean}.`),
          result.numeric.length ? "" : "No column was numeric enough to summarise.",
          `${result.empty} empty cells${result.duplicateRows ? `, and ${result.duplicateRows} duplicate row${result.duplicateRows === 1 ? "" : "s"}` : ", no duplicate rows"}.`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    if (name === "json_query") {
      const { jsonQuery } = await import("@/lib/utilities");
      return { output: jsonQuery(String(a.json ?? ""), String(a.path ?? ""), Boolean(a.list)) };
    }
    if (name === "transform_text") {
      const { transformText } = await import("@/lib/utilities");
      const op = String(a.op ?? "slug") as Parameters<typeof transformText>[1];
      return { output: transformText(String(a.text ?? ""), op) };
    }
    if (name === "video_narrate") return await narrateVideo({ userId, botId: bot.id }, a);
    if (name === "video_split") return await splitVideoClip({ userId, botId: bot.id }, a);
    if (name === "video_duplicate") return await duplicateVideoClip({ userId, botId: bot.id }, a);
    if (name === "video_tighten") return await tightenVideoTrack({ userId, botId: bot.id }, a);
    if (name === "video_read") return await readVideoProject({ userId, botId: bot.id }, a);
    if (name === "audio_track") return await addAudioTrack({ userId, botId: bot.id }, a);
    if (name === "audio_repeat") return await repeatAudioPart({ userId, botId: bot.id }, a);
    if (name === "audio_remove") return await removeAudioPart({ userId, botId: bot.id }, a);
    if (name === "audio_move") return await moveAudioPart({ userId, botId: bot.id }, a);
    if (name === "video_studio") return await openVideoStudio({ userId, botId: bot.id }, a);
    if (name === "video_add") return await addVideoClip({ userId, botId: bot.id }, a);
    if (name === "video_edit") return await editVideoClip({ userId, botId: bot.id }, a);
    if (name === "video_remove") return await removeVideoClip({ userId, botId: bot.id }, a);
    if (name === "audio_studio") return await openAudioStudio({ userId, botId: bot.id }, a);
    if (name === "audio_add") return await addAudioPart({ userId, botId: bot.id }, a);
    if (name === "audio_mix") return await editAudioTrack({ userId, botId: bot.id }, a);
    if (name === "audio_read") return await readAudioProject({ userId, botId: bot.id }, String(a.title ?? "").trim());

    if (name === "check_code") {
      return { output: checkCode(String(a.kind ?? "").toLowerCase(), String(a.text ?? "")) };
    }
    if (name === "look_up") {
      const query = String(a.query ?? "").trim();
      if (!query) return { output: "Give look_up something to search for." };
      // Thrown rather than returned so the step is marked failed and the model
      // gets an `Error:` line it will treat as a wall to route around.
      return { output: clip(await searchWeb(query, opts.signal), 12000) };
    }
    if (name === "read_link") {
      const raw = String(a.url ?? "").trim();
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error("That is not a web address. It should look like https://example.com/page");
      const text = await httpText(url, opts.signal);
      return { output: text.trim() ? clip(text, 12000) : "(The page had no readable text — it may be built entirely by scripts.)" };
    }
    if (name === "workspace_write") {
      const path = String(a.path ?? "").trim().slice(0, 200);
      const content = String(a.content ?? "");
      if (!path) return { output: "Give the file a path, e.g. notes.md" };
      if (!content) return { output: "Nothing to write: content was empty." };
      const title = `workspace:${path}`;
      // One row per path, so a path reads back as its latest version rather
      // than as a pile of drafts nobody can choose between.
      const [existing] = await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(and(eq(artifacts.userId, userId), eq(artifacts.botId, bot.id), eq(artifacts.title, title)))
        .limit(1);
      if (existing) {
        await db.update(artifacts).set({ content, kind: "file" }).where(eq(artifacts.id, existing.id));
      } else {
        await db.insert(artifacts).values({ userId, botId: bot.id, title, kind: "file", content });
      }
      return { output: `Saved ${path} (${content.length} characters) to the workspace.` };
    }
    if (name === "workspace_read") {
      const path = String(a.path ?? "").trim();
      const mine = and(eq(artifacts.userId, userId), eq(artifacts.botId, bot.id), eq(artifacts.kind, "file"));
      if (!path) {
        const rows = await db
          .select({ title: artifacts.title, content: artifacts.content })
          .from(artifacts)
          .where(mine)
          .orderBy(desc(artifacts.createdAt))
          .limit(50);
        if (!rows.length) return { output: "The workspace is empty. Save something with workspace_write." };
        return {
          output: `Workspace files:\n${rows.map((r) => `- ${r.title.replace(/^workspace:/, "")} (${r.content.length} chars)`).join("\n")}`,
        };
      }
      const [row] = await db
        .select({ content: artifacts.content })
        .from(artifacts)
        .where(and(mine, eq(artifacts.title, `workspace:${path.slice(0, 200)}`)))
        .limit(1);
      if (!row) return { output: `No file at ${path} in the workspace. Call workspace_read with no path to list what is there.` };
      // A long file used to arrive as its first 20,000 characters and stop. For
      // a model that cannot run anything, that is a document it can never
      // finish: it summarises a third of the file and never learns the rest
      // exists. The slices are numbered so it can ask for the next one.
      const total = Math.max(1, Math.ceil(row.content.length / PART_CHARS));
      if (total === 1) return { output: row.content };
      const start = Math.min(Math.max(0, Math.floor(Number(a.offset ?? 0)) || 0), row.content.length - 1);
      const which = Math.floor(start / PART_CHARS) + 1;
      const slice = row.content.slice(start, start + PART_CHARS);
      const next = start + PART_CHARS;
      return {
        output:
          `Part ${which} of ${total} of ${path} (${row.content.length} characters in total):\n\n${slice}` +
          (next < row.content.length
            ? `\n\n[End of part ${which}. Read the next with workspace_read path "${path}" offset ${next}.]`
            : ""),
      };
    }

    // Anything that reaches here should be a known tool. Falling through to the
    // desktop for an unknown name produced "No E2B key configured", which told
    // the user nothing about the actual mistake.
    const known = new Set([...allTools.map((tool) => tool.name), "run_command", "web_search", "fetch_page", "open_url", "write_file", "read_file", "click", "type_text", "press_key"]);
    if (!known.has(name)) {
      return { output: `The tool "${name}" is not available on this turn. Use the tools you were given, or say what you cannot do.` };
    }

    const sb = await getDesktop();
    switch (name) {
      case "run_command": {
        const cmd = String(a.command ?? "");
        const r = await sb.commands
          .run(cmd, { cwd: "/home/user", timeoutMs: 120_000 })
          .catch((e: { exitCode?: number; stdout?: string; stderr?: string; message?: string }) => ({
            exitCode: e.exitCode ?? 1,
            stdout: e.stdout ?? "",
            stderr: e.stderr ?? e.message ?? "",
          }));
        return { output: clip(`exit code: ${r.exitCode}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`, 12000) };
      }
      case "build_toolchain": {
        const kind = String(a.kind ?? "all");
        const wantAndroid = kind === "android" || kind === "all";
        const wantWindows = kind === "windows-exe" || kind === "all";
        const out: string[] = [];
        // Both installs share one apt pass: two `apt-get update`s cost a minute
        // each on a cold desktop image.
        if (wantWindows) {
          out.push(
            "== windows-exe ==",
            await sh(
              sb,
              "export DEBIAN_FRONTEND=noninteractive; " +
                "sudo apt-get update -qq >/dev/null 2>&1; " +
                // mingw-w64 gives a real PE cross-compiler; g++ too, so C++ and
                // the Rust `x86_64-pc-windows-gnu` target both have a linker.
                "sudo apt-get install -y -qq mingw-w64 >/dev/null 2>&1 || echo 'apt install failed'; " +
                "which x86_64-w64-mingw32-gcc x86_64-w64-mingw32-g++ 2>/dev/null; " +
                "x86_64-w64-mingw32-gcc --version 2>/dev/null | head -1",
              600_000,
            ),
          );
        }
        if (wantAndroid) {
          // The SDK is not in apt, and `sdkmanager` insists on a licence prompt,
          // so this installs the command-line tools, accepts every licence, then
          // resolves one platform and one build-tools release to prove it works.
          out.push(
            "== android ==",
            await sh(
              sb,
              [
                "export DEBIAN_FRONTEND=noninteractive",
                "sudo apt-get install -y -qq openjdk-17-jdk unzip >/dev/null 2>&1 || echo 'jdk apt failed'",
                "export ANDROID_HOME=/home/user/android-sdk",
                "mkdir -p $ANDROID_HOME/cmdline-tools",
                "if [ ! -d $ANDROID_HOME/cmdline-tools/latest ]; then",
                "  cd /tmp && curl -sSL -o cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip || echo 'download failed'",
                "  unzip -q -o cmdtools.zip -d /tmp/cmdtools && mv /tmp/cmdtools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest 2>/dev/null",
                "fi",
                "export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$PATH",
                "yes | sdkmanager --licenses >/dev/null 2>&1 || true",
                "sdkmanager 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0' >/dev/null 2>&1 || echo 'sdkmanager failed'",
                "echo \"ANDROID_HOME=$ANDROID_HOME\"",
                "ls $ANDROID_HOME/platforms 2>/dev/null | head -3",
                "ls $ANDROID_HOME/build-tools 2>/dev/null | head -3",
              ].join("; "),
              900_000,
            ),
          );
          out.push(
            "Put these in the environment of every Android build:",
            "ANDROID_HOME=/home/user/android-sdk",
            "PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH",
          );
        }
        out.push(
          "",
          "A .exe must be a native Windows binary. Electron is a browser wrapped inside one — " +
            "not the same thing, and it will not run on a machine without Chromium. The two ways " +
            "that produce a real one here:",
          "  C/C++:  x86_64-w64-mingw32-gcc -O2 -o app.exe main.c -static",
          "  Rust:   cargo build --release --target x86_64-pc-windows-gnu",
          "Then prove it — do not assume:",
          "  x86_64-w64-mingw32-objdump -f app.exe | grep -E 'architecture|file format'",
          "Expect `pei-x86-64` and `pei-x86-64`. `file app.exe` also says 'PE32+ executable " +
            "(console) x86-64, for MS Windows' where binutils' `file` is installed.",
          wantAndroid
            ? "Android: set ANDROID_HOME and PATH as printed above, then build with Gradle " +
              "(`./gradlew assembleDebug`) or compile a plain .apk with aapt2 + d8 + zipalign + apksigner " +
              "from build-tools. `sdkmanager --list_installed` shows what actually landed."
            : "",
        );
        return { output: out.join("\n") };
      }
      case "web_search": {
        const q = String(a.query ?? "");
        openInBrowser(sb, `https://duckduckgo.com/?q=${encodeURIComponent(q)}`).catch(() => {});
        let text = await fetchText(sb, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
        if (text.length < 200) text = await fetchText(sb, `https://www.bing.com/search?q=${encodeURIComponent(q)}`);
        return { output: clip(text, 12000) };
      }
      case "fetch_page": {
        const url = normalizeUrl(String(a.url ?? ""));
        if (!/^https?:/i.test(url)) throw new Error("Only http(s) URLs can be fetched.");
        return { output: clip(await fetchText(sb, url), 12000) };
      }
      case "open_url": {
        await openInBrowser(sb, String(a.url ?? ""));
        await sleep(900);
        return { output: "Opened in the browser." };
      }
      case "write_file": {
        const path = safePath(String(a.path ?? ""));
        await sb.files.write(path, String(a.content ?? ""));
        return { output: `Wrote ${path}` };
      }
      case "read_file": {
        const path = safePath(String(a.path ?? ""));
        return { output: clip(await sb.files.read(path), 12000) };
      }
      case "click": {
        await sb.leftClick(Number(a.x), Number(a.y));
        return { output: "Clicked." };
      }
      case "type_text": {
        await sb.write(String(a.text ?? ""));
        return { output: "Typed." };
      }
      case "press_key": {
        const key = String(a.key ?? "");
        await sb.press(key.includes("+") ? key.split("+").map((k) => k.trim()) : key);
        return { output: "Pressed." };
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  }

  // A small model's most common way to waste a turn is to retry the exact call
  // that just failed — same tool, same arguments — until the step cap ends the
  // job. The second identical attempt is honest (a flaky request can succeed on
  // a retry), so it runs; the fourth is a loop, and the useful thing to return
  // is a sentence that names the problem instead of the same error again.
  let lastKey = "";
  let repeats = 0;

  async function run(name: string, args: Record<string, unknown>, id: string): Promise<ToolResult> {
    const label = labelFor(name, args);
    const startedAt = Date.now();
    ev.onStepStart({ id, name, label });
    if (opts.signal.aborted) throw new Error("aborted");
    const key = `${name}:${JSON.stringify(args)}`;
    repeats = key === lastKey ? repeats + 1 : 0;
    lastKey = key;
    if (repeats >= 3) {
      const looped = `You have now asked for ${name} with these exact arguments ${repeats + 1} times and the result has not changed. Do not call it again. Either change the arguments, use a different tool, or tell the user plainly what is blocking you and what you need from them.`;
      ev.onStepEnd({ id, name, label, ok: false, ms: Date.now() - startedAt, output: clip(looped, 400) });
      return { output: looped };
    }
    try {
      if (toolAllowlist && name !== "ask_user" && !toolAllowlist.has(name)) throw new Error("This tool is not allowed by the Bot's enabled skills.");
      const connector = TOOL_CONNECTOR[name];
      if (connector && connectorAllowlist && !connectorAllowlist.has(connector)) throw new Error("This connected account is not allowed by the Bot's enabled skills.");
      const [privacySession] = await db.select({ id: privacySessions.id }).from(privacySessions).where(and(eq(privacySessions.userId, userId), eq(privacySessions.status, "active"))).limit(1);
      if (privacySession) throw new Error("Privacy Mode is active. Bot tools are paused until you press I'm Done.");
      const r = await exec(name, args);
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      ev.onStepEnd({ id, name, label, ok: true, ms: Date.now() - startedAt, output: clip(r.output, 1500), ...(r.artifactId ? { artifactId: r.artifactId } : {}) });
      if (desktop && opts.wantShots && SCREEN_TOOLS.has(name) && !opts.signal.aborted) {
        const b = await captureShot(desktop);
        if (b && !opts.signal.aborted) ev.onShot(b);
      }
      return r;
    } catch (e) {
      if (opts.signal.aborted) return { output: "The request was paused for Privacy Mode." };
      const msg = e instanceof Error ? e.message : "Tool failed";
      ev.onStepEnd({ id, name, label, ok: false, ms: Date.now() - startedAt, output: clip(msg, 800) });
      // "Error: …" is a line of text a small model can read past, and then write
      // "Done — the file is saved" over the top of it. The rest of the sentence
      // is the part that matters: it says the thing did NOT happen and that
      // claiming otherwise would be a lie, which is what the model needs in
      // order to report the failure instead of inventing a result.
      return {
        output:
          `Error: ${msg}\n\n` +
          `That did not happen. Do not tell the user ${name} succeeded, and do not present a made-up result. ` +
          `Either try a different approach or say plainly that it failed and what you need to fix it.`,
      };
    }
  }

  return { tools, run };
}
