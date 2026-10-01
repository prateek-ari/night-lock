#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
uuid="night-lock@local"
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
autostart_file="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/night-lock-recovery.desktop"

if [[ ! -d "$extension_dir" ]]; then
    rm -f -- "$autostart_file"
    gjs -m "$project_dir/scripts/shell-settings.js" disable
    echo "Night Lock is not installed at $extension_dir."
    exit 0
fi

# Ask a running extension to unwind display, notification, and inhibitor state.
if command -v gdbus >/dev/null; then
    gdbus call --session \
        --dest org.gnome.Shell.Extensions.NightLock \
        --object-path /org/gnome/Shell/Extensions/NightLock \
        --method org.gnome.Shell.Extensions.NightLock.Cancel >/dev/null 2>&1 || true
fi

if command -v gnome-extensions >/dev/null; then
    if ! gnome-extensions disable "$uuid"; then
        if gnome-extensions list --enabled 2>/dev/null | grep -Fxq "$uuid"; then
            echo "Could not disable the live extension. It was not removed; log out and retry." >&2
            exit 1
        fi
    fi
fi

# The helper also handles a previous Shell crash, when the live D-Bus API is gone.
if [[ -f "$extension_dir/lib/recover.js" ]] && command -v gjs >/dev/null; then
    gjs -m "$extension_dir/lib/recover.js" "$extension_dir" --force
fi

gjs -m "$project_dir/scripts/shell-settings.js" disable
rm -f -- "$autostart_file"
rm -rf -- "$extension_dir"
echo "Night Lock uninstalled."
