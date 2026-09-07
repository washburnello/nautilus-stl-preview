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

Manual checks per file:

1. Model renders with filename top-left and `drag to rotate · scroll to zoom`
   bottom-right.
2. Drag rotates, wheel zooms, no panning.
3. Hover the window → toolbar appears with the jump-arrows toggle
   (`go-jump-symbolic-rtl`, icon only). Click it → model rotates upright and
   the button highlights; click again → back. Close + reopen → toggle reset.
4. Corrupt input (e.g. truncated copy of a fixture) shows
   `Failed to load model: …`, not a spinner forever.

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
a remote file still renders (streams on demand).

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
