/**
 * Exact work a language model gets wrong.
 *
 * Every tool here replaces a guess with an answer: unit conversion, date
 * arithmetic, text measurement, table summarising, JSON lookup and string
 * transforms. None needs a computer, none calls a model, and each one is
 * deterministic — which is the point. A small model asked how many miles 12
 * kilometres is will produce a confident, plausible number, and this produces
 * the right one.
 */

/* ---------------------------------- units ---------------------------------- */

/** Each family maps a unit to how many base units it is. Temperature is not
 *  here because it is not multiplicative — it has its own function below. */
const UNITS: Record<string, Record<string, number>> = {
  length: {
    mm: 0.001, cm: 0.01, m: 1, km: 1000,
    in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344,
    nmi: 1852,
  },
  mass: {
    mg: 0.000001, g: 0.001, kg: 1, t: 1000,
    oz: 0.028349523125, lb: 0.45359237, st: 6.35029318, ton: 907.18474,
  },
  volume: {
    ml: 0.001, l: 1, m3: 1000,
    tsp: 0.00492892, tbsp: 0.0147868, "fl oz": 0.0295735, cup: 0.236588,
    pt: 0.473176, qt: 0.946353, gal: 3.78541,
  },
  area: {
    m2: 1, cm2: 0.0001, km2: 1_000_000,
    ft2: 0.092903, in2: 0.00064516, yd2: 0.836127, acre: 4046.86, ha: 10_000,
  },
  speed: {
    "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, knot: 0.514444, "ft/s": 0.3048,
  },
  data: {
    b: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
  },
  time: {
    ms: 0.001, s: 1, min: 60, h: 3600, day: 86_400, week: 604_800, year: 31_557_600,
  },
};

export type UnitConversion = { value: number; from: string; to: string; family: string } | { error: string };

/** Trim a trailing .0 and keep up to six significant decimals. */
export function tidy(n: number): string {
  if (!Number.isFinite(n)) return "undefined";
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(rounded);
}

export function convertUnits(amount: number, from: string, to: string): UnitConversion {
  const a = from.trim().toLowerCase();
  const b = to.trim().toLowerCase();
  if (!Number.isFinite(amount)) return { error: "The amount must be a number." };

  // Temperature is affine, not proportional: 0°C is 32°F, not 0°F. Handling it
  // through the ratio table would silently convert wrong by a constant, which
  // is worse than refusing.
  const temp = (u: string) => (u === "c" || u === "celsius" || u === "°c" ? "c" : u === "f" || u === "fahrenheit" || u === "°f" ? "f" : u === "k" || u === "kelvin" ? "k" : null);
  const ta = temp(a);
  const tb = temp(b);
  if (ta || tb) {
    if (!ta || !tb) return { error: "Temperature converts only between c, f and k." };
    const celsius = ta === "c" ? amount : ta === "f" ? ((amount - 32) * 5) / 9 : amount - 273.15;
    const out = tb === "c" ? celsius : tb === "f" ? (celsius * 9) / 5 + 32 : celsius + 273.15;
    return { value: out, from: ta, to: tb, family: "temperature" };
  }

  for (const [family, table] of Object.entries(UNITS)) {
    if (table[a] !== undefined && table[b] !== undefined) {
      return { value: (amount * table[a]) / table[b], from: a, to: b, family };
    }
  }
  const known = Object.entries(UNITS).map(([f, t]) => `${f}: ${Object.keys(t).join(" ")}`).join("; ");
  return { error: `I do not know those units. Known units — ${known}; and temperature: c, f, k.` };
}

/* ---------------------------------- dates ---------------------------------- */

const DAY = 86_400_000;

