#!/usr/bin/env bash
# Remove everything install.sh put in place.
set -euo pipefail

SUSHI_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sushi"
THUMB_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/thumbnailers"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d"

rm -f "$SUSHI_DIR/viewers/stl.js"
rm -f "$SUSHI_DIR/plugins-1/stl.js"
rm -rf "$SUSHI_DIR/stl-preview"
rm -f "$THUMB_DIR/stl.thumbnailer"
rm -f "$THUMB_DIR/stl-thumb.thumbnailer"  # pre-f3d backend, if present
rm -f "$HOME/.local/bin/stl-f3d-thumbnail"
rm -f "$ENV_DIR/nautilus-stl-preview.conf"

echo "uninstalled. restart Nautilus with: nautilus -q"
