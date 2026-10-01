#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch_dir="$(mktemp -d)"
trap 'rm -rf "$scratch_dir"' EXIT
cp "$repo_dir/night-lock@local/schemas/org.gnome.shell.extensions.night-lock.gschema.xml" "$scratch_dir/"
glib-compile-schemas "$scratch_dir"
multiarch="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"
mutters="/usr/lib/$multiarch/mutter-14"
GSETTINGS_BACKEND=memory \
GSETTINGS_SCHEMA_DIR="$scratch_dir" \
GI_TYPELIB_PATH="$mutters${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}" \
LD_LIBRARY_PATH="$mutters${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    gjs -m "$repo_dir/tests/gi-smoke.js"
