import "server-only";

/**
 * Small 3D models, generated as real meshes.
 *
 * A Bot with no image or 3D service still needs to be able to produce a model,
 * so this writes actual geometry: a Wavefront OBJ the user can open anywhere,
 * plus a self-contained HTML viewer so it can be seen without any tooling.
 *
 * The shapes are parametric on purpose. "A low-poly tree" is a trunk plus a
 * number of cones; the parameters are what make it look like one thing rather
 * than another, and they are the part a model is good at choosing.
 */

export type ModelKind = "tree" | "crystal" | "rock" | "pillar" | "spaceship" | "terrain" | "tower" | "coin";

export type ModelRequest = {
  kind: ModelKind;
  /** Detail level: 1 is very low poly, 5 is smooth-ish. */
  detail?: number;
  /** Overall size in world units. */
  scale?: number;
  seed?: number;
};

type Vec3 = [number, number, number];

class Mesh {
  vertices: Vec3[] = [];
  faces: number[][] = [];
  /**
   * Which palette slot each face belongs to. Without this the viewer has to
   * guess, and guessing by face index painted the trunk and the crown in
   * alternating stripes.
   */
  groups: number[] = [];
  /** The palette slot new faces are tagged with. */
  private current = 0;

  use(group: number): void {
    this.current = group;
  }

  add(v: Vec3): number {
    this.vertices.push(v);
    return this.vertices.length; // 1-based, as OBJ expects
  }

  /** Add a run of vertices and return the 1-based index of the first. */
  addMany(points: Vec3[]): number {
    const first = this.vertices.length + 1;
    for (const p of points) this.vertices.push(p);
    return first;
  }

  face(...indices: number[]): void {
    this.faces.push(indices);
    this.groups.push(this.current);
  }

  /** Fan-triangulate a convex polygon ring. */
  ring(points: Vec3[], capDown?: Vec3 | null, capUp?: Vec3 | null): void {
    const base = this.vertices.length;
    for (const p of points) this.add(p);
    const n = points.length;
    if (capDown) {
      const c = this.add(capDown);
      for (let i = 0; i < n; i++) this.face(c, base + ((i + 1) % n) + 1, base + i + 1);
    }
    if (capUp) {
      const c = this.add(capUp);
      for (let i = 0; i < n; i++) this.face(c, base + i + 1, base + ((i + 1) % n) + 1);
    }
  }

  toObj(name: string): string {
    const lines = [`# ${name}`, `o ${name}`];
    for (const v of this.vertices) lines.push(`v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`);
    for (const f of this.faces) lines.push(`f ${f.join(" ")}`);
    // Groups are a comment so the OBJ stays valid for any editor, while the
    // viewer can still colour each part.
    lines.push(`# groups: ${this.groups.join(",")}`);
    return `${lines.join("\n")}\n`;
  }

  stats() {
    return { vertices: this.vertices.length, faces: this.faces.length };
  }
}

