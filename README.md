# nautilus-stl-preview

Interactive STL previews for GNOME Files (Nautilus): press **Space** on an
`.stl` file to get a rendered 3D view you can drag to rotate and scroll to
zoom — plus grid thumbnails. The 3D viewer is a port of the
[monster shelf](https://github.com/) `StlViewer` (three.js) to a sushi plugin.

## Features

- **Space-preview**: three.js render via a custom sushi viewer, vendored
  offline (no CDN). Drag to rotate, scroll to zoom.
- **Z-up toggle**: icon-only toolbar button (`go-jump-symbolic-rtl`, no text,
  tooltip explains when to use it). Session-only — resets when the preview
  closes.
- **Thumbnails**: grid previews via
  [stl-thumb](https://github.com/unlimitedbacon/stl-thumb),
  local files only (see SMB note).
- Works on sushi **50** (`~/.local/share/sushi/viewers/`) and **51+**
  (`~/.local/share/sushi/plugins-1/`, GTK4/Adw entry included).

## Install

```sh
git clone <this-repo> && cd nautilus-stl-preview
yay -S stl-thumb        # thumbnail renderer (AUR); skip if you only want Space-preview
./install.sh
nautilus -q
```

`install.sh` is user-local (no root): viewers + bundled page go to
`~/.local/share/sushi/`, the `.thumbnailer` to `~/.local/share/thumbnailers/`,
and a Wayland/NVIDIA WebKit workaround to `~/.config/environment.d/`
(takes effect on next login). Uninstall with `./uninstall.sh`.

## SMB / remote files

Thumbnails stay **local-only** (Nautilus default `show-image-thumbnails` is
untouched): `smb://` files show generic icons in grid view. Space-preview
still works over SMB — the file is streamed on demand with a progress
indicator. Files over 200MB are refused with a clear error rather than
hanging the previewer.

## Known issues

- **NVIDIA + native Wayland**: WebKit2GTK's DMABuf renderer crashes *any*
  WebView-based preview (even stock HTML sushi) with `Error 71 (Protocol
  error)`. `install.sh` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` via
  `environment.d` as a workaround. See `docs/TESTING.md`.
- The sushi 51 `plugins-1` entry is written against upstream
  `plugins/example.js` but not yet runtime-tested (author is on sushi 50).

## Development

- Viewer source: `src/viewer-main.js` (port of monster shelf `StlViewer.tsx`:
  same lights, material, camera fit, `OrbitControls` with pan disabled).
- Rebuild the bundle: `tools/build-bundle.sh` (needs node + npx).
- Regenerate fixtures: `python3 tools/make-fixtures.py`.
- three.js r179 sources live in `vendor/` (from monster shelf's
  `node_modules`); only the esbuild bundle in `data/` ships to users.

## License

GPL-2.0-or-later WITH GStreamer-exception (same terms as sushi itself).
