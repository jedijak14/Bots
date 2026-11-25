"""Render a Kinetix scene.

Run by `blender.py` inside Blender. Reads the spec the Bot wrote, builds the
scene, exports the mesh in formats other programs open, renders with Cycles, and
prints one JSON line so the caller does not have to parse Blender's log.

Environment:
    KINETIX_SPEC   path to the JSON spec
    KINETIX_OUT    directory for the render and the exports
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import traceback

import bpy

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import scene as kinetix_scene  # noqa: E402


def export_meshes(out: pathlib.Path, name: str) -> list[str]:
    """Write the model in the formats a game engine or DCC app will open.

    glTF is the one that carries geometry, materials and transforms together, so
    it is the default; OBJ and STL are there because some pipelines only take
    those. Each export is optional: a failure to write one format is not a
    failure to render.
    """
    written: list[str] = []
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name != "floor"]
    if not meshes:
        return written

    for obj in bpy.context.scene.objects:
        obj.select_set(obj in meshes)
    bpy.context.view_layer.objects.active = meshes[0]

    glb = out / f"{name}.glb"
    try:
        bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True, export_apply=True)
        written.append(str(glb))
    except Exception:
        pass

    obj_path = out / f"{name}.obj"
    try:
        bpy.ops.wm.obj_export(filepath=str(obj_path), export_selected_objects=True, apply_modifiers=True)
        written.append(str(obj_path))
    except Exception:
        pass

    stl = out / f"{name}.stl"
    try:
        bpy.ops.wm.stl_export(filepath=str(stl), export_selected_objects=True, apply_modifiers=True)
        written.append(str(stl))
    except Exception:
        pass
    return written


def main() -> int:
    spec_path = pathlib.Path(os.environ["KINETIX_SPEC"])
    out = pathlib.Path(os.environ.get("KINETIX_OUT", spec_path.parent))
    spec = json.loads(spec_path.read_text())

    try:
        kinetix_scene.build_from_spec(spec)
    except Exception:
        print(json.dumps({"ok": False, "stage": "build", "error": traceback.format_exc()[-1200:]}))
        return 1

    name = str(spec.get("name") or "kinetix").strip().replace("/", "-")[:60] or "kinetix"
    exports = export_meshes(out, name) if spec.get("export", True) else []

    render = bpy.context.scene.render
    try:
        render.engine = "CYCLES"
        bpy.context.scene.cycles.device = "CPU"
        # Samples buy noise reduction; a preview does not need many, and a Bot
        # waiting 40 s for a postcard is worse than one waiting 6 s.
        quality = str(spec.get("quality", "draft"))
        bpy.context.scene.cycles.samples = {"draft": 24, "standard": 64, "fine": 160}.get(quality, 24)
        bpy.context.scene.cycles.use_denoising = True
        bpy.context.scene.cycles.max_bounces = 6
        resolution = spec.get("resolution") or {}
        render.resolution_x = int(resolution.get("width", 900))
        render.resolution_y = int(resolution.get("height", 640))
        render.resolution_percentage = 100
        render.film_transparent = bool(spec.get("transparent", False))
        image = out / f"{name}.png"
        render.filepath = str(image)
        render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)
    except Exception:
        print(json.dumps({"ok": False, "stage": "render", "error": traceback.format_exc()[-1200:], "exports": exports}))
        return 1

    stats = {
        "objects": len([o for o in bpy.context.scene.objects if o.type == "MESH"]),
        "faces": sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH"),
        "vertices": sum(len(o.data.vertices) for o in bpy.context.scene.objects if o.type == "MESH"),
        "blender": bpy.app.version_string,
        "engine": render.engine,
    }
    print(json.dumps({
        "ok": True,
        "image": str(image) if image.exists() else None,
        "exports": exports,
        "stats": stats,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