/** A small deterministic PRNG so the same seed gives the same model. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function cylinder(mesh: Mesh, radius: number, height: number, sides: number, y0 = 0): void {
  // Vertices are appended to a shared mesh, so every index below must be
  // relative to where this cylinder starts. Using absolute indices made each
  // cylinder after the first connect to the previous one's vertices, which is
  // why the trunk was painted with the foliage's group.
  const base = mesh.vertices.length;
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, y0, Math.sin(a) * radius]);
  }
  mesh.ring(ring, [0, y0, 0], null);
  const top: Vec3[] = ring.map(([x, , z]) => [x * 0.7, y0 + height, z * 0.7]);
  mesh.ring(top, null, [0, y0 + height, 0]);
  // side quads
  const n = ring.length;
  const startLow = base + 1;
  const startHigh = base + 1 + n + 1;
  for (let i = 0; i < n; i++) {
    const a = startLow + i;
    const b = startLow + ((i + 1) % n);
    const c = startHigh + ((i + 1) % n);
    const d = startHigh + i;
    mesh.face(a, b, c, d);
  }
}

function cone(mesh: Mesh, radius: number, height: number, sides: number, y0 = 0): void {
  const base = mesh.vertices.length;
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, y0, Math.sin(a) * radius]);
  }
  mesh.ring(ring, [0, y0, 0], null);
  const apex = mesh.add([0, y0 + height, 0]);
  for (let i = 0; i < sides; i++) {
    mesh.face(base + 1 + i, base + 1 + ((i + 1) % sides), apex);
  }
}

function icosahedron(mesh: Mesh, radius: number, x = 0, y = 0, z = 0): void {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const base = mesh.vertices.length;
  for (const [vx, vy, vz] of raw) {
    const len = Math.hypot(vx, vy, vz);
    mesh.add([(vx / len) * radius + x, (vy / len) * radius + y, (vz / len) * radius + z]);
  }
  const faces = [
    [1, 12, 6], [1, 6, 2], [1, 2, 8], [1, 8, 11], [1, 11, 12],
    [2, 6, 10], [6, 12, 5], [12, 11, 3], [11, 8, 7], [8, 2, 9],
    [4, 10, 5], [4, 5, 3], [4, 3, 7], [4, 7, 9], [4, 9, 10],
    [5, 10, 6], [3, 5, 12], [7, 3, 11], [9, 7, 8], [10, 9, 2],
  ];
  for (const f of faces) mesh.face(...f.map((i) => base + i));
}

/** Build the mesh for a request. Deterministic for a given seed. */
export function buildModel(req: ModelRequest): { mesh: Mesh; name: string } {
  const detail = Math.max(1, Math.min(5, Math.round(req.detail ?? 2)));
  const scale = Math.max(0.2, Math.min(20, req.scale ?? 1));
  const rand = rng(req.seed ?? 7);
  const sides = 4 + detail * 2;
  const mesh = new Mesh();

  switch (req.kind) {
    case "tree": {
      const trunkH = 1.35 * scale;
      mesh.use(1); // trunk has its own tone
      cylinder(mesh, 0.15 * scale, trunkH, sides);
      mesh.use(0); // foliage
      // Cones overlap and taper, which is what reads as foliage. Spacing them
      // out evenly produced a stack of separate discs — a circus tent.
      const tiers = Math.round(2 + detail * 0.75);
      const crownBase = trunkH * 0.8;
      for (let i = 0; i < tiers; i++) {
        const t = i / Math.max(1, tiers - 1);
        const radius = (0.95 - t * 0.5) * scale;
        // A skirt, not a spear: the cone is only just taller than its spacing,
        // so consecutive tiers overlap and the silhouette stays a tree.
        const height = (0.85 - t * 0.3) * scale;
        cone(mesh, radius, height, sides, crownBase + i * 0.36 * scale);
      }
      // A single short cone finishes the top instead of leaving a bare spike.
      cone(mesh, 0.42 * scale, 0.34 * scale, sides, crownBase + (tiers - 1) * 0.36 * scale + 0.16 * scale);
      return { mesh, name: "low-poly-tree" };
    }
    case "crystal": {
      // Shards leaning out of a base rock, so the cluster sits on something
      // instead of floating as separate spikes.
      mesh.use(1);
      icosahedron(mesh, 0.52 * scale, 0, -0.16 * scale, 0);
      mesh.use(0);
      for (let i = 0; i < 3 + detail; i++) {
        const h = (0.8 + rand() * 1.4) * scale;
        const r = (0.18 + rand() * 0.16) * scale;
        const x = (rand() - 0.5) * 0.9 * scale;
        const z = (rand() - 0.5) * 0.9 * scale;
        const ring: Vec3[] = [];
        for (let k = 0; k < sides; k++) {
          const a = (k / sides) * Math.PI * 2;
          ring.push([Math.cos(a) * r + x, 0, Math.sin(a) * r + z]);
        }
        mesh.ring(ring, [x, 0, z], null);
        const apex = mesh.add([x, h, z]);
        for (let k = 0; k < sides; k++) mesh.face(mesh.vertices.length - sides + k, mesh.vertices.length - sides + ((k + 1) % sides), apex);
      }
      return { mesh, name: "crystal-cluster" };
    }
    case "rock": {
      for (let i = 0; i < 2 + detail; i++) {
        icosahedron(mesh, (0.35 + rand() * 0.5) * scale, (rand() - 0.5) * scale, (rand() - 0.5) * 0.3 * scale, (rand() - 0.5) * scale);
      }
      return { mesh, name: "rock-cluster" };
    }
    case "pillar": {
      mesh.use(0);
      cylinder(mesh, 0.45 * scale, 3 * scale, sides);
      mesh.use(1);
      cylinder(mesh, 0.62 * scale, 0.22 * scale, sides, 3 * scale);
      cylinder(mesh, 0.62 * scale, 0.22 * scale, sides, -0.22 * scale);
      return { mesh, name: "pillar" };
    }
    case "tower": {
      const tiers = 2 + detail;
      for (let i = 0; i < tiers; i++) {
        const r = (0.9 - i * 0.12) * scale;
        cylinder(mesh, r, 0.75 * scale, sides, i * 0.85 * scale);
      }
      cone(mesh, (0.9 - tiers * 0.12 + 0.2) * scale, 1.1 * scale, sides, tiers * 0.85 * scale);
      return { mesh, name: "tower" };
    }
    case "coin": {
      // Stood on edge and turned to face the camera: a disc lying flat is seen
      // edge-on from the default view and reads as a smear.
      mesh.use(2);
      const r = 0.62 * scale;
      const t = 0.09 * scale;
      const n = sides * 2;
      const front = mesh.addMany(
        Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2;
          return [Math.cos(a) * r, Math.sin(a) * r, t] as Vec3;
        }),
      );
      const back = mesh.addMany(
        Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2;
          return [Math.cos(a) * r, Math.sin(a) * r, -t] as Vec3;
        }),
      );
      const faceMid = mesh.add([0, 0, t]);
      const backMid = mesh.add([0, 0, -t]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        mesh.face(front + i, front + j, faceMid); // the face of the coin
        mesh.face(back + j, back + i, backMid); // the other side
        mesh.face(front + j, front + i, back + i, back + j); // the milled edge
      }
      return { mesh, name: "coin" };
    }
    case "spaceship": {
      // A fuselage with real height, swept wings and an engine. The first
      // attempt was a flat diamond, which read as a plate from every angle
      // because its thickness was a tenth of its span.
      const k = scale;
      mesh.use(0);
      // Fuselage: a hexagonal cross-section tapering to a nose and a tail.
      const sec = [
        { z: 1.55, r: 0.06, y: 0.02 },
        { z: 0.85, r: 0.30, y: 0.04 },
        { z: -0.55, r: 0.34, y: 0.0 },
        { z: -1.30, r: 0.22, y: -0.02 },
      ];
      const rings = sec.map(({ z, r, y }) => {
        const ring: Vec3[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          ring.push([Math.cos(a) * r * k, y * k + Math.sin(a) * r * k * 0.8, z * k]);
        }
        return ring;
      });
      const base: number[] = rings.map((ring) => mesh.addMany(ring));
      // Stitch consecutive rings, then cap the nose and the tail.
      for (let r = 0; r < rings.length - 1; r++) {
        for (let i = 0; i < 6; i++) {
          const a = base[r] + i;
          const b = base[r] + ((i + 1) % 6);
          const c = base[r + 1] + ((i + 1) % 6);
          const d = base[r + 1] + i;
          mesh.face(a, b, c, d);
        }
      }
      const noseTip = mesh.add([0, 0.02 * k, 1.85 * k]);
      const tailCap = mesh.add([0, -0.02 * k, -1.42 * k]);
      for (let i = 0; i < 6; i++) {
        mesh.face(base[0] + i, base[0] + ((i + 1) % 6), noseTip);
        mesh.face(base[3] + ((i + 1) % 6), base[3] + i, tailCap);
      }
      // Wings: swept back, thin, one per side.
      for (const dir of [-1, 1] as const) {
        const root0 = mesh.add([dir * 0.30 * k, 0.02 * k, 0.35 * k]);
        const root1 = mesh.add([dir * 0.32 * k, 0.0 * k, -0.75 * k]);
        const tip0 = mesh.add([dir * 1.35 * k, 0.10 * k, -0.85 * k]);
        const tip1 = mesh.add([dir * 1.30 * k, 0.08 * k, -1.20 * k]);
        mesh.face(root0, root1, tip1, tip0);
        mesh.face(root0, tip0, tip1, root1);
      }
      // Canopy sits on top of the fuselage.
      mesh.use(2);
      const cap = 0.20 * k;
      const c0 = mesh.add([-0.14 * k, 0.26 * k, 0.75 * k]);
      const c1 = mesh.add([0.14 * k, 0.26 * k, 0.75 * k]);
      const c2 = mesh.add([0.10 * k, 0.26 * k, 0.05 * k]);
      const c3 = mesh.add([-0.10 * k, 0.26 * k, 0.05 * k]);
      const top = mesh.add([0, 0.26 * k + cap, 0.42 * k]);
      mesh.face(c0, c1, top);
      mesh.face(c1, c2, top);
      mesh.face(c2, c3, top);
      mesh.face(c3, c0, top);
      // Engine bell at the back. It runs along Z like the hull — a cone built
      // along Y was hanging in space below the ship.
      mesh.use(1);
      const bellA = mesh.addMany(
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return [Math.cos(a) * 0.20 * k, Math.sin(a) * 0.16 * k - 0.02 * k, -1.42 * k] as Vec3;
        }),
      );
      const bellB = mesh.addMany(
        Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return [Math.cos(a) * 0.30 * k, Math.sin(a) * 0.24 * k - 0.02 * k, -1.86 * k] as Vec3;
        }),
      );
      for (let i = 0; i < 8; i++) {
        mesh.face(bellA + i, bellA + ((i + 1) % 8), bellB + ((i + 1) % 8), bellB + i);
      }
      return { mesh, name: "spaceship" };
    }
    case "terrain": {
      // A heightfield: a grid where the height is smoothed noise.
      const n = 6 + detail * 3;
      const width = 4 * scale;
      const step = width / n;
      // Independent random heights per vertex give a field of needles, not a
      // landscape. Start random, then average each height with its neighbours a
      // few times: that is what turns noise into hills and valleys.
      let field: number[] = [];
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const edge = i === 0 || j === 0 || i === n || j === n;
          field.push(edge ? 0 : (rand() - 0.15) * 1.3 * scale);
        }
      }
      for (let pass = 0; pass < Math.max(2, Math.round(detail * 1.5)); pass++) {
        const next = field.slice();
        for (let i = 1; i < n; i++) {
          for (let j = 1; j < n; j++) {
            const at = (x: number, y: number) => field[x * (n + 1) + y];
            const around =
              (at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1)) / 4;
            next[i * (n + 1) + j] = at(i, j) * 0.45 + around * 0.55;
          }
        }
        field = next;
      }
      const heights = field;
      const idx = (i: number, j: number) => i * (n + 1) + j + 1;
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          mesh.add([-width / 2 + i * step, heights[idx(i, j) - 1], -width / 2 + j * step]);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const a = idx(i, j);
          const b = idx(i + 1, j);
          const c = idx(i + 1, j + 1);
          const d = idx(i, j + 1);
          mesh.face(a, b, c);
          mesh.face(a, c, d);
        }
      }
      return { mesh, name: "terrain" };
    }
  }
}

