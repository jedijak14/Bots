#!/usr/bin/env python3
"""Build the stand-ins that let Blender load on a machine with no display.

Blender links against the window-system libraries whether or not it will ever
open a window. A server image usually has libX11 but not XInput, Xfixes,
Xrender, ICE, SM, xkbcommon or GLX, so `import bpy` dies with

    ImportError: libXrender.so.1: cannot open shared object file

Each of those has to exist as a file with the right soname. But an empty file is
not enough: Blender asks for named symbols *under version nodes*, e.g.

    xkb_context_new@V_0.5.0

A stub that exports the name without the node fails with "version `V_0.5.0' not
found"; one that exports it under a node the loader cannot match trips an
internal assertion. So this reads the requirement out of the ELF instead of
guessing: for every undefined symbol Blender takes from a missing soname, note
the exact version string, then emit a stub and a linker version script with the
same names under the same nodes.

Nothing in the output is ever called. Kinetix runs Blender in background mode
on the CPU.
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import re
import shutil
import subprocess
import sys

# Soname -> the prefixes of the symbols it owns. XInput is the awkward one:
# its device calls are spelled like libX11's but are not in libX11.
OWNERS: list[tuple[str, tuple[str, ...]]] = [
    ("libxkbcommon.so.0", ("xkb_",)),
    ("libXrender.so.1", ("XRender",)),
    ("libXfixes.so.3", ("XFixes",)),
    ("libICE.so.6", ("Ice",)),
    ("libSM.so.6", ("Smc", "Sms")),
    ("libGL.so.1", ("glX", "glFinish", "glFlush")),
    ("libEGL.so.1", ("egl",)),
    ("libGLX.so.0", ("glX",)),
]

# XInput's device calls, which look like libX11 symbols but are not.
XI_DEVICE = {
    "_XiGetDevicePresenceNotifyEvent", "_XiGetDeviceNotifyEvent",
    "XCloseDevice", "XOpenDevice", "XListInputDevices", "XFreeDeviceList",
    "XQueryDeviceState", "XFreeDeviceState", "XSelectExtensionEvent",
    "XGetExtensionVersion", "XUngrabDevice", "XGrabDevice",
    "XGetDeviceButtonMapping", "XSetDeviceButtonMapping",
}


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def objects(site: pathlib.Path) -> list[pathlib.Path]:
    found = [p for p in site.glob("bpy/*.so")] + [p for p in site.glob("bpy/lib/*.so*")]
    return [p for p in found if p.is_file()]


def owner_of(name: str) -> str | None:
    if name in XI_DEVICE:
        return "libXi.so.6"
    for soname, prefixes in OWNERS:
        if name.startswith(prefixes):
            return soname
    return None


def requirements(objs: list[pathlib.Path]) -> tuple[dict[str, dict[str | None, set[str]]], set[str]]:
    """What each missing soname must export, and which sonames are needed at all."""
    need: dict[str, dict[str | None, set[str]]] = collections.defaultdict(lambda: collections.defaultdict(set))
    needed_sonames: set[str] = set()
    for path in objs:
        # readelf --dyn-syms prints "name@VERSION" for undefined entries, which
        # is unambiguous; objdump's column layout is easy to mis-slice.
        for line in run(["readelf", "--dyn-syms", "-W", str(path)]).splitlines():
            if " UND " not in line:
                continue
            parts = line.split()
            if len(parts) < 8:
                continue
            symbol = parts[7]
            if "@" in symbol:
                name, _, version = symbol.partition("@")
            else:
                name, version = symbol, None
            soname = owner_of(name)
            if soname:
                need[soname][version or None].add(name)
                needed_sonames.add(soname)
        for soname in re.findall(r"NEEDED\s+(\S+)", run(["objdump", "-p", str(path)])):
            if owner_of(soname.replace("lib", "") + "_") or soname in {s for s, _ in OWNERS}:
                needed_sonames.add(soname)
    return need, needed_sonames


def build(soname: str, versions: dict[str | None, set[str]], out: pathlib.Path) -> str:
    body = [
        f"/* Kinetix stand-in for {soname}.",
        "   This image has no display; Blender never opens a window here, so",
        "   nothing in this file is called. It exists so the loader can bind",
        "   the names and version nodes Blender asks for. */",
        "void kinetix_stand_in(void) { }",
    ]
    for names in versions.values():
        for name in sorted(names):
            body.append(f"long {name}(void) {{ return 0; }}")
    source = out / (soname.replace(".", "_") + ".c")
    source.write_text("\n".join(body) + "\n")
    target = out / soname
    cmd = ["gcc", "-shared", "-fPIC", "-Wl,-soname," + soname, "-o", str(target), str(source)]
    versioned = {v: n for v, n in versions.items() if v}
    if versioned:
        script = out / (soname + ".map")
        script.write_text(
            "\n".join(f'"{v}" {{ global: {"; ".join(sorted(n))}; }};' for v, n in versioned.items()) + "\n"
        )
        cmd.append("-Wl,--version-script=" + str(script))
    result = subprocess.run(cmd, capture_output=True, text=True)
    return "ok" if result.returncode == 0 else result.stderr.strip()[:160]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True, help="directory bpy was installed into")
    parser.add_argument("--out", required=True, help="where to write the stand-ins")
    args = parser.parse_args()

    site, out = pathlib.Path(args.site), pathlib.Path(args.out)
    if not shutil.which("gcc"):
        print("gcc is needed to build the stand-ins", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)

    objs = objects(site)
    if not objs:
        print(f"no Blender objects under {site}", file=sys.stderr)
        return 1
    need, needed_sonames = requirements(objs)

    for soname in sorted(needed_sonames):
        versions = need.get(soname) or {}
        status = build(soname, versions, out)
        count = sum(len(v) for v in versions.values())
        vers = ",".join(sorted(v for v in versions if v))
        print(f"  {soname:22s} {count:3d} symbols {vers:12s} {status}")
    print(f"  {len(needed_sonames)} stand-ins in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
