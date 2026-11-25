"""The Kinetix scene language.

A model writes a small JSON spec; this turns it into a real Blender scene with
geometry built through Blender's own mesh API, materials, lighting and a camera,
then hands it to Cycles.

Why a description instead of letting the model write Python straight into
Blender: a language model writing arbitrary bpy has far more ways to produce an
empty render than a scene that cannot express "nothing". Everything here is
deterministic — the same spec gives the same picture — so a render is
reproducible and a bug is repeatable.

Units are metres, and geometry is built in Blender's own Z-up so that "stand it
on the floor" means z = 0 everywhere, in every builder. A model that needs a
different up axis can say so in the spec (`"up": "y"`), and one rotation is
applied at the end rather than every builder guessing independently.
"""
from __future__ import annotations

import math
import random
from typing import Any

import bmesh
import bpy
from mathutils import Vector


# --------------------------------------------------------------------------- #
# Scene lifecycle
# --------------------------------------------------------------------------- #

def reset() -> None:
    """Empty the file so a run cannot inherit the previous run's scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_object(name: str, verts, faces) -> "bpy.types.Object":
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([Vector(v) for v in verts], [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def shade_flat(obj: "bpy.types.Object") -> None:
    """Low-poly look: flat faces, no smoothing."""
    for poly in obj.data.polygons:
        poly.use_smooth = False


def bevel(obj: "bpy.types.Object", width: float = 0.012, segments: int = 1) -> None:
    """A hair of bevel catches the light on edges and is what stops a render
    looking like cardboard. Optional: it costs geometry."""
    modifier = obj.modifiers.new("bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments


# --------------------------------------------------------------------------- #
# Primitives, in Blender's own mesh API
# --------------------------------------------------------------------------- #

def _ring(radius: float, z: float, sides: int, twist: float = 0.0):
    return [
        (math.cos(i / sides * math.tau + twist) * radius,
         math.sin(i / sides * math.tau + twist) * radius,
         z)
        for i in range(sides)
    ]


def prism(radius: float, height: float, sides: int, z0: float = 0.0, top_radius: float | None = None):
    """A capped cylinder or, with top_radius, a cone frustum."""
    top_radius = radius if top_radius is None else top_radius
    verts = _ring(radius, z0, sides) + _ring(top_radius, z0 + height, sides)
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple(range(sides, sides * 2)))
    return verts, faces


def cone(radius: float, height: float, sides: int, z0: float = 0.0):
    verts = _ring(radius, z0, sides) + [(0.0, 0.0, z0 + height)]
    apex = len(verts) - 1
    faces = [(i, (i + 1) % sides, apex) for i in range(sides)]
    faces.append(tuple(reversed(range(sides))))
    return verts, faces


def icosphere(radius: float, subdivisions: int = 1):
    """A real icosphere, via bmesh, so rocks are round rather than pointy."""
    mesh = bpy.data.meshes.new("ico")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    verts = [tuple(v.co) for v in mesh.vertices]
    faces = [tuple(p.vertices) for p in mesh.polygons]
    bpy.data.meshes.remove(mesh)
    return verts, faces


def lumpy_sphere(radius: float, seed: int, amount: float = 0.18, subdivisions: int = 1):
    """An icosphere pushed around by a seeded hash: a rock, not a ball.

    The displacement is a deterministic function of the vertex direction, so two
    rocks with different seeds differ and the same seed always gives the same
    rock.
    """
    verts, faces = icosphere(radius, subdivisions)
    rng = random.Random(seed)
    phase = [rng.uniform(0, math.tau) for _ in range(3)]
    out = []
    for x, y, z in verts:
        d = Vector((x, y, z))
        if d.length == 0:
            out.append((x, y, z))
            continue
        unit = d.normalized()
        # Sum of three sines: smooth and continuous, so no creases.
        wobble = (
            math.sin(unit.x * 3.1 + phase[0]) * 0.5
            + math.sin(unit.y * 4.3 + phase[1]) * 0.3
            + math.sin(unit.z * 5.7 + phase[2]) * 0.2
        )
        radius_here = radius * (1 + wobble * amount)
        out.append(tuple(unit * radius_here))
    return out, faces


# --------------------------------------------------------------------------- #
# Materials
# --------------------------------------------------------------------------- #

def material(name: str, colour, roughness: float = 0.6, metallic: float = 0.0,
             transmission: float = 0.0, emission: float = 0.0):
    """A Principled BSDF is the one shader that renders predictably in Cycles
    for every kind of surface, so every material is built from it."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return mat
    r, g, b = colour
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    # Socket names moved in Blender 4.x; set whichever exists.
    for key in ("Transmission Weight", "Transmission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = transmission
            break
    if emission > 0:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (r, g, b, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def assign(obj: "bpy.types.Object", mat: "bpy.types.Material") -> None:
    obj.data.materials.append(mat)


# --------------------------------------------------------------------------- #
# Builders. Each returns a list of (object, material) so the caller can add to
# a scene that already has other things in it.
# --------------------------------------------------------------------------- #

def build_tree(palette, detail: int, seed: int, scale: float, bling: bool):
    rng = random.Random(seed)
    sides = 8 if detail >= 3 else 6
    trunk_h = 1.35 * scale
    trunk = mesh_object("trunk", *prism(0.15 * scale, trunk_h, sides, top_radius=0.10 * scale))
    park = material("bark", palette[1], roughness=0.85)
    assign(trunk, park)
    shade_flat(trunk)
    parts = [(trunk, park)]

    tiers = max(2, round(2 + detail * 0.75))
    crown = material("foliage", palette[0], roughness=0.7)
    for i in range(tiers):
        t = i / max(1, tiers - 1)
        radius = (0.95 - t * 0.5) * scale
        height = (0.85 - t * 0.3) * scale
        verts, faces = cone(radius, height, sides)
        obj = mesh_object(f"crown{i}", verts, faces)
        obj.location.z = trunk_h * 0.80 + i * 0.36 * scale
        obj.rotation_euler.z = rng.uniform(0, math.tau)
        assign(obj, crown)
        shade_flat(obj)
        parts.append((obj, crown))
    apex_v, apex_f = cone(0.42 * scale, 0.34 * scale, sides)
    apex = mesh_object("apex", apex_v, apex_f)
    apex.location.z = trunk_h * 0.80 + (tiers - 1) * 0.36 * scale + 0.16 * scale
    assign(apex, crown)
    shade_flat(apex)
    parts.append((apex, crown))
    return parts


def build_rock(palette, detail: int, seed: int, scale: float, bling: bool):
    stone = material("stone", palette[0], roughness=0.9)
    parts = []
    count = 1 + min(3, detail)
    for i in range(count):
        rng = random.Random(seed * 31 + i)
        r = (0.5 - i * 0.09) * scale
        verts, faces = lumpy_sphere(r, seed + i, amount=0.22, subdivisions=1 + (detail >= 4))
        obj = mesh_object(f"rock{i}", verts, faces)
        obj.location = (rng.uniform(-0.4, 0.4) * scale, rng.uniform(0.15, 0.45) * scale, r * 0.55)
        obj.rotation_euler = (rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, math.tau))
        # Rocks sit on the floor, so sink them slightly rather than float them.
        obj.location.z = r * 0.55
        assign(obj, stone)
        shade_flat(obj)
        parts.append((obj, stone))
    return parts


def build_crystal(palette, detail: int, seed: int, scale: float, bling: bool):
    body = material("crystal", palette[0], roughness=0.15, transmission=0.35 if bling else 0.0)
    base = material("crystal-base", palette[1], roughness=0.8)
    rng = random.Random(seed)
    parts = []
    verts, faces = lumpy_sphere(0.52 * scale, seed, amount=0.2)
    rock = mesh_object("crystal-base", verts, faces)
    rock.location.z = -0.16 * scale
    assign(rock, base)
    shade_flat(rock)
    parts.append((rock, base))
    sides = 6
    for i in range(3 + detail):
        radius = (0.18 + rng.random() * 0.16) * scale
        height = (0.9 + rng.random() * 1.5) * scale
        # One solid: a tapered shaft with a pointed cap, so the shard has no
        # seam where two primitives were glued together.
        verts = _ring(radius, 0.0, sides) + _ring(radius * 0.82, height * 0.72, sides)
        tip = len(verts)
        verts.append((0.0, 0.0, height))
        faces = []
        for k in range(sides):
            n = (k + 1) % sides
            faces.append((k, n, sides + n, sides + k))
            faces.append((sides + k, sides + n, tip))
        faces.append(tuple(reversed(range(sides))))
        shard = mesh_object(f"shard{i}", verts, faces)
        shard.location = (rng.uniform(-0.45, 0.45) * scale, rng.uniform(-0.45, 0.45) * scale, 0.0)
        shard.rotation_euler = (rng.uniform(-0.16, 0.16), rng.uniform(-0.16, 0.16), rng.uniform(0, math.tau))
        assign(shard, body)
        shade_flat(shard)
        parts.append((shard, body))
    return parts


def build_tower(palette, detail: int, seed: int, scale: float, bling: bool):
    stone = material("tower-stone", palette[0], roughness=0.8)
    trim = material("tower-trim", palette[1], roughness=0.6)
    parts = []
    tiers = max(2, 2 + detail)
    sides = 10 if detail >= 3 else 8
    for i in range(tiers):
        r = (0.9 - i * 0.11) * scale
        v, f = prism(r, 0.75 * scale, sides)
        level = mesh_object(f"tier{i}", v, f)
        level.location.z = i * 0.78 * scale
        assign(level, stone)
        shade_flat(level)
        parts.append((level, stone))
        # A lip at each tier reads as masonry rather than a smooth tube.
        lv, lf = prism(r * 1.08, 0.09 * scale, sides)
        lip = mesh_object(f"lip{i}", lv, lf)
        lip.location.z = i * 0.78 * scale + 0.75 * scale
        assign(lip, trim)
        shade_flat(lip)
        parts.append((lip, trim))
    rv, rf = cone((0.9 - tiers * 0.11 + 0.16) * scale, 1.05 * scale, sides)
    roof = mesh_object("roof", rv, rf)
    roof.location.z = tiers * 0.78 * scale
    assign(roof, trim)
    shade_flat(roof)
    parts.append((roof, trim))
    return parts


def build_pillar(palette, detail: int, seed: int, scale: float, bling: bool):
    body = material("pillar", palette[0], roughness=0.75)
    trim = material("pillar-trim", palette[1], roughness=0.6)
    parts = []
    sides = 12 if detail >= 3 else 8
    v, f = prism(0.45 * scale, 3 * scale, sides, top_radius=0.40 * scale)
    shaft = mesh_object("shaft", v, f)
    assign(shaft, body)
    shade_flat(shaft)
    parts.append((shaft, body))
    for name, z in (("base", -0.22 * scale), ("capital", 3.0 * scale)):
        bv, bf = prism(0.62 * scale if name == "base" else 0.58 * scale, 0.22 * scale, sides)
        band = mesh_object(name, bv, bf)
        band.location.z = z
        assign(band, trim)
        shade_flat(band)
        parts.append((band, trim))
    return parts


def build_spaceship(palette, detail: int, seed: int, scale: float, bling: bool):
    """Nose along +Y, wings flat in the XY plane, belly on the floor.

    Authored in the same Z-up frame as every other builder, so "wings out" is
    ±X and "forward" is +Y without a rotation to forget. An earlier version
    lofted the hull along Z and then turned it, which put the wings in a
    vertical plane and left the ship lying on its side.
    """
    hull_mat = material("hull", palette[0], roughness=0.35, metallic=0.5)
    engine = material("engine", palette[1], roughness=0.4, metallic=0.7)
    canopy_mat = material("canopy", palette[2], roughness=0.10, transmission=0.6 if bling else 0.2)
    parts = []

    def loft(name, sections, mat):
        """Sections are (y along the hull, radius, z offset)."""
        verts, faces = [], []
        for y, r, z in sections:
            for i in range(6):
                a = i / 6 * math.tau + math.pi / 6
                verts.append((math.cos(a) * r * scale, y * scale, z * scale + math.sin(a) * r * 0.8 * scale))
        for sec in range(len(sections) - 1):
            for i in range(6):
                a, b = sec * 6 + i, sec * 6 + (i + 1) % 6
                faces.append((a, b, b + 6, a + 6))
        faces.append(tuple(reversed(range(6))))
        last = (len(sections) - 1) * 6
        faces.append(tuple(range(last, last + 6)))
        obj = mesh_object(name, verts, faces)
        assign(obj, mat)
        shade_flat(obj)
        return obj

    body = loft("fuselage", [(1.55, 0.06, 0.30), (0.85, 0.30, 0.34), (-0.55, 0.34, 0.30), (-1.30, 0.22, 0.28)], hull_mat)
    parts.append((body, hull_mat))

    for side in (-1, 1):
        wing_v = [
            (side * 0.28 * scale, 0.40 * scale, 0.30 * scale),
            (side * 0.30 * scale, -0.70 * scale, 0.30 * scale),
            (side * 1.35 * scale, -0.85 * scale, 0.34 * scale),
            (side * 1.30 * scale, -1.15 * scale, 0.34 * scale),
        ]
        wing = mesh_object(f"wing{side}", wing_v, [(0, 1, 2, 3), (3, 2, 1, 0)])
        assign(wing, hull_mat)
        shade_flat(wing)
        parts.append((wing, hull_mat))

    # Engine bell at the tail, pointing aft along -Y.
    v, f = cone(0.26 * scale, 0.34 * scale, 8)
    bell = mesh_object("engine", v, f)
    bell.rotation_euler.x = -math.pi / 2
    bell.location = (0.0, -1.30 * scale, 0.28 * scale)
    assign(bell, engine)
    shade_flat(bell)
    parts.append((bell, engine))

    # Canopy: a low wedge on top of the forward hull.
    cv = [(-0.15 * scale, 0.80 * scale, 0.46 * scale), (0.15 * scale, 0.80 * scale, 0.46 * scale),
          (0.11 * scale, 0.10 * scale, 0.52 * scale), (-0.11 * scale, 0.10 * scale, 0.52 * scale),
          (0.0, 0.45 * scale, 0.72 * scale)]
    glass = mesh_object("canopy", cv, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)])
    assign(glass, canopy_mat)
    shade_flat(glass)
    parts.append((glass, canopy_mat))
    return parts


