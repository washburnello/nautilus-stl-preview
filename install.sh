#!/usr/bin/env bash
# Install nautilus-stl-preview for the current user. No root required.
# - sushi Space-preview viewer  -> ~/.local/share/sushi/
# - thumbnail backend (f3d, EGL offscreen) -> ~/.local/share/thumbnailers/
#   (requires `f3d`: sudo pacman -S f3d)
set -euo pipefail
cd "$(dirname "$0")"

SUSHI_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/sushi"
THUMB_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/thumbnailers"
BIN_DIR="$HOME/.local/bin"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d"

mkdir -p "$SUSHI_DIR/viewers" "$SUSHI_DIR/plugins-1" "$SUSHI_DIR/stl-preview" "$THUMB_DIR" "$ENV_DIR"

cp viewers/stl.js "$SUSHI_DIR/viewers/stl.js"
cp plugins-1/stl.js "$SUSHI_DIR/plugins-1/stl.js"
cp data/stl-viewer.html data/stl-viewer.bundle.js "$SUSHI_DIR/stl-preview/"

# NVIDIA + native Wayland: WebKit's DMABuf renderer crashes any WebView-based
# preview (even stock HTML). Opt out of it session-wide; takes effect on
# next login (or `systemctl --user import-environment` + restart sushi).
cp env/nautilus-stl-preview.conf "$ENV_DIR/nautilus-stl-preview.conf"
echo "installed Wayland/NVIDIA WebKit workaround (~/.config/environment.d/)"

if command -v f3d >/dev/null 2>&1; then
  cp thumbnailers/stl.thumbnailer "$THUMB_DIR/stl.thumbnailer"
  echo "installed thumbnailer (f3d backend)"
else
  echo "NOTE: f3d not found — skipping thumbnailer."
  echo "      install with: sudo pacman -S f3d, then re-run install.sh"
fi

echo "installed Space-preview viewer."
echo "Sushi picks it up on next launch (just press Space again)."
echo "For thumbnails: clear the cache once with: rm -rf ~/.cache/thumbnails/*"
echo "then restart Nautilus: nautilus -q"
