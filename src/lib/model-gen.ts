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

export type ModelKind =
  | "tree"
  | "crystal"
  | "rock"
  | "pillar"
  | "spaceship"
  | "terrain"
  | "tower"
  | "coin"
  | "vase"
  | "bowl"
  | "bottle"
  | "lamp"
  | "rocket"
  | "sword"
  | "shield"
  | "table"
  | "chair"
  | "arch"
  | "planet"
  | "mushroom"
  | "bridge"
  | "stairs"
  | "fence"
  | "crate"
  | "barrel"
  | "lantern"
  | "gem"
  | "asteroid"
  | "crown"
  | "key"
  | "signpost"
  | "campfire"
  | "well"
  | "statue"
  | "gate";

/** One primitive placed in a scene, for models no preset covers. */
export type ModelPart = {
  shape: "box" | "cylinder" | "cone" | "sphere" | "icosahedron";
  size?: [number, number, number];
  radius?: number;
  height?: number;
  at?: [number, number, number];
  rotate?: number;
  /** Palette slot 0-3. */
  color?: number;
};

export type ModelRequest = {
  kind: ModelKind;
  /** Detail level: 1 is very low poly, 5 is smooth-ish. */
  detail?: number;
  /** Overall size in world units. */
  scale?: number;
  seed?: number;
  /** For a composed model: the parts to place. When given, `kind` is ignored. */
  parts?: ModelPart[];
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

/** A box, centred on (x,y,z), with optional per-axis size. */
function box(mesh: Mesh, w: number, h: number, d: number, x = 0, y = 0, z = 0): void {
  const base = mesh.vertices.length;
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;
  const corners: Vec3[] = [
    [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd],
    [-hw, hh, -hd], [hw, hh, -hd], [hw, hh, hd], [-hw, hh, hd],
  ];
  for (const [cx, cy, cz] of corners) mesh.add([cx + x, cy + y, cz + z]);
  for (const f of [
    [1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3],
    [3, 7, 8, 4], [4, 8, 5, 1],
  ]) {
    mesh.face(...f.map((i) => base + i));
  }
}

/** A UV sphere, low-poly by construction — segments are driven by detail. */
function sphere(mesh: Mesh, radius: number, segments: number, rings: number, x = 0, y = 0, z = 0): void {
  const base = mesh.vertices.length;
  const grid: number[][] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    const row: number[] = [];
    for (let c = 0; c < segments; c++) {
      const theta = (c / segments) * Math.PI * 2;
      mesh.add([
        x + radius * Math.sin(phi) * Math.cos(theta),
        y + radius * Math.cos(phi),
        z + radius * Math.sin(phi) * Math.sin(theta),
      ]);
      row.push(base + (r * segments + c) + 1);
    }
    grid.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let c = 0; c < segments; c++) {
      const a = grid[r][c];
      const b = grid[r][(c + 1) % segments];
      const cc = grid[r + 1][(c + 1) % segments];
      const d = grid[r + 1][c];
      // The poles collapse to a point, so those rows are triangles.
      if (r === 0) mesh.face(a, cc, d);
      else if (r === rings - 1) mesh.face(a, b, cc);
      else mesh.face(a, b, cc, d);
    }
  }
}

/**
 * A surface of revolution: a profile spun around the Y axis.
 *
 * This is the workhorse the old shapes lacked — a vase, a bowl, a rocket nose,
 * a lamp and a bottle are all one profile, and adding one costs a dozen numbers
 * instead of a hundred vertices.
 */
function lathe(mesh: Mesh, profile: [number, number][], sides: number, scale = 1): void {
  const base = mesh.vertices.length;
  const rings: number[][] = [];
  for (const [radius, height] of profile) {
    const row: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      mesh.add([Math.cos(a) * radius * scale, height * scale, Math.sin(a) * radius * scale]);
      row.push(base + (rings.length * sides + i) + 1);
    }
    rings.push(row);
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < sides; i++) {
      mesh.face(rings[r][i], rings[r][(i + 1) % sides], rings[r + 1][(i + 1) % sides], rings[r + 1][i]);
    }
  }
  // Cap the ends when their radius is not zero, or the shape is hollow.
  const first = profile[0][0];
  const last = profile[profile.length - 1][0];
  if (first > 0.001) {
    const centre = mesh.add([0, profile[0][1] * scale, 0]);
    for (let i = 0; i < sides; i++) mesh.face(centre, rings[0][(i + 1) % sides], rings[0][i]);
  }
  if (last > 0.001) {
    const at = rings.length - 1;
    const centre = mesh.add([0, profile[at][1] * scale, 0]);
    for (let i = 0; i < sides; i++) mesh.face(centre, rings[at][i], rings[at][(i + 1) % sides]);
  }
}