/** Parse `YYYY-MM-DD` as that calendar day in UTC, so no timezone shifts it. */
export function parseDay(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Reject 2026-02-31, which Date happily rolls over into March.
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return d;
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type DateMath =
  | { kind: "offset"; from: string; to: string; weekday: string; days: number }
  | { kind: "between"; from: string; to: string; days: number; weeks: number; businessDays: number }
  | { kind: "weekday"; date: string; weekday: string }
  | { error: string };

/**
 * Date arithmetic, done on the calendar rather than on milliseconds.
 *
 * `add 45 days` and `add 45 months` are different operations — one is a fixed
 * span, the other lands on the same day number in a later month — and a model
 * that knows one formula tends to apply it to both.
 */
export function dateMath(a: { date: string; compare?: string; addDays?: number; addMonths?: number; addYears?: number }): DateMath {
  const start = parseDay(a.date);
  if (!start) return { error: "Give the date as YYYY-MM-DD, e.g. 2026-11-24." };
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  if (!a.compare && a.addDays === undefined && a.addMonths === undefined && a.addYears === undefined) {
    return { kind: "weekday", date: isoDay(start), weekday: weekdays[start.getUTCDay()] };
  }

  if (a.compare) {
    const end = parseDay(a.compare);
    if (!end) return { error: "The comparison date must be YYYY-MM-DD." };
    const days = Math.round((end.getTime() - start.getTime()) / DAY);
    // Business days excludes Saturday and Sunday, which is what a deadline means.
    let business = 0;
    const step = days < 0 ? -1 : 1;
    for (let d = new Date(start); isoDay(d) !== isoDay(end); ) {
      d = new Date(d.getTime() + step * DAY);
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) business += step;
    }
    return { kind: "between", from: isoDay(start), to: isoDay(end), days, weeks: Math.round((days / 7) * 100) / 100, businessDays: business };
  }

  const out = new Date(start.getTime());
  if (a.addDays) out.setUTCDate(out.getUTCDate() + Math.round(a.addDays));
  if (a.addMonths) {
    const day = out.getUTCDate();
    out.setUTCDate(1);
    out.setUTCMonth(out.getUTCMonth() + Math.round(a.addMonths));
    // Clamp to the last day of the target month: 31 January + 1 month is 28 or
    // 29 February, not 3 March.
    const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(Math.min(day, lastDay));
  }
  if (a.addYears) out.setUTCFullYear(out.getUTCFullYear() + Math.round(a.addYears));
  return {
    kind: "offset",
    from: isoDay(start),
    to: isoDay(out),
    weekday: weekdays[out.getUTCDay()],
    days: Math.round((out.getTime() - start.getTime()) / DAY),
  };
}

/* ----------------------------------- text ----------------------------------- */

export type TextStats = {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  readingMinutes: number;
  longestWord: string;
  topWords: { word: string; count: number }[];
  emails: string[];
  urls: string[];
  numbers: string[];
};

