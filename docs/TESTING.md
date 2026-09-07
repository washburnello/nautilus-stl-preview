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
yay -S stl-thumb
./install.sh            # picks up the .thumbnailer now that stl-thumb exists
rm -rf ~/.cache/thumbnails/*
nautilus -q
```

Browse a folder of `.stl` files in grid view: thumbnails appear after a
moment (first render downloads nothing — local files only by design).

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
