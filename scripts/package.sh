#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
uuid="night-lock@local"
extension_dir="$project_dir/$uuid"
output_dir="$project_dir/dist"
stage_dir="$(mktemp -d)"
trap 'rm -rf -- "$stage_dir"' EXIT

for program in glib-compile-schemas zip; do
    if ! command -v "$program" >/dev/null; then
        echo "Missing required command: $program" >&2
        exit 1
    fi
done

if [[ ! -f "$extension_dir/extension.js" ]]; then
    echo "Night Lock extension.js is missing from $extension_dir" >&2
    exit 1
fi
if [[ ! -f "$extension_dir/lib/recover.js" ]]; then
    echo "Night Lock recovery helper is missing from $extension_dir/lib/recover.js" >&2
    exit 1
fi

cp -a "$extension_dir/." "$stage_dir/"
glib-compile-schemas --strict "$stage_dir/schemas"
mkdir -p "$output_dir"
rm -f -- "$output_dir/$uuid.zip"
(
    cd "$stage_dir"
    zip -q -r "$output_dir/$uuid.zip" . -x '*.swp' '*~' '.DS_Store'
)
echo "$output_dir/$uuid.zip"