/** Measure a piece of writing, and pull the things out of it that get missed. */
export function analyseText(text: string): TextStats {
  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])];
  // A URL is one word, not six. Counting "https", "x", "dev" and "y" as words
  // inflated every piece of writing that cited a source.
  const urls = [...new Set((text.match(/https?:\/\/[^\s<>"')]+/g) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
  const prose = text.replace(/https?:\/\/[^\s<>"')]+/g, " ").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, " ");
  const words = prose.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0).length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length || (text.trim() ? 1 : 0);
  const STOP = new Set(["the", "and", "a", "an", "of", "to", "in", "is", "it", "that", "for", "on", "with", "as", "was", "at", "by", "this", "be", "are", "or", "from", "but", "not", "have", "has", "had", "you", "your", "they", "we", "i"]);
  const counts = new Map<string, number>();
  for (const word of words) {
    const key = word.toLowerCase();
    if (key.length < 3 || STOP.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const topWords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));

  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    words: words.length,
    sentences,
    paragraphs,
    // 220 words a minute is the usual figure for reading prose aloud at speed.
    readingMinutes: Math.max(0, Math.round((words.length / 220) * 10) / 10),
    longestWord: words.reduce((longest, word) => (word.length > longest.length ? word : longest), ""),
    topWords,
    emails,
    urls,
    numbers: [...new Set(text.match(/(?<![\w.])\d+(?:[.,]\d+)?(?![\w.])/g) ?? [])],
  };
}

/* ---------------------------------- tables ---------------------------------- */

export type TableSummary = {
  rows: number;
  columns: string[];
  numeric: { column: string; min: number; max: number; sum: number; mean: number }[];
  empty: number;
  duplicateRows: number;
} | { error: string };

/**
 * Parse CSV into rows.
 *
 * Quoted fields with commas and escaped quotes are the reason a simple split
 * gets a table wrong; this is a small state machine instead.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n").trim();
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function summarizeTable(csv: string, opts: { delimiter?: string } = {}): TableSummary {
  const text = opts.delimiter && opts.delimiter !== "," ? csv.split(opts.delimiter).join(",") : csv;
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "A table needs a header row and at least one data row." };
  const header = rows[0].map((h, i) => h.trim() || `column ${i + 1}`);
  const body = rows.slice(1).filter((r) => r.some((cell) => cell.trim()));
  const numeric: { column: string; min: number; max: number; sum: number; mean: number }[] = [];
  for (let c = 0; c < header.length; c++) {
    const values = body.map((r) => Number((r[c] ?? "").replace(/[$,%\s]/g, ""))).filter((n) => Number.isFinite(n));
    // A column counts as numeric when most of its values parse as numbers;
    // a single stray number in a notes column should not make it one.
    if (values.length >= Math.max(2, body.length * 0.6)) {
      const sum = values.reduce((a, b) => a + b, 0);
      numeric.push({
        column: header[c],
        min: Math.min(...values),
        max: Math.max(...values),
        sum: Math.round(sum * 100) / 100,
        mean: Math.round((sum / values.length) * 100) / 100,
      });
    }
  }
  const empty = body.reduce((n, r) => n + r.filter((c) => !c.trim()).length, 0);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of body) {
    const key = r.join("\u0001");
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return { rows: body.length, columns: header, numeric, empty, duplicateRows: duplicates };
}

/* ----------------------------------- json ---------------------------------- */

/** Read one path out of a JSON document, without shipping a query language. */
export function jsonQuery(json: string, path: string, list = false): string {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    return `That is not valid JSON: ${e instanceof Error ? e.message : "could not parse"}. Run it through check_code with kind json to find the exact position.`;
  }
  if (list) {
    if (Array.isArray(value)) {
      // A list of top-level keys is what makes an unfamiliar document usable.
      const sample = value.find((v) => v && typeof v === "object");
      return `An array of ${value.length}.${sample ? ` Each item has: ${Object.keys(sample as object).join(", ")}.` : ""}`;
    }
    if (value && typeof value === "object") {
      return `An object with: ${Object.keys(value as object).join(", ")}.`;
    }
    return `A ${typeof value}.`;
  }
  const parts = path.replace(/^\./, "").split(/\.|\[(\d+)\]/).filter(Boolean);
  let current: unknown = value;
  let walked = "";
  for (const part of parts) {
    if (current === null) return `Nothing at “${path}”: ${walked || "the document"} is null.`;
    if (/^\d+$/.test(part) && Array.isArray(current)) {
      if (Number(part) >= current.length) return `Nothing at “${path}”: index ${part} is past the end of a ${current.length}-item array.`;
      current = current[Number(part)];
      walked += `[${part}]`;
      continue;
    }
    if (typeof current !== "object" || current === undefined) {
      return `“${path}” goes through a ${typeof current}, which has no “${part}”.`;
    }
    if (!(part in (current as Record<string, unknown>))) {
      const keys = Object.keys(current as Record<string, unknown>);
      return `Nothing at “${path}”: ${walked || "the document"} has no “${part}”. It has: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", …" : ""}.`;
    }
    current = (current as Record<string, unknown>)[part];
    walked += (walked ? "." : "") + part;
  }
  return JSON.stringify(current, null, 2)?.slice(0, 12_000) ?? "null";
}

/* -------------------------------- transforms -------------------------------- */

/** The string operations that are easy to get subtly wrong by hand. */
export function transformText(
  text: string,
  op: "slug" | "snake" | "camel" | "kebab" | "title" | "upper" | "lower" | "sentence" | "trim" | "dedupe-lines" | "sort-lines" | "base64" | "unbase64" | "urlencode" | "urldecode",
): string {
  const words = () => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  switch (op) {
    case "slug":
    case "kebab":
      return words().join("-");
    case "snake":
      return words().join("_");
    case "camel":
      return words()
        .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
        .join("");
    case "title":
      return text.replace(/\b([a-z])(\w*)/gi, (_, first: string, rest: string) => first.toUpperCase() + rest.toLowerCase());
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "sentence":
      return text
        .toLowerCase()
        .replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase());
    case "trim":
      return text.trim();
    case "dedupe-lines": {
      // A trailing newline is not a line. Keeping its empty string added a
      // blank line to the output that was never in the input.
      const lines = text.replace(/\n$/, "").split("\n").map((l) => l.trimEnd());
      return [...new Set(lines)].join("\n");
    }
    case "sort-lines":
      return text
        .split("\n")
        .map((l) => l.trimEnd())
        .sort((a, b) => a.localeCompare(b))
        .join("\n");
    case "base64":
      return Buffer.from(text, "utf8").toString("base64");
    case "unbase64": {
      const clean = text.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return "That is not base64: it contains characters base64 does not use.";
      return Buffer.from(clean, "base64").toString("utf8");
    }
    case "urlencode":
      return encodeURIComponent(text);
    case "urldecode":
      try {
        return decodeURIComponent(text);
      } catch {
        return "That is not valid percent-encoding.";
      }
  }
}


/* --------------------------------- colour ---------------------------------- */

export type Rgb = { r: number; g: number; b: number };

/** Parse #rgb, #rrggbb, rgb(...) and the common colour names. */
export function parseColor(input: string): Rgb | null {
  const text = input.trim().toLowerCase();
  const named: Record<string, string> = {
    black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
    blue: "#0000ff", grey: "#808080", gray: "#808080", orange: "#ffa500",
    purple: "#800080", yellow: "#ffff00", pink: "#ffc0cb", teal: "#008080",
    navy: "#000080", maroon: "#800000", olive: "#808000", lime: "#00ff00",
    aqua: "#00ffff", cyan: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff",
    silver: "#c0c0c0", transparent: "#000000",
  };
  const hex = named[text] ?? text;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(hex);
  if (m) {
    const h = m[1];
    if (h.length === 3) {
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    }
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const rgb = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/.exec(text);
  if (rgb) return { r: Math.min(255, Number(rgb[1])), g: Math.min(255, Number(rgb[2])), b: Math.min(255, Number(rgb[3])) };
  return null;
}

/** Relative luminance, per WCAG. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast between two colours.
 *
 * This is the check a model cannot do in its head and gets confidently wrong:
 * it will call mid grey on white "fine" at 2.8:1. 4.5 is the AA body-text bar,
 * 3.0 the bar for large text and UI edges.
 */
export function contrastRatio(a: string, b: string): { ratio: number; aa: boolean; aaLarge: boolean; aaa: boolean } | { error: string } {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return { error: `Could not read ${!ca ? `“${a}”` : `“${b}”`}. Use #rrggbb, rgb(...) or a colour name.` };
  const la = luminance(ca);
  const lb = luminance(cb);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return {
    ratio: Math.round(ratio * 100) / 100,
    aa: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaa: ratio >= 7,
  };
}

/** Mix two colours, as a designer means by "70% of the way". */
export function mixColors(a: string, b: string, amount = 0.5): string | { error: string } {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return { error: "Give both colours as #rrggbb." };
  const t = Math.max(0, Math.min(1, amount));
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${hex(ca.r + (cb.r - ca.r) * t)}${hex(ca.g + (cb.g - ca.g) * t)}${hex(ca.b + (cb.b - ca.b) * t)}`;
}

/** Lighten or darken by mixing with white or black. */
export function shadeColor(color: string, amount: number): string | { error: string } {
  return amount >= 0 ? mixColors(color, "#ffffff", amount) : mixColors(color, "#000000", -amount);
}

/** A full palette from one seed colour, as a design system would derive it. */
export function paletteFrom(seed: string): { base: string; light: string; dark: string; tint: string; shade: string; complement: string } | { error: string } {
  const c = parseColor(seed);
  if (!c) return { error: `Could not read “${seed}”. Use #rrggbb.` };
  const light = mixColors(seed, "#ffffff", 0.4);
  const dark = mixColors(seed, "#000000", 0.4);
  const tint = mixColors(seed, "#ffffff", 0.85);
  const shade = mixColors(seed, "#000000", 0.7);
  // Rotate the hue 180 degrees in HSL for the complement. Inverting the RGB
  // channels gives a different, dingier colour than the one the eye reads as
  // opposite — on a warm orange, inversion lands on a muddy blue.
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const h2 = (h + 0.5) % 1;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p2 = 2 * l - q;
  const rgb = [hue2rgb(p2, q, h2 + 1 / 3), hue2rgb(p2, q, h2), hue2rgb(p2, q, h2 - 1 / 3)];
  const complement2 = `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
  return {
    base: `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`,
    light: String(light),
    dark: String(dark),
    tint: String(tint),
    shade: String(shade),
    complement: complement2,
  };
}

/* ---------------------------------- money ---------------------------------- */

/**
 * Money arithmetic that does not drift.
 *
 * 0.1 + 0.2 is 0.30000000000000004 in binary floating point, and an invoice
 * that says that is wrong. Values are handled in integer cents here.
 */
export function moneySum(values: number[]): { total: number; asCents: number } {
  const cents = values.map((v) => Math.round(v * 100));
  const total = cents.reduce((a, b) => a + b, 0);
  return { total: total / 100, asCents: total };
}

/** Apply a percentage, rounded to cents the way a till does. */
export function moneyTax(amount: number, ratePercent: number): { amount: number; tax: number; total: number } {
  const cents = Math.round(amount * 100);
  const tax = Math.round((cents * ratePercent) / 100);
  return { amount: cents / 100, tax: tax / 100, total: (cents + tax) / 100 };
}

/** Split an amount into n parts, with the remainder on the first ones. */
export function moneySplit(amount: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts));
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / n);
  const over = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < over ? 1 : 0)) / 100);
}

/* ---------------------------------- text 2 --------------------------------- */

/** Count-in-words for the numbers things are limited to. */
export function numberToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "zero";
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const chunk = (v: number): string => {
    if (v < 20) return ones[v];
    if (v < 100) return tens[Math.floor(v / 10)] + (v % 10 ? `-${ones[v % 10]}` : "");
    return `${ones[Math.floor(v / 100)]} hundred${v % 100 ? ` and ${chunk(v % 100)}` : ""}`;
  };
  const scales: [number, string][] = [[1_000_000_000, "billion"], [1_000_000, "million"], [1_000, "thousand"], [1, ""]];
  let rest = n;
  const out: string[] = [];
  for (const [size, label] of scales) {
    if (rest >= size) {
      out.push(`${chunk(Math.floor(rest / size))}${label ? ` ${label}` : ""}`);
      rest %= size;
    }
  }
  return (value < 0 ? "minus " : "") + out.join(" ");
}
