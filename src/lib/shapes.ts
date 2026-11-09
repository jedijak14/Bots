// Bot body shapes. Every shape is generated as a closed polygon with the same
// number of points (arc-length resampled, starting at the top, clockwise) so any
// two shapes can be morphed into each other by simple interpolation.

export type ShapeId =
  | "circle"
  | "cloud"
  | "square"
  | "sparkle"
  | "clover"
  | "heart"
  | "flower"
  | "drop"
  | "pill"
  | "triangle"
  | "house"
  | "starburst"
  | "hexagon";

export type Pt = [number, number];

export const SHAPE_ROWS: ShapeId[][] = [
  ["circle", "cloud", "square", "sparkle", "clover"],
  ["heart", "flower", "drop", "pill", "triangle"],
  ["house", "starburst", "hexagon"],
];
export const SHAPE_IDS: ShapeId[] = SHAPE_ROWS.flat();

export const SHAPE_LABELS: Record<ShapeId, string> = {
  circle: "Round",
  cloud: "Cloud",
  square: "Block",
  sparkle: "Sparkle",
  clover: "Clover",
  heart: "Heart",
  flower: "Flower",
  drop: "Drop",
  pill: "Pill",
  triangle: "Triangle",
  house: "House",
  starburst: "Starburst",
  hexagon: "Hexagon",
};

export type ColorId =
  | "white"
  | "brown"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink"
  | "gray";

export const COLOR_ROWS: ColorId[][] = [
  ["white", "brown", "red", "orange", "amber", "green"],
  ["teal", "blue", "purple", "pink", "gray"],
];

export const COLORS: Record<ColorId, { name: string; hex: string }> = {
  white: { name: "White", hex: "#ffffff" },
  brown: { name: "Brown", hex: "#a8703a" },
  red: { name: "Red", hex: "#f0183f" },
  orange: { name: "Orange", hex: "#f2690d" },
  amber: { name: "Amber", hex: "#f6a30c" },
  green: { name: "Green", hex: "#3acd66" },
  teal: { name: "Teal", hex: "#37c6a1" },
  blue: { name: "Blue", hex: "#2b8af7" },
  purple: { name: "Purple", hex: "#9b4dfb" },
  pink: { name: "Pink", hex: "#f0238e" },
  gray: { name: "Gray", hex: "#808080" },
};

export function isShape(v: string): v is ShapeId {
  return (SHAPE_IDS as string[]).includes(v);
}
export function isColor(v: string): v is ColorId {
  return v in COLORS;
}

const N = 150;

function resample(poly: Pt[], n: number): Pt[] {
  const m = poly.length;
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % m];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    lens.push(l);
    total += l;
  }
  const out: Pt[] = [];
  let seg = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (acc + lens[seg] < target && seg < m - 1) {
      acc += lens[seg];
      seg++;
    }
    const t = lens[seg] === 0 ? 0 : (target - acc) / lens[seg];
    const a = poly[seg];
    const b = poly[(seg + 1) % m];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function soften(pts: Pt[], radius: number, passes: number): Pt[] {
  let cur = pts;
  const n = pts.length;
  for (let p = 0; p < passes; p++) {
    cur = cur.map((_, i) => {
      let x = 0;
      let y = 0;
      for (let k = -radius; k <= radius; k++) {
        const q = cur[(i + k + n) % n];
        x += q[0];
        y += q[1];
      }
      const c = radius * 2 + 1;
      return [x / c, y / c] as Pt;
    });
  }
  return cur;
}

function roundedPolygon(verts: Pt[], r: number): Pt[] {
  const out: Pt[] = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const v = verts[i];
    const p = verts[(i - 1 + n) % n];
    const nx = verts[(i + 1) % n];
    const l1 = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const l2 = Math.hypot(nx[0] - v[0], nx[1] - v[1]);
    const d = Math.min(r, l1 / 2, l2 / 2);
    const a: Pt = [v[0] + ((p[0] - v[0]) / l1) * d, v[1] + ((p[1] - v[1]) / l1) * d];
    const b: Pt = [v[0] + ((nx[0] - v[0]) / l2) * d, v[1] + ((nx[1] - v[1]) / l2) * d];
    for (let s = 0; s <= 10; s++) {
      const t = s / 10;
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * v[0] + t * t * b[0], u * u * a[1] + 2 * u * t * v[1] + t * t * b[1]]);
    }
  }
  return out;
}

function polar(fn: (th: number) => number, samples = 720): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * Math.PI * 2 - Math.PI / 2;
    const r = fn(th);
    out.push([50 + Math.cos(th) * r, 50 + Math.sin(th) * r]);
  }
  return out;
}

function unionOfCircles(circles: [number, number, number][], origin: Pt): Pt[] {
  const out: Pt[] = [];
  const S = 720;
  for (let i = 0; i < S; i++) {
    const th = (i / S) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    let best = 0;
    for (const [cx, cy, R] of circles) {
      const ox = origin[0] - cx;
      const oy = origin[1] - cy;
      const b = dx * ox + dy * oy;
      const c = ox * ox + oy * oy - R * R;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b + Math.sqrt(disc);
      if (t > best) best = t;
    }
    out.push([origin[0] + dx * best, origin[1] + dy * best]);
  }
  return out;
}