/** A torus: the ring a well, a gate arch and a barrel hoop all need. */
function torus(mesh: Mesh, radius: number, tube: number, sides: number, segments: number, cx = 0, cy = 0, cz = 0): void {
  const base = mesh.vertices.length;
  const grid: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const u = (i / sides) * Math.PI * 2;
    const row: number[] = [];
    for (let j = 0; j < segments; j++) {
      const v = (j / segments) * Math.PI * 2;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = tube * Math.sin(v);
      const z = (radius + tube * Math.cos(v)) * Math.sin(u);
      mesh.add([x + cx, y + cy, z + cz]);
      row.push(base + (i * segments + j) + 1);
    }
    grid.push(row);
  }
  for (let i = 0; i < sides; i++) {
    for (let j = 0; j < segments; j++) {
      const a = grid[i][j];
      const b = grid[(i + 1) % sides][j];
      const c = grid[(i + 1) % sides][(j + 1) % segments];
      const d = grid[i][(j + 1) % segments];
      mesh.face(a, b, c, d);
    }
  }
}

/** A regular prism lying along the X axis — a log, a rail, a bar. */
function beam(mesh: Mesh, radius: number, length: number, sides: number, x = 0, y = 0, z = 0): void {
  const base = mesh.vertices.length;
  // Each ring records the ids it actually created. Deriving the second ring's
  // indices from an offset worked only while the two were built adjacently.
  const ring = (dx: number) => {
    const ids: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      ids.push(mesh.add([x + dx, y + Math.cos(a) * radius, z + Math.sin(a) * radius]));
    }
    return ids;
  };
  const left = ring(-length / 2);
  const right = ring(length / 2);
  for (let i = 0; i < sides; i++) {
    mesh.face(left[i], left[(i + 1) % sides], right[(i + 1) % sides], right[i]);
  }
  // Caps, so a beam is not a hollow tube.
  const lc = mesh.add([x - length / 2, y, z]);
  const rc = mesh.add([x + length / 2, y, z]);
  for (let i = 0; i < sides; i++) {
    mesh.face(lc, left[(i + 1) % sides], left[i]);
    mesh.face(rc, right[i], right[(i + 1) % sides]);
  }
}

