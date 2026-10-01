#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
uuid="night-lock@local"
source_dir="$project_dir/$uuid"
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
autostart_file="$autostart_dir/night-lock-recovery.desktop"

if ! command -v glib-compile-schemas >/dev/null; then
    echo "Missing glib-compile-schemas. Install the Ubuntu package libglib2.0-bin." >&2
    exit 1
fi
if [[ ! -f "$source_dir/extension.js" ]]; then
    echo "Night Lock extension.js is missing from $source_dir" >&2
    exit 1
fi
if [[ ! -f "$source_dir/lib/recover.js" ]]; then
    echo "Night Lock recovery helper is missing from $source_dir/lib/recover.js" >&2
    exit 1
fi
if ! command -v gjs >/dev/null; then
    echo "Missing gjs. Install the Ubuntu package gjs." >&2
    exit 1
fi

# A live update must stop the old controller before files are replaced.
if [[ -d "$extension_dir" ]] && command -v gnome-extensions >/dev/null &&
   gnome-extensions list --enabled 2>/dev/null | grep -Fxq "$uuid"; then
    if command -v gdbus >/dev/null; then
        gdbus call --session \
            --dest org.gnome.Shell.Extensions.NightLock \
            --object-path /org/gnome/Shell/Extensions/NightLock \
            --method org.gnome.Shell.Extensions.NightLock.Cancel >/dev/null 2>&1 || true
    fi
    if ! gnome-extensions disable "$uuid"; then
        echo "Could not disable the running Night Lock extension; no files were replaced." >&2
        exit 1
    fi
fi

mkdir -p "$extension_dir"
cp -a "$source_dir/." "$extension_dir/"
glib-compile-schemas --strict "$extension_dir/schemas"

# On Wayland, Shell may not discover a newly copied extension until next login.
# Persisting the UUID now means it activates without another user command.
gjs -m "$project_dir/scripts/shell-settings.js" enable

mkdir -p "$autostart_dir"
escaped_recover="${extension_dir//\\/\\\\}"
escaped_recover="${escaped_recover//\"/\\\"}"
cat > "$autostart_file" <<EOF
[Desktop Entry]
Type=Application
Name=Night Lock recovery
Comment=Restore saved display and notification settings after a Shell crash
Exec=gjs -m "$escaped_recover/lib/recover.js" "$escaped_recover"
OnlyShowIn=GNOME;
NoDisplay=true
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=10
EOF

if command -v gnome-extensions >/dev/null; then
    if ! gnome-extensions enable "$uuid" >/dev/null 2>&1; then
        echo "Installed and enabled for the next GNOME login at $extension_dir. Log out and back in."
        exit 0
    fi
fi

echo "Night Lock installed at $extension_dir."
echo "On GNOME Wayland, log out and back in if it does not appear immediately."
echo "Open settings with: gnome-extensions prefs $uuid"
