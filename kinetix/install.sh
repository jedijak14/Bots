#!/usr/bin/env bash
# Install Kinetix: real Blender (bpy), headless, plus the stand-ins a machine
# with no display needs before it will load.
#
#   ./install.sh              install into ~/.kinetix
#   KINETIX_HOME=/opt/k ./install.sh   install elsewhere
#   ./install.sh --verify     check an existing install and render a test frame
#
# Safe to run twice: an existing install is verified, not rebuilt.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KINETIX_HOME="${KINETIX_HOME:-$HOME/.kinetix}"
# Pinned. bpy wheels are tied to one CPython minor: 4.5 supports 3.11, 5.3
# needs 3.13. Bumping this means checking both the wheel's Python tag and that
# the scene script still runs, so it is deliberately not "latest".
BPY_VERSION="${KINETIX_VERSION:-4.5.17}"
PY="${PYTHON:-python3}"

log() { printf '  %s\n' "$*"; }

verify() {
  # A real render, not just an import: an import can succeed and Cycles still
  # be broken. This writes a 64x64 frame and insists that it has pixels.
  local out
  out="$("$(dirname "${BASH_SOURCE[0]}")/blender.py" --self-test 2>&1)" || {
    log "FAILED: $out"; return 1; }
  log "$out"
}

if [[ "${1:-}" == "--verify" ]]; then
  verify
  exit $?
fi

log "Kinetix home: $KINETIX_HOME"
mkdir -p "$KINETIX_HOME"

PY_VER="$($PY -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
log "python $PY_VER"

if [[ -d "$KINETIX_HOME/site/bpy" ]]; then
  log "Blender already installed; verifying instead of reinstalling"
  KINETIX_HOME="$KINETIX_HOME" "$HERE/blender.py" --self-test >/dev/null 2>&1 &&
    { verify; exit 0; } || log "existing install is broken; reinstalling"
fi

log "installing Blender $BPY_VERSION (about 900 MB, one time)"
"$PY" -m pip install --quiet --no-input --target "$KINETIX_HOME/site" \
  "bpy==$BPY_VERSION" 2>&1 | tail -3 || true

if [[ ! -d "$KINETIX_HOME/site/bpy" ]]; then
  echo "  Blender could not be installed for python $PY_VER." >&2
  echo "  bpy $BPY_VERSION needs python 3.11 exactly; set PYTHON= to a 3.11." >&2
  exit 1
fi

# --- the no-display stand-ins -------------------------------------------------
# Read what Blender actually leaves undefined and satisfy exactly that, with
# the version nodes it asks for. Guessing here produces either an import error
# or a dl-lookup assertion, so this is derived from the binaries, never typed.
log "building no-display stand-ins"
"$PY" "$HERE/shims/build.py" --site "$KINETIX_HOME/site" --out "$KINETIX_HOME/shims" \
  || { echo "  could not build stand-ins" >&2; exit 1; }

verify