def build_terrain(palette, detail: int, seed: int, scale: float, bling: bool):
    ground = material("ground", palette[0], roughness=0.95)
    n = 6 + detail * 3
    width = 4 * scale
    step = width / n
    rng = random.Random(seed)
    # Independent random heights are a field of needles. Averaging each height
    # with its neighbours a few times is what turns noise into hills.
    field = []
    for i in range(n + 1):
        for j in range(n + 1):
            edge = i in (0, n) or j in (0, n)
            field.append(0.0 if edge else (rng.random() - 0.15) * 1.3 * scale)
    for _ in range(max(2, round(detail * 1.5))):
        nxt = list(field)
        for i in range(1, n):
            for j in range(1, n):
                at = lambda a, b: field[a * (n + 1) + b]
                around = (at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1)) / 4
                nxt[i * (n + 1) + j] = at(i, j) * 0.45 + around * 0.55
        field = nxt
    verts = []
    for i in range(n + 1):
        for j in range(n + 1):
            verts.append((-width / 2 + i * step, -width / 2 + j * step, field[i * (n + 1) + j]))
    faces = []
    idx = lambda i, j: i * (n + 1) + j
    for i in range(n):
        for j in range(n):
            a, b, c, d = idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)
            faces.append((a, b, c))
            faces.append((a, c, d))
    obj = mesh_object("terrain", verts, faces)
    assign(obj, ground)
    shade_flat(obj)
    return [(obj, ground)]


