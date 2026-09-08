# Testing

## Automated checks

```sh
node --check viewers/stl.js
node --check plugins-1/stl.js   # copy to .mjs first (ESM `gi://` imports)
python3 tools/make-fixtures.py  # tests/fixtures/cube_ascii.stl + sphere_binary.stl
./tools/build-bundle.sh
./install.sh
```

## Live preview (sushi 50)

```sh
# Start the previewer manually so you can see its log:
SUSHI_PERSIST=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 /usr/lib/org.gnome.NautilusPreviewer
# In another terminal (or press Space in Nautilus):
sushi tests/fixtures/cube_ascii.stl    # ASCII — expect a beige cube
sushi tests/fixtures/sphere_binary.stl # binary — expect a faceted sphere
```

Two phases — static first, interactive on click:

1. Window opens **instantly** on a static render: cached thumbnail when
   present, else a quick f3d snapshot (spinner, small local files only),
   else a placeholder with filename. Each carries a
   `Load interactive model (X MB)` button; clicking the image works too.
2. Click → three.js view with filename top-left and
   `drag to rotate · scroll to zoom` bottom-right.
3. Drag rotates, wheel zooms, no panning.
4. Corrupt input (e.g. truncated copy of a fixture) shows
   `Failed to load model: …`, not a spinner forever.
6. Scrub test: open a preview, arrow through several STLs in Nautilus —
   each step shows static instantly, no heavy loads until clicked.
7. Destroy test: open a large file, click Load, close the window mid-load —
   no `Gjs-CRITICAL … already disposed` in the service log (async callbacks
   are destroy-guarded + cancellable).
8. Large file: no size cap — a 401MB ASCII model loads (~1min, ~2GB peak
   WebProcess RSS on a 15GB machine). Far bigger than RAM just won't fit;
   that's the only limit.

History: an early version capped files at 200MB (inherited from monster
shelf's browser constraints) with a broken error constructor
(`Gio.IOError.TOO_BIG` doesn't exist — threw `TypeError`, causing silent
no-opens and stuck throbbers). Both fixed: cap removed, errors render
in-page via `__stlError` (sushi's `error` signal never surfaces on a fresh
open — verified with a corrupt PNG against stock sushi).

## Thumbnails

```sh
sudo pacman -S f3d
./install.sh            # installs the .thumbnailer (all-/usr Exec, sandbox-safe)
# Direct check (same render Nautilus runs, minus the sandbox):
timeout 120 env -u WAYLAND_DISPLAY EGL_PLATFORM=surfaceless LIBGL_ALWAYS_SOFTWARE=1 \
  f3d tests/fixtures/cube_ascii.stl --rendering-backend=egl \
  --resolution 256,256 --filename=false --axis=false --grid=false \
  --background-color=#efe3c8 --up=+Z --camera-direction=-1,1,-0.5 \
  --output /tmp/thumb-test.png
rm -rf ~/.cache/thumbnails/*
nautilus -q
```

Browse a folder of `.stl` files in grid view: thumbnails appear after a
moment (first render downloads nothing — local files only by design).

Backend note: `stl-thumb` (AUR) was tried first but its vendored glium 0.31
panics on modern Mesa (`get_format.rs:135`), so thumbnails go through f3d
instead. Two sandbox gotchas, both handled in `thumbnailers/stl.thumbnailer`:
the Exec line must reference only `/usr` paths (bwrap mounts just `/usr`
read-only, so `~/.local/bin` wrappers are invisible), and the camera flags
(`--up=+Z --camera-direction=-1,1,-0.5`, mirroring
`/etc/f3d/config.d/10_native.json`) must be explicit because the sandbox
hides `/etc` and f3d's default camera lands inside the model. EGL surfaceless
needs no X server — Xvfb was tried and aborts under the sandbox seccomp
filter.

## SMB

With `show-image-thumbnails 'local-only'` (default, left untouched):
grid view over `smb://` shows generic STL icons (correct). Space-preview on
a remote file shows the placeholder (no cached thumbs remotely) and streams
on click.

## Sushi 51 (un runtime-tested)

Needs a machine with sushi ≥ 51: `./install.sh`, then Space on an STL file.
If the plugin API drifted from upstream `plugins/example.js`, adapt
`plugins-1/stl.js` (`contentTypes`, `markReady()`, `evaluate_javascript`).

## NVIDIA + native Wayland crash (reference)

Without `WEBKIT_DISABLE_DMABUF_RENDERER=1`, *any* WebView preview (stock
`html.js` included) kills the previewer:

```
Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display.
```

Reproduced with `sushi /tmp/t-ctrl.html` on plain HTML; fixed by the env
var. PNG/text previews are unaffected (no WebView involved).