function star(points: number, outer: number, inner: number): Pt[] {
  const v: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    v.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  return v;
}

const RAW: Record<ShapeId, () => { pts: Pt[]; eyeY: number; eyeGap?: number }> = {
  circle: () => ({ pts: polar(() => 40), eyeY: 0.52 }),
  cloud: () => ({
    pts: unionOfCircles(
      [
        [50, 58, 25],
        [27, 62, 16],
        [73, 62, 16],
        [37, 43, 19],
        [63, 45, 18],
        [34, 70, 14],
        [66, 70, 14],
      ],
      [50, 58],
    ),
    eyeY: 0.56,
  }),
  square: () => ({
    pts: roundedPolygon(
      [
        [14, 14],
        [86, 14],
        [86, 86],
        [14, 86],
      ],
      16,
    ),
    eyeY: 0.52,
  }),
  sparkle: () => ({
    pts: polar((th) => 21 + 22 * Math.pow((1 + Math.cos(4 * th + Math.PI)) / 2, 2.2)),
    eyeY: 0.5,
    eyeGap: 13,
  }),
  clover: () => ({
    pts: polar((th) => 30 + 11 * Math.abs(Math.cos(2 * (th - Math.PI / 4)))),
    eyeY: 0.5,
  }),
  heart: () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push([50 + x * 2.5, 50 + y * 2.5]);
    }
    return { pts, eyeY: 0.46 };
  },
  flower: () => ({
    pts: polar((th) => 31 + 9 * Math.abs(Math.cos(3 * (th + Math.PI / 2)))),
    eyeY: 0.5,
  }),
  drop: () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * Math.PI * 2;
      const x = Math.sin(t) * Math.sin(t / 2);
      const y = -Math.cos(t);
      pts.push([50 + x * 40, 50 + y * 42]);
    }
    return { pts, eyeY: 0.6 };
  },
  pill: () => ({
    pts: roundedPolygon(
      [
        [10, 28],
        [90, 28],
        [90, 72],
        [10, 72],
      ],
      22,
    ),
    eyeY: 0.5,
    eyeGap: 17,
  }),
  triangle: () => ({
    pts: roundedPolygon(
      [
        [50, 12],
        [90, 82],
        [10, 82],
      ],
      11,
    ),
    eyeY: 0.66,
  }),
  house: () => ({
    pts: roundedPolygon(
      [
        [50, 10],
        [88, 38],
        [88, 88],
        [12, 88],
        [12, 38],
      ],
      12,
    ),
    eyeY: 0.6,
  }),
  starburst: () => ({ pts: roundedPolygon(star(10, 44, 35), 4), eyeY: 0.5 }),
  hexagon: () => ({
    pts: roundedPolygon(
      Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3 - Math.PI / 2;
        return [50 + Math.cos(a) * 43, 50 + Math.sin(a) * 43] as Pt;
      }),
      10,
    ),
    eyeY: 0.5,
  }),
};

export type ShapeGeom = {
  pts: Pt[];
  eye: { cx: number; cy: number; gap: number };
};

const cache = new Map<ShapeId, ShapeGeom>();

export function getShape(id: ShapeId): ShapeGeom {
  const hit = cache.get(id);
  if (hit) return hit;
  const raw = RAW[id]();
  let pts = resample(raw.pts, N);
  pts = soften(pts, 2, 2);

  // normalise into an 84-unit box, centred
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const s = 84 / Math.max(w, h);
  const ox = 50 - ((minX + maxX) / 2) * s;
  const oy = 50 - ((minY + maxY) / 2) * s;
  pts = pts.map(([x, y]) => [x * s + ox, y * s + oy] as Pt);

  // orientation: clockwise on screen (positive shoelace with y down)
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) pts = pts.slice().reverse();

  // start at the top
  let start = 0;
  let best = Infinity;
  pts.forEach(([x, y], i) => {
    const score = y + Math.abs(x - 50) * 0.05;
    if (score < best) {
      best = score;
      start = i;
    }
  });
  pts = [...pts.slice(start), ...pts.slice(0, start)];

  const bh = h * s;
  const geom: ShapeGeom = {
    pts,
    eye: {
      cx: 50,
      cy: 50 - bh / 2 + bh * raw.eyeY,
      gap: raw.eyeGap ?? 15,
    },
  };
  cache.set(id, geom);
  return geom;
}

export function pointsToPath(pts: Pt[]): string {
  const n = pts.length;
  const f = (v: number) => Math.round(v * 100) / 100;
  const mid = (i: number) => {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    return `${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`;
  };
  let d = `M${mid(n - 1)}`;
  for (let i = 0; i < n; i++) {
    d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${mid(i)}`;
  }
  return d + "Z";
}