def build_coin(palette, detail: int, seed: int, scale: float, bling: bool):
    gold = material("gold", palette[2], roughness=0.22, metallic=1.0)
    sides = 32 if detail >= 3 else 16
    v, f = prism(0.62 * scale, 0.10 * scale, sides, z0=-0.05 * scale)
    coin = mesh_object("coin", v, f)
    # A disc built along Z lies flat and is seen edge-on as a smear. Stand it on
    # edge, and lift it by its radius so it rests on the floor.
    coin.rotation_euler.x = math.radians(90)
    coin.location.z = 0.62 * scale
    coin.location.x = 0.0
    assign(coin, gold)
    shade_flat(coin)
    return [(coin, gold)]


BUILDERS = {
    "tree": build_tree,
    "rock": build_rock,
    "crystal": build_crystal,
    "tower": build_tower,
    "pillar": build_pillar,
    "spaceship": build_spaceship,
    "terrain": build_terrain,
    "coin": build_coin,
}


# --------------------------------------------------------------------------- #
# Lighting and camera
# --------------------------------------------------------------------------- #

LIGHTING = {
    # name: (sun energy, sun angle degrees, sky strength, sky colour, ground colour)
    "studio": (5.5, 6.0, 1.0, (0.34, 0.36, 0.42), (0.24, 0.24, 0.26)),
    "daylight": (8.0, 4.0, 1.6, (0.48, 0.66, 0.95), (0.36, 0.34, 0.30)),
    "dusk": (2.2, 10.0, 0.8, (0.68, 0.42, 0.58), (0.22, 0.18, 0.18)),
    "night": (0.55, 12.0, 0.30, (0.12, 0.16, 0.34), (0.07, 0.08, 0.11)),
    "sunrise": (5.0, 8.0, 1.3, (0.98, 0.66, 0.48), (0.32, 0.26, 0.22)),
}


