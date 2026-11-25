#!/usr/bin/env python3
"""Run a script inside Blender, headless.

This is the only door into the engine. It sets the loader path so Blender can
find its own libraries and the no-display stand-ins, then runs a Python file in
the same process so the script can `import bpy` and use the real API.

    blender.py scene.json --out /tmp/work          # render a scene
    blender.py --self-test                        # prove the engine works
    blender.py --check                            # is Kinetix installed?

Exit codes are meaningful because the Bot reads them: 0 done, 2 not installed,
3 the script failed, 4 it timed out.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_HOME = pathlib.Path(os.environ.get("KINETIX_HOME", pathlib.Path.home() / ".kinetix"))


def home() -> pathlib.Path:
    return pathlib.Path(os.environ.get("KINETIX_HOME", DEFAULT_HOME)).resolve()


def environment(home_dir: pathlib.Path) -> dict[str, str]:
    """Everything Blender needs to load on a machine with no display."""
    env = dict(os.environ)
    parts = [str(home_dir / "shims"), str(home_dir / "site" / "bpy" / "lib")]
    # libX11 is usually present system-wide; include it explicitly because the
    # stand-ins replace only the libraries that are missing.
    parts.append("/usr/lib/x86_64-linux-gnu")
    env["LD_LIBRARY_PATH"] = ":".join(parts + ([env["LD_LIBRARY_PATH"]] if env.get("LD_LIBRARY_PATH") else []))
    env["PYTHONPATH"] = str(home_dir / "site")
    # Blender is chatty and will try to write a config directory; keep it local
    # so one user's run cannot disturb another's.
    env["BLENDER_USER_CONFIG"] = str(home_dir / "config")
    return env


def installed(home_dir: pathlib.Path) -> tuple[bool, str]:
    site = home_dir / "site" / "bpy"
    if not site.is_dir():
        return False, f"Kinetix is not installed (no Blender under {site})"
    if not (home_dir / "shims").is_dir():
        return False, "Kinetix has Blender but no no-display stand-ins; re-run install.sh"
    return True, "installed"


def main() -> int:
    args = sys.argv[1:]
    home_dir = home()

    if not args:
        print(__doc__)
        return 1

    if args[0] == "--check":
        ok, message = installed(home_dir)
        print(json.dumps({"ok": ok, "message": message, "home": str(home_dir)}))
        return 0 if ok else 2

    if args[0] == "--self-test":
        ok, message = installed(home_dir)
        if not ok:
            print(message)
            return 2
        out = pathlib.Path("/tmp/kinetix-selftest")
        out.mkdir(exist_ok=True)
        probe = out / "probe.py"
        probe.write_text(
            "import bpy, sys\n"
            "bpy.context.scene.render.engine = 'CYCLES'\n"
            "bpy.context.scene.cycles.device = 'CPU'\n"
            "bpy.context.scene.cycles.samples = 1\n"
            "bpy.context.scene.render.resolution_x = 64\n"
            "bpy.context.scene.render.resolution_y = 64\n"
            f"bpy.context.scene.render.filepath = {str(out / 'probe.png')!r}\n"
            "bpy.ops.render.render(write_still=True)\n"
            "print('KINETIX_OK', bpy.app.version_string)\n"
        )
        result = subprocess.run([sys.executable, str(probe)], env=environment(home_dir), capture_output=True, text=True, timeout=300)
        line = next((l for l in result.stdout.splitlines() if l.startswith("KINETIX_OK")), "")
        if result.returncode != 0 or not line or not (out / "probe.png").exists():
            return 3
        version = line.split(" ", 1)[1]
        print(f"Kinetix is ready — Blender {version}, Cycles renders on the CPU")
        return 0

    spec_path = pathlib.Path(args[0]).resolve()
    out_dir = pathlib.Path(args[args.index("--out") + 1]).resolve() if "--out" in args else spec_path.parent
    timeout = int(args[args.index("--timeout") + 1]) if "--timeout" in args else 600
    ok, message = installed(home_dir)
    if not ok:
        print(message, file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)

    env = environment(home_dir)
    env["KINETIX_SPEC"] = str(spec_path)
    env["KINETIX_OUT"] = str(out_dir)
    try:
        result = subprocess.run(
            [sys.executable, str(HERE / "render.py")],
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        print(f"Blender did not finish within {timeout}s", file=sys.stderr)
        return 4

    tail = "\n".join(result.stdout.splitlines()[-40:])
    body = {
        "ok": result.returncode == 0,
        "exit": result.returncode,
        "log": tail,
        "stderr": "\n".join(result.stderr.splitlines()[-15:]),
        "out": str(out_dir),
    }
    print(json.dumps(body))
    return 0 if result.returncode == 0 else 3


if __name__ == "__main__":
    raise SystemExit(main())