/**
 * A viewer that needs nothing: no three.js, no CDN, no build step.
 *
 * It projects the mesh with a small perspective transform and draws the faces
 * sorted back to front. That is enough to see a low-poly model, and it keeps
 * the artifact self-contained, which is the rule for everything the Bot writes.
 */
export function viewerHtml(
  name: string,
  obj: string,
  /**
   * Slot 0 is the main body (foliage, hull, stone), slot 1 the structure that
   * holds it up (trunk, stem, engine), slot 2 an accent. Passing the wrong
   * order paints a tree with a green trunk, so this is documented, not guessed.
   */
  palette: string[] = ["#3f9d5a", "#8a5a33", "#f6d365"],
): string {
  const colors = JSON.stringify(palette);
  const safeObj = obj.replace(/</g, "\\u003c");
  const faceCount = (obj.match(/^f /gm) ?? []).length;
  const vertCount = (obj.match(/^v /gm) ?? []).length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<meta name="mesh-stats" content="${vertCount} vertices, ${faceCount} faces">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0e0e11; overflow: hidden; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
  canvas:active { cursor: grabbing; }
  .hud { position: fixed; left: 14px; bottom: 12px; color: #8a8a92; pointer-events: none; }
  .hud b { color: #e6e6ea; font-weight: 600; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div class="hud"><b>${name}</b> · drag to orbit, scroll to zoom</div>
<script>
const OBJ = ${JSON.stringify(safeObj)};
const PALETTE = ${colors};
// --- parse the mesh ---
const verts = [], faces = [];
const groups = [];
for (const line of OBJ.split("\\n")) {
  if (line.startsWith("v ")) { const p = line.split(/\\s+/); verts.push([+p[1], +p[2], +p[3]]); }
  else if (line.startsWith("f ")) {
    faces.push(line.split(/\\s+/).slice(1).map((tok) => parseInt(tok, 10) - 1));
  } else if (line.startsWith("# groups:")) {
    for (const g of line.slice(9).trim().split(",")) if (g) groups.push(Number(g));
  }
}
// --- camera ---
let yaw = 0.6, pitch = 0.35, zoom = 1;
const canvas = document.getElementById("c"), ctx = canvas.getContext("2d");
function resize() { const d = devicePixelRatio || 1; canvas.width = innerWidth * d; canvas.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener("resize", resize); resize();
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  yaw += (e.clientX - lastX) * 0.01; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - lastY) * 0.01));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(0.3, Math.min(4, zoom * (1 - e.deltaY * 0.001))); }, { passive: false });