def setup_world(lighting: str, exposure: float = 0.0) -> None:
    sun_energy, sun_angle, sky_strength, sky_rgb, ground_rgb = LIGHTING.get(lighting, LIGHTING["studio"])
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Strength"].default_value = sky_strength
    background.inputs["Color"].default_value = (*sky_rgb, 1.0)
    links.new(background.outputs["Background"], out.inputs["Surface"])

    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun_data.energy = sun_energy
    sun_data.angle = math.radians(sun_angle)
    sun = bpy.data.objects.new("sun", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(38))

    # A dim fill from the opposite side stops the shadow side going to black.
    fill_data = bpy.data.lights.new("fill", type="AREA")
    fill_data.energy = 180 * sun_energy
    fill_data.size = 6.0
    fill = bpy.data.objects.new("fill", fill_data)
    bpy.context.scene.collection.objects.link(fill)
    fill.location = (-4, -3, 4)
    fill.rotation_euler = (math.radians(62), 0, math.radians(-130))

    scene = bpy.context.scene
    scene.view_settings.view_transform = "AgX" if "AgX" in [v.name for v in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = exposure


def setup_floor(colour, size: float = 40.0, roughness: float = 0.85) -> None:
    v, f = [(x, y, 0) for x, y in ((-size, -size), (size, -size), (size, size), (-size, size))], [(0, 1, 2, 3)]
    floor = mesh_object("floor", v, f)
    assign(floor, material("floor", colour, roughness=roughness))


def setup_camera(objects, azimuth: float = 38.0, elevation: float = 16.0, fov: float = 42.0):
    """Place the camera so the whole subject is in frame.

    Framing from the real bounds is what stops a tall tower being cropped and a
    wide terrain being a speck: the earlier fixed distance did both.
    """
    from mathutils import Vector as V
    bpy.context.view_layer.update()
    points = []
    for obj in objects:
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ V(corner))
    if not points:
        points = [V((0, 0, 0))]
    lo = V((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = V((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.35)

    cam_data = bpy.data.cameras.new("camera")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(fov)
    cam = bpy.data.objects.new("camera", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    # Distance from the vertical field of view and the radius, with a margin.
    distance = radius / math.tan(math.radians(fov) / 2) * 1.15
    az, el = math.radians(azimuth), math.radians(elevation)
    cam.location = centre + V((
        math.cos(el) * math.sin(az) * distance,
        -math.cos(el) * math.cos(az) * distance,
        math.sin(el) * distance + radius * 0.10,
    ))
    direction = centre - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


# --------------------------------------------------------------------------- #
# Putting a spec together
# --------------------------------------------------------------------------- #

DEFAULT_PALETTE = ["#3f9d5a", "#8a5a33", "#f6d365"]


def hex_to_rgb(value: str, fallback=(0.4, 0.6, 0.4)) -> tuple[float, float, float]:
    """sRGB hex to linear colour.

    Blender works in linear light. Feeding it an sRGB value makes every colour
    wash out, which is a subtle failure that looks like bad lighting rather than
    a colour-space mistake, so the conversion happens here once.
    """
    value = (value or "").strip().lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) != 6:
        return fallback
    try:
        parts = [int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    except ValueError:
        return fallback

    def to_linear(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(to_linear(c) for c in parts)


def atmosphere(name: str) -> None:
    """A little depth: fog makes a render read as a photograph of a place."""
    scene = bpy.context.scene
    if name == "none":
        return
    scene.world.use_nodes = True
    nodes, links = scene.world.node_tree.nodes, scene.world.node_tree.links
    background = next((n for n in nodes if n.type == "BACKGROUND"), None)
    if background is None:
        return
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Density"].default_value = {"light": 0.006, "haze": 0.014, "heavy": 0.032}.get(name, 0.008)
    links.new(volume.outputs["Volume"], next(n for n in nodes if n.type == "OUTPUT_WORLD").inputs["Volume"])


def build_from_spec(spec: dict[str, Any]) -> list:
    """Build the scene described by `spec` and return the created objects."""
    reset()
    palette = [hex_to_rgb(spec.get("palette", DEFAULT_PALETTE)[i] if i < len(spec.get("palette", DEFAULT_PALETTE)) else DEFAULT_PALETTE[i],
                          hex_to_rgb(DEFAULT_PALETTE[i], (0.5, 0.5, 0.5)))
               for i in range(3)]
    detail = max(1, min(5, int(spec.get("detail", 2))))
    scale = max(0.05, min(20.0, float(spec.get("scale", 1.0))))
    seed = int(spec.get("seed", 1))
    bling = bool(spec.get("bling", False))

    objects = []
    for item in spec.get("objects") or []:
        kind = str(item.get("kind", "rock"))
        builder = BUILDERS.get(kind)
        if not builder:
            continue
        parts = builder(palette, detail, seed, scale * float(item.get("scale", 1.0)), bling)
        objects.extend(obj for obj, _ in parts)

    if not objects:
        # An empty scene renders as a black rectangle, which is the least useful
        # possible result; a rock at least proves the pipeline and can be
        # replaced by a second call.
        parts = build_rock(palette, detail, seed, scale, bling)
        objects.extend(obj for obj, _ in parts)

    if str(spec.get("up", "z")).lower() == "y":
        # Y-up specs come from glTF and game-engine conventions; rotate the whole
        # subject once rather than making every builder aware of it.
        for obj in objects:
            obj.rotation_euler.x = math.pi / 2

    setup_world(str(spec.get("lighting", "studio")), float(spec.get("exposure", 0.0)))
    if spec.get("floor", True):
        setup_floor(hex_to_rgb(str(spec.get("floorColour", "#303034")), (0.3, 0.3, 0.32)))
    setup_camera(objects,
                 azimuth=float(spec.get("azimuth", 38.0)),
                 elevation=float(spec.get("elevation", 16.0)),
                 fov=float(spec.get("fov", 42.0)))
    atmosphere(str(spec.get("atmosphere", "none")))
    return objects