/** Build the mesh for a request. Deterministic for a given seed. */
export function buildModel(req: ModelRequest): { mesh: Mesh; name: string } {
  const detail = Math.max(1, Math.min(5, Math.round(req.detail ?? 2)));
  const scale = Math.max(0.2, Math.min(20, req.scale ?? 1));
  const rand = rng(req.seed ?? 7);
  const sides = 4 + detail * 2;
  const mesh = new Mesh();

  // A composed model comes first: when parts are given the preset is ignored,
  // so a Bot can build something no list contains without a new shape being
  // written for it.
  if (Array.isArray(req.parts) && req.parts.length) {
    const allowed = new Set(["box", "cylinder", "cone", "sphere", "icosahedron"]);
    for (const part of req.parts.slice(0, 60)) {
      if (!allowed.has(part.shape)) continue;
      mesh.use(Math.max(0, Math.min(3, Math.round(part.color ?? 0))));
      const [x, y, z] = part.at ?? [0, 0, 0];
      const size = part.size ?? [1, 1, 1];
      switch (part.shape) {
        case "box":
          box(mesh, (size[0] ?? 1) * scale, (size[1] ?? 1) * scale, (size[2] ?? 1) * scale, x * scale, y * scale, z * scale);
          break;
        case "sphere":
          sphere(mesh, (part.radius ?? 0.5) * scale, sides, Math.max(3, Math.round(sides / 2)), x * scale, y * scale, z * scale);
          break;
        case "icosahedron":
          icosahedron(mesh, (part.radius ?? 0.5) * scale, x * scale, y * scale, z * scale);
          break;
        case "cylinder":
          cylinder(mesh, (part.radius ?? 0.5) * scale, (part.height ?? 1) * scale, sides, y * scale);
          break;
        case "cone":
          cone(mesh, (part.radius ?? 0.5) * scale, (part.height ?? 1) * scale, sides, y * scale);
          break;
      }
    }
    return { mesh, name: "composed-model" };
  }

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
    case "vase": {
      // One profile, spun: wide belly, narrow neck, flared lip.
      mesh.use(0);
      lathe(mesh, [[0.22, 0], [0.34, 0.1], [0.44, 0.36], [0.4, 0.68], [0.24, 0.92], [0.2, 1.05], [0.3, 1.18], [0.26, 1.22]], sides, scale);
      return { mesh, name: "vase" };
    }
    case "bowl": {
      mesh.use(0);
      lathe(mesh, [[0.06, 0], [0.3, 0.02], [0.46, 0.14], [0.52, 0.34], [0.5, 0.36]], sides, scale);
      return { mesh, name: "bowl" };
    }
    case "bottle": {
      mesh.use(0);
      lathe(mesh, [[0.26, 0], [0.3, 0.06], [0.3, 0.72], [0.16, 0.92], [0.14, 1.24], [0.17, 1.3], [0.14, 1.32]], sides, scale);
      mesh.use(1);
      cylinder(mesh, 0.15 * scale, 0.1 * scale, sides, 1.32 * scale);
      return { mesh, name: "bottle" };
    }
    case "lamp": {
      mesh.use(1);
      lathe(mesh, [[0.3, 0], [0.32, 0.04], [0.12, 0.1], [0.05, 0.5], [0.05, 1.0], [0.08, 1.02]], sides, scale);
      mesh.use(0);
      // The shade is an open cone, wider at the bottom than the top.
      lathe(mesh, [[0.46, 1.0], [0.28, 1.38], [0.26, 1.4]], sides, scale);
      return { mesh, name: "lamp" };
    }
    case "rocket": {
      mesh.use(1);
      lathe(mesh, [[0.2, 0], [0.24, 0.12], [0.24, 1.2], [0.16, 1.5], [0.02, 1.76]], sides, scale);
      mesh.use(0);
      // Three fins, evenly spaced, angled out from the body.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const cx = Math.cos(a);
        const cz = Math.sin(a);
        const base = mesh.vertices.length;
        mesh.add([cx * 0.2 * scale, 0.55 * scale, cz * 0.2 * scale]);
        mesh.add([cx * 0.55 * scale, 0.02 * scale, cz * 0.55 * scale]);
        mesh.add([cx * 0.2 * scale, 0, cz * 0.2 * scale]);
        mesh.face(base + 1, base + 2, base + 3);
      }
      return { mesh, name: "rocket" };
    }
    case "sword": {
      mesh.use(1);
      // The blade tapers to a point and is thin in one axis.
      const tip = 2.1 * scale;
      const b = mesh.vertices.length;
      mesh.add([-0.09 * scale, 0.3 * scale, -0.02 * scale]);
      mesh.add([0.09 * scale, 0.3 * scale, -0.02 * scale]);
      mesh.add([0.09 * scale, 0.3 * scale, 0.02 * scale]);
      mesh.add([-0.09 * scale, 0.3 * scale, 0.02 * scale]);
      const t = mesh.add([0, tip, 0]);
      mesh.face(b + 1, b + 2, t);
      mesh.face(b + 3, b + 4, t);
      mesh.face(b + 2, b + 3, t);
      mesh.face(b + 4, b + 1, t);
      mesh.face(b + 1, b + 4, b + 3, b + 2);
      mesh.use(0);
      box(mesh, 0.44 * scale, 0.07 * scale, 0.1 * scale, 0, 0.28 * scale, 0);
      cylinder(mesh, 0.05 * scale, 0.26 * scale, sides, -0.26 * scale);
      sphere(mesh, 0.075 * scale, sides, 3, 0, -0.3 * scale, 0);
      return { mesh, name: "sword" };
    }
    case "shield": {
      mesh.use(0);
      // A lathe laid flat would be a dish; a shield is a slightly domed disc,
      // so the profile is shallow and wide.
      lathe(mesh, [[0.02, 0], [0.3, 0.02], [0.5, 0.06], [0.62, 0.1], [0.62, 0.12]], sides, scale);
      mesh.use(1);
      box(mesh, 0.9 * scale, 0.05 * scale, 0.12 * scale, 0, 0.15 * scale, 0);
      box(mesh, 0.12 * scale, 0.05 * scale, 0.9 * scale, 0, 0.15 * scale, 0);
      return { mesh, name: "shield" };
    }
    case "table": {
      mesh.use(0);
      box(mesh, 1.5 * scale, 0.09 * scale, 0.9 * scale, 0, 0.72 * scale, 0);
      mesh.use(1);
      // Legs are boxes, not cylinders: a cylinder primitive grows at the
      // origin, and this one used to shift its own vertices afterwards by
      // counting backwards from the end of the array — wrong the moment another
      // primitive was added inside the loop.
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        box(mesh, 0.07 * scale, 0.72 * scale, 0.07 * scale, sx * 0.64 * scale, 0.36 * scale, sz * 0.34 * scale);
      }
      return { mesh, name: "table" };
    }
    case "chair": {
      mesh.use(0);
      box(mesh, 0.48 * scale, 0.07 * scale, 0.48 * scale, 0, 0.45 * scale, 0);
      box(mesh, 0.48 * scale, 0.55 * scale, 0.06 * scale, 0, 0.75 * scale, -0.21 * scale);
      mesh.use(1);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        box(mesh, 0.05 * scale, 0.45 * scale, 0.05 * scale, sx * 0.2 * scale, 0.22 * scale, sz * 0.2 * scale);
      }
      return { mesh, name: "chair" };
    }
    case "arch": {
      mesh.use(0);
      // Two piers and a half-torus of wedges, which reads as a real arch.
      for (const sx of [-1, 1]) box(mesh, 0.3 * scale, 1.2 * scale, 0.4 * scale, sx * 0.5 * scale, 0.6 * scale, 0);
      const wedges = Math.max(6, sides);
      for (let i = 0; i < wedges; i++) {
        const a0 = Math.PI - (i / wedges) * Math.PI;
        const a1 = Math.PI - ((i + 1) / wedges) * Math.PI;
        const inner = 0.4 * scale;
        const outer = 0.66 * scale;
        const b = mesh.vertices.length;
        const z = 0.18 * scale;
        for (const [rad, ang, zz] of [
          [inner, a0, -z], [outer, a0, -z], [outer, a1, -z], [inner, a1, -z],
          [inner, a0, z], [outer, a0, z], [outer, a1, z], [inner, a1, z],
        ] as [number, number, number][]) {
          mesh.add([Math.cos(ang) * rad, 1.2 * scale + Math.sin(ang) * rad, zz]);
        }
        for (const f of [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]]) {
          mesh.face(...f.map((n) => b + n));
        }
      }
      return { mesh, name: "arch" };
    }
    case "planet": {
      mesh.use(0);
      sphere(mesh, 0.6 * scale, Math.max(8, sides * 2), Math.max(6, sides), 0, 0, 0);
      mesh.use(1);
      // A ring, as a flat annulus: two radii, one plane.
      const seg = Math.max(12, sides * 3);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const b = mesh.vertices.length;
        for (const [rad, ang] of [[0.75, a0], [1.05, a0], [1.05, a1], [0.75, a1]] as [number, number][]) {
          mesh.add([Math.cos(ang) * rad * scale, 0, Math.sin(ang) * rad * scale]);
        }
        mesh.face(b + 1, b + 2, b + 3, b + 4);
      }
      return { mesh, name: "planet" };
    }
    case "mushroom": {
      mesh.use(1);
      cylinder(mesh, 0.11 * scale, 0.42 * scale, sides, 0);
      mesh.use(0);
      // The cap is a lathe, which gives a rounded dome rather than a cone.
      lathe(mesh, [[0.5, 0.4], [0.46, 0.48], [0.34, 0.58], [0.16, 0.64], [0.02, 0.66]], sides, scale);
      return { mesh, name: "mushroom" };
    }
    case "bridge": {
      mesh.use(0);
      // A deck, two piers and a handrail on each side — a bridge reads as a
      // bridge mostly by having a rail, not by the span.
      box(mesh, 3 * scale, 0.16 * scale, 1.1 * scale, 0, 0.72 * scale, 0);
      mesh.use(1);
      for (const sx of [-1, 1]) {
        box(mesh, 0.26 * scale, 0.72 * scale, 0.9 * scale, sx * 1.1 * scale, 0.36 * scale, 0);
        for (const sz of [-1, 1]) {
          beam(mesh, 0.035 * scale, 3 * scale, 5, 0, 1.02 * scale, sz * 0.52 * scale);
          for (let i = -2; i <= 2; i++) {
            box(mesh, 0.05 * scale, 0.26 * scale, 0.05 * scale, i * 0.7 * scale, 0.9 * scale, sz * 0.52 * scale);
          }
        }
      }
      return { mesh, name: "bridge" };
    }
    case "stairs": {
      mesh.use(0);
      const steps = Math.max(3, Math.round(3 + detail * 1.4));
      for (let i = 0; i < steps; i++) {
        // Each tread is a box; stacking them with rising y and x builds the run.
        box(mesh, 0.5 * scale, 0.16 * scale, 1.1 * scale, (i - steps / 2) * 0.45 * scale, i * 0.18 * scale, 0);
        mesh.use(1);
        box(mesh, 0.5 * scale, 0.18 * scale, 1.1 * scale, (i - steps / 2) * 0.45 * scale, Math.max(0, i * 0.18 * scale - 0.09 * scale), 0);
        mesh.use(0);
      }
      return { mesh, name: "stairs" };
    }
    case "fence": {
      mesh.use(1);
      const posts = Math.max(3, Math.round(2 + detail * 1.5));
      const span = posts * 0.42 * scale;
      for (let i = 0; i <= posts; i++) {
        box(mesh, 0.08 * scale, 0.9 * scale, 0.08 * scale, -span / 2 + i * 0.42 * scale, 0.45 * scale, 0);
      }
      mesh.use(0);
      for (const y of [0.34, 0.62]) {
        box(mesh, span, 0.07 * scale, 0.04 * scale, 0, y * scale, 0);
      }
      return { mesh, name: "fence" };
    }
    case "crate": {
      mesh.use(0);
      const w = 0.9 * scale;
      box(mesh, w, w, w, 0, w / 2, 0);
      mesh.use(1);
      // Corner battens: the detail that says "crate" rather than "cube".
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(mesh, 0.09 * scale, w * 1.01, 0.09 * scale, sx * w * 0.47, w / 2, sz * w * 0.47);
        }
      }
      for (const sy of [0.14, 0.86]) {
        box(mesh, w * 1.01, 0.08 * scale, w * 1.01, 0, w * sy, 0);
      }
      return { mesh, name: "crate" };
    }
    case "barrel": {
      mesh.use(0);
      // A lathe with a belly — a straight cylinder is a can.
      lathe(mesh, [[0.34, 0], [0.4, 0.18], [0.44, 0.45], [0.4, 0.72], [0.34, 0.9]], sides, scale);
      mesh.use(1);
      for (const y of [0.14, 0.45, 0.76]) {
        torus(mesh, 0.41 * scale, 0.028 * scale, Math.max(8, sides), Math.max(6, sides), 0, y * scale, 0);
      }
      return { mesh, name: "barrel" };
    }
    case "lantern": {
      mesh.use(1);
      // A frame of four uprights around a glowing core.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(mesh, 0.05 * scale, 0.5 * scale, 0.05 * scale, sx * 0.16 * scale, 0.25 * scale, sz * 0.16 * scale);
        }
      }
      lathe(mesh, [[0.26, 0.5], [0.3, 0.56], [0.05, 0.62]], sides, scale);
      box(mesh, 0.36 * scale, 0.05 * scale, 0.36 * scale, 0, 0.02 * scale, 0);
      torus(mesh, 0.09 * scale, 0.02 * scale, Math.max(6, sides), Math.max(6, sides), 0, 0.66 * scale, 0);
      mesh.use(2);
      icosahedron(mesh, 0.12 * scale, 0, 0.27 * scale, 0);
      return { mesh, name: "lantern" };
    }
    case "gem": {
      mesh.use(0);
      // A crown of facets over a point: the classic cut-stone silhouette.
      const belt = Math.max(6, sides);
      const top = mesh.vertices.length;
      for (let i = 0; i < belt; i++) {
        const a = (i / belt) * Math.PI * 2;
        mesh.add([Math.cos(a) * 0.4 * scale, 0.5 * scale, Math.sin(a) * 0.4 * scale]);
      }
      const tip = mesh.add([0, 1.05 * scale, 0]);
      const bottom = mesh.add([0, 0, 0]);
      for (let i = 0; i < belt; i++) {
        mesh.face(top + i + 1, top + ((i + 1) % belt) + 1, tip);
        mesh.face(top + ((i + 1) % belt) + 1, top + i + 1, bottom);
      }
      return { mesh, name: "gem" };
    }
    case "asteroid": {
      mesh.use(0);
      // An icosahedron whose vertices are pushed in and out: a lumpy rock. Two
      // levels of subdivision, because 20 flat faces at 12 vertices is a
      // dodecahedron with a bad complexion, not a rock.
      const lumpy = new Mesh();
      lumpy.use(0);
      icosahedron(lumpy, 0.7 * scale, 0, 0, 0);
      const split = (m: Mesh, times: number) => {
        for (let pass = 0; pass < times; pass++) {
          const cache = new Map<string, number>();
          const mid = (a: number, b: number) => {
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            const hit = cache.get(key);
            if (hit !== undefined) return hit;
            const va = m.vertices[a - 1];
            const vb = m.vertices[b - 1];
            const id = m.add([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
            cache.set(key, id);
            return id;
          };
          const next: number[][] = [];
          for (const [a, b, c] of m.faces) {
            const ab = mid(a, b);
            const bc = mid(b, c);
            const ca = mid(c, a);
            next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
          }
          m.faces = next;
        }
      };
      if (detail >= 2) split(lumpy, detail >= 4 ? 2 : 1);
      lumpy.vertices = lumpy.vertices.map(([x, y, z]) => {
        const k = 0.78 + rand() * 0.44;
        return [x * k, y * k, z * k] as Vec3;
      });
      const offset = mesh.vertices.length;
      for (const v of lumpy.vertices) mesh.add(v);
      for (const f of lumpy.faces) mesh.face(...f.map((i) => i + offset));
      return { mesh, name: "asteroid" };
    }
    case "crown": {
      mesh.use(0);
      torus(mesh, 0.42 * scale, 0.06 * scale, Math.max(8, sides), Math.max(8, sides), 0, 0.12 * scale, 0);
      mesh.use(2);
      const points = Math.max(5, Math.round(4 + detail));
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2;
        // Build the point at the origin, then move exactly the vertices it
        // created. Counting backwards from the end of the shared array is what
        // put the table legs in the wrong place, and it breaks the same way here.
        const from = mesh.vertices.length;
        cone(mesh, 0.09 * scale, (0.38 + (i % 2) * 0.12) * scale, 4, 0.12 * scale);
        const ox = Math.cos(a) * 0.42 * scale;
        const oz = Math.sin(a) * 0.42 * scale;
        for (let k = from; k < mesh.vertices.length; k++) {
          mesh.vertices[k] = [mesh.vertices[k][0] + ox, mesh.vertices[k][1], mesh.vertices[k][2] + oz];
        }
      }
      return { mesh, name: "crown" };
    }
    case "key": {
      mesh.use(1);
      beam(mesh, 0.045 * scale, 1.5 * scale, 6, 0, 0.4 * scale, 0);
      mesh.use(0);
      torus(mesh, 0.2 * scale, 0.05 * scale, Math.max(8, sides), Math.max(8, sides), -0.85 * scale, 0.4 * scale, 0);
      // The teeth are what make it a key rather than a rod with a ring.
      for (let i = 0; i < 3; i++) {
        box(mesh, 0.06 * scale, 0.18 * scale, 0.09 * scale, (0.3 + i * 0.18) * scale, 0.28 * scale, 0);
      }
      return { mesh, name: "key" };
    }
    case "signpost": {
      mesh.use(1);
      cylinder(mesh, 0.07 * scale, 1.5 * scale, Math.max(5, sides), 0);
      mesh.use(0);
      box(mesh, 1.05 * scale, 0.3 * scale, 0.06 * scale, 0.36 * scale, 1.16 * scale, 0);
      box(mesh, 0.8 * scale, 0.26 * scale, 0.06 * scale, -0.26 * scale, 0.82 * scale, 0);
      return { mesh, name: "signpost" };
    }
    case "campfire": {
      mesh.use(1);
      // Logs in a teepee, leaning in.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const b = mesh.vertices.length;
        const r0 = 0.42 * scale;
        const r1 = 0.1 * scale;
        mesh.add([Math.cos(a) * r0, 0, Math.sin(a) * r0]);
        mesh.add([Math.cos(a + 0.18) * r0, 0, Math.sin(a + 0.18) * r0]);
        mesh.add([Math.cos(a + 0.09) * r1, 0.62 * scale, Math.sin(a + 0.09) * r1]);
        mesh.face(b + 1, b + 2, b + 3);
        mesh.face(b + 3, b + 2, b + 1);
      }
      mesh.use(2);
      for (let i = 0; i < 3 + detail; i++) {
        cone(mesh, (0.26 - i * 0.03) * scale, (0.5 - i * 0.05) * scale, Math.max(4, sides - 2), 0.04 * scale);
      }
      return { mesh, name: "campfire" };
    }
    case "well": {
      mesh.use(1);
      lathe(mesh, [[0.52, 0], [0.52, 0.36], [0.44, 0.38]], sides, scale);
      mesh.use(0);
      // Two posts and a roof: without the roof a well is a bucket.
      for (const sx of [-1, 1]) box(mesh, 0.08 * scale, 0.8 * scale, 0.08 * scale, sx * 0.42 * scale, 0.76 * scale, 0);
      beam(mesh, 0.05 * scale, 0.9 * scale, 6, 0, 1.12 * scale, 0);
      for (const sz of [-1, 1]) {
        const b = mesh.vertices.length;
        mesh.add([-0.62 * scale, 1.16 * scale, sz * 0.1 * scale]);
        mesh.add([0.62 * scale, 1.16 * scale, sz * 0.1 * scale]);
        mesh.add([0, 1.5 * scale, sz * 0.1 * scale]);
        mesh.face(b + 1, b + 2, b + 3);
      }
      return { mesh, name: "well" };
    }
    case "statue": {
      mesh.use(1);
      box(mesh, 0.7 * scale, 0.16 * scale, 0.7 * scale, 0, 0.08 * scale, 0);
      mesh.use(0);
      lathe(mesh, [[0.16, 0.16], [0.2, 0.5], [0.13, 0.62], [0.19, 0.66], [0.2, 0.78]], sides, scale);
      sphere(mesh, 0.13 * scale, Math.max(6, sides), Math.max(4, Math.round(sides / 2)), 0, 0.94 * scale, 0);
      return { mesh, name: "statue" };
    }
    case "gate": {
      mesh.use(1);
      for (const sx of [-1, 1]) box(mesh, 0.16 * scale, 1.5 * scale, 0.22 * scale, sx * 0.62 * scale, 0.75 * scale, 0);
      mesh.use(0);
      // An arch of wedges, using the same half-torus as the arch preset.
      const wedges = Math.max(7, sides);
      for (let i = 0; i < wedges; i++) {
        const a0 = Math.PI - (i / wedges) * Math.PI;
        const a1 = Math.PI - ((i + 1) / wedges) * Math.PI;
        const inner = 0.5 * scale;
        const outer = 0.72 * scale;
        const b = mesh.vertices.length;
        const z = 0.1 * scale;
        for (const [rad, ang, zz] of [
          [inner, a0, -z], [outer, a0, -z], [outer, a1, -z], [inner, a1, -z],
          [inner, a0, z], [outer, a0, z], [outer, a1, z], [inner, a1, z],
        ] as [number, number, number][]) {
          mesh.add([Math.cos(ang) * rad, 1.5 * scale + Math.sin(ang) * rad, zz]);
        }
        for (const f of [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1]]) {
          mesh.face(...f.map((n) => b + n));
        }
      }
      return { mesh, name: "gate" };
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