// Centre and scale the model once.
let cx = 0, cy = 0, cz = 0;
for (const v of verts) { cx += v[0]; cy += v[1]; cz += v[2]; }
if (verts.length) { cx /= verts.length; cy /= verts.length; cz /= verts.length; }
let extent = 0.001;
for (const v of verts) extent = Math.max(extent, Math.hypot(v[0] - cx, v[1] - cy, v[2] - cz));

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * amount);
  const g = Math.round(((n >> 8) & 255) * amount);
  const b = Math.round((n & 255) * amount);
  return "rgb(" + r + "," + g + "," + b + ")";
}

function frame() {
  const w = innerWidth, h = innerHeight - 34;
  ctx.clearRect(0, 0, w, h);
  const cy2 = Math.cos(pitch), sy2 = Math.sin(pitch), cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const project = (v) => {
    let x = v[0] - cx, y = v[1] - cy, z = v[2] - cz;
    // yaw about Y
    let nx = x * cyw - z * syw, nz = x * syw + z * cyw;
    // pitch about X
    let ny = y * cy2 - nz * sy2; nz = y * sy2 + nz * cy2;
    x = nx; y = ny;
    // Distance is expressed in model extents so any model frames the same way.
    const dist = 3.4 * extent / zoom;
    const p = dist / (dist + nz);
    return [x * p, -y * p, nz];
  };
  // Fit to what the model actually covers on screen. Sizing from a bounding
  // sphere over-fills wide, flat models like terrain and leaves tall thin ones
  // small, so the scale comes from the projected box instead.
  const raw = verts.map(project);
  let maxX = 0.001, maxY = 0.001;
  for (const [x, y] of raw) { maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y)); }
  const s = Math.min((w * 0.42) / maxX, (h * 0.42) / maxY);
  const projected = raw.map(([x, y, z]) => [w / 2 + x * s, h / 2 + y * s, z]);
  // Light from the upper left, fixed in view space: enough to read the form.
  const LIGHT = [-0.55, 0.7, 0.45];
  const drawn = faces.map((f, i) => {
    const zs = f.map((vi) => projected[vi]?.[2] ?? 0);
    return { f, i, z: zs.reduce((a, b) => a + b, 0) / Math.max(1, zs.length) };
  }).sort((a, b) => a.z - b.z);
  for (const { f, i } of drawn) {
    const pts = f.map((vi) => projected[vi]).filter(Boolean);
    if (pts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath();
    // Shade each face by its own normal so the form reads, then tint by part.
    const v0 = verts[f[0]], v1 = verts[f[1]], v2 = verts[f[2]];
    let nx = 0, ny = 0, nz = 0;
    if (v0 && v1 && v2) {
      const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
      const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
      nx = ay*bz - az*by; ny = az*bx - ax*bz; nz = ax*by - ay*bx;
      const len = Math.hypot(nx, ny, nz) || 1; nx/=len; ny/=len; nz/=len;
    }
    const lambert = Math.max(0.25, Math.min(1, 0.55 + 0.6 * (nx*LIGHT[0] + ny*LIGHT[1] - nz*LIGHT[2])));
    const pal = PALETTE[(groups[i] ?? 0) % PALETTE.length];
    ctx.fillStyle = shade(pal, lambert);
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
</body>
</html>`;
}
