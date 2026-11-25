# Kinetix

Kinetix is the Bot's 3D program. It is not a lookalike: it is **Blender**, the
real engine, running headless, driven by a scene script the Bot writes and a
renderer that produces an actual path-traced image.

```
   Bot
    │  writes a scene ("a low-poly pine on a snow-covered hill, dusk")
    ▼
kinetix/scene.py  ──builds──▶  Blender scene  ──Cycles──▶  render.png
    │                              │
    │                              ├──▶  model.glb   (opens in any 3D app or engine)
    │                              └──▶  model.obj / model.stl
    ▼
render + assets come back as artifacts in the chat
```

## Why Blender and not a copy of Blender

The instruction was "try to actually copy blender and try to look at repos for
the real code". The honest answer is that Blender is ~4 million lines of C, C++
and Python; a reimplementation here would be a toy that *looks* like Blender and
renders nothing convincingly.

But Blender already ships as an embeddable module — `bpy` on PyPI — with Cycles,
OpenImageDenoise, OSL, Embree and its glTF/OBJ/STL/FBX exporters compiled in.
So Kinetix uses the real engine. Nothing is reimplemented, so nothing can drift
from what the real tool does. What this repository owns is the part Blender does
not give you: a headless bootstrap that works on a machine with no display, a
scene language simple enough for a model to write correctly, and the wiring that
turns a render into something the user can open.

## What is here

| File | What it is |
| --- | --- |
| `install.sh` | Pins and installs Blender (`bpy`), builds the no-display shims, verifies that it renders. Idempotent. |
| `blender.py` | The bootstrap: locates the install, sets the loader path, runs a script inside Blender with a timeout and a memory cap. |
| `scene.py` | The scene language. Deterministic builders (tree, crystal, rock, pillar, spaceship, terrain, tower, coin) written against Blender's own mesh API, plus lighting, camera and material setup. |
| `render.py` | The entry point Blender runs: reads a scene spec as JSON, builds it, exports the mesh, renders with Cycles. |
| `shims/` | Generated stand-ins for the handful of libraries a machine without a display lacks. Nothing in them is ever called. |

## The no-display problem, solved properly

Blender links against the window-system libraries even when it will never open a
window. On a server image without them, `import bpy` fails with
`libXrender.so.1: cannot open shared object file`.

`install.sh` reads the ELF objects Blender actually ships, works out precisely
which sonames are absent, then for each one emits a shared object exporting
exactly the symbols Blender asks of it — **under the version nodes it asks for**
(`xkb_context_new@V_0.5.0`, not `xkb_context_new`). That distinction is the
whole trick: a stub with the right names and the wrong version nodes fails the
loader's version check, and one with a mismatched mapping trips
`dl-lookup.c`'s assertion.

Nothing in those stubs is called. Kinetix sets `--background`, never creates a
window, and renders on the CPU. If a future change did try to open a UI, it
would crash on a null pointer rather than silently render something wrong.

## Verified

Blender 4.5.17 LTS, Cycles, CPU: a lit sphere rendered in 1.8 s at 320×240 with
correct soft shadows. glTF, OBJ, STL and FBX export all present.

## Cost

The install is about 900 MB, nearly all of it the engine. That is why it is a
streamed, pinned install rather than something committed to the repository: the
repo stays small, and a machine that never uses Kinetix never pays for it.

## When it cannot run

Kinetix reports its own availability honestly. Where Blender cannot be installed
(Vercel's serverless functions forbid the filesystem and process access this
needs), the `kinetix` tool says so in one line and the built-in
`make_3d_model` generator — which needs nothing at all — still works.
