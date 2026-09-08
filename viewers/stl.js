/*
 * STL viewer for sushi (NautilusPreviewer) ≤ 50 / GTK3.
 *
 * Installs to ~/.local/share/sushi/viewers/stl.js (see ../install.sh).
 *
 * Two phases, mirroring monster shelf's ArmiesPage pattern:
 *   1. STATIC — an instantly-available render: the file's cached Nautilus
 *      thumbnail when present, otherwise a quick f3d snapshot for modest
 *      local files, otherwise a placeholder. Scrubbing through files with
 *      the arrow keys never pays for more than this.
 *   2. INTERACTIVE — click the static image (or its button) to swap in the
 *      three.js WebView (vendored, offline) with drag-to-rotate,
 *      scroll-to-zoom and a session-only Z-up toggle in the toolbar.
 *
 * The WebView loads its page from file:// and the model bytes are injected
 * via run_javascript as base64. Gio reads the file, so local paths and
 * smb:// URIs both work, and the WebView stays on its locked-down
 * sandboxed context with no file access of its own.
 */

const { GdkPixbuf, Gio, GLib, GObject, Gtk } = imports.gi;

let WebKit2;
try {
    imports.gi.versions.WebKit2 = '4.1';
    WebKit2 = imports.gi.WebKit2;
} catch (e) {
    // WebKit2 not available; Klass stays undefined and files fall back.
}

const Renderer = imports.ui.renderer;
const Utils = imports.ui.utils;

const VIEWER_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'sushi', 'stl-preview']);
const VIEWER_PAGE = GLib.build_filenamev([VIEWER_DIR, 'stl-viewer.html']);

// Static-image preferences, in order.
const THUMB_SIZES = ['x-large', 'large', 'normal'];
const STATIC_MAX_PX = 640;
// Files over the Nautilus thumbnail-limit never get cached thumbs, and an
// on-demand f3d snapshot of a giant ASCII model is slow — go straight to
// the placeholder + load button for those.
const F3D_MAX_BYTES = 50 * 1024 * 1024;

function _isAvailable() {
    if (WebKit2 === undefined)
        return false;
    return GLib.file_test(VIEWER_PAGE, GLib.FileTest.EXISTS);
}

function _escapeJsString(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function _fmtSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(0)} kB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

var Klass = _isAvailable() ? GObject.registerClass({
    Implements: [Renderer.Renderer],
    Properties: {
        fullscreen: GObject.ParamSpec.boolean('fullscreen', '', '',
                                              GObject.ParamFlags.READABLE,
                                              false),
        ready: GObject.ParamSpec.boolean('ready', '', '',
                                         GObject.ParamFlags.READABLE,
                                         false),
    },
}, class STLRenderer extends Gtk.Box {
    get ready() {
        return !!this._ready;
    }

    get fullscreen() {
        return !!this._fullscreen;
    }

    _init(file, fileInfo) {
        super._init({ orientation: Gtk.Orientation.VERTICAL });

        this._file = file;
        this._fileInfo = fileInfo;
        this._zUp = false;
        this._webview = null;
        this._destroyed = false;
        this._cancellable = new Gio.Cancellable();
        this._tmpRender = null;

        this.connect('destroy', () => {
            this._destroyed = true;
            try {
                this._cancellable.cancel();
            } catch (e) { /* already gone */ }
            if (this._tmpRender) {
                try {
                    GLib.unlink(this._tmpRender);
                } catch (e) { /* best effort */ }
                this._tmpRender = null;
            }
        });

        this._spinner = new Gtk.Spinner({ active: true });
        const spinBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            vexpand: true,
            spacing: 12,
        });
        spinBox.add(this._spinner);
        spinBox.add(new Gtk.Label({ label: 'Loading preview…' }));
        this.add(spinBox);
        this._staticBox = spinBox;

        // Window opens immediately on the spinner/static; the heavy
        // three.js load only happens on click.
        this.isReady();
        this._showStatic();
    }

    _replaceStatic(widget) {
        if (this._destroyed)
            return;
        if (this._staticBox)
            this._staticBox.destroy();
        this._staticBox = widget;
        widget.hexpand = true;
        widget.vexpand = true;
        this.add(widget);
        widget.show_all();
    }

    _loadButton() {
        const size = this._fileInfo.get_size();
        const button = new Gtk.Button({
            label: `Load interactive model (${_fmtSize(size)})`,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.END,
            margin_bottom: 12,
        });
        button.get_style_context().add_class('suggested-action');
        button.connect('clicked', () => this._loadInteractive());
        return button;
    }

    _staticOverlay(pixbuf) {
        const image = new Gtk.Image({ pixbuf: pixbuf });
        const click = new Gtk.EventBox({
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            vexpand: true,
        });
        click.add(image);
        // Stop propagation so the click loads the model instead of
        // dragging the preview window (see moveOnClick).
        click.connect('button-press-event', () => {
            this._loadInteractive();
            return true;
        });

        const overlay = new Gtk.Overlay();
        overlay.add(click);
        overlay.add_overlay(this._loadButton());
        return overlay;
    }

    _placeholder(labelText) {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            vexpand: true,
            spacing: 12,
        });
        box.add(new Gtk.Image({
            icon_name: 'application-x-3d-model-symbolic,package-x-generic-symbolic',
            pixel_size: 96,
        }));
        const name = new Gtk.Label({ label: this._file.get_basename() });
        name.set_ellipsize(3 /* END */);
        name.max_width_chars = 48;
        box.add(name);
        box.add(new Gtk.Label({ label: labelText }));
        const click = new Gtk.EventBox();
        click.add(box);
        click.connect('button-press-event', () => {
            this._loadInteractive();
            return true;
        });

        const overlay = new Gtk.Overlay();
        overlay.add(click);
        overlay.add_overlay(this._loadButton());
        return overlay;
    }

    _cachedThumb() {
        let uri;
        try {
            uri = this._file.get_uri();
        } catch (e) {
            return null;
        }
        const md5 = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uri, -1);
        const cache = GLib.build_filenamev([GLib.get_user_cache_dir(), 'thumbnails']);
        for (const size of THUMB_SIZES) {
            const path = GLib.build_filenamev([cache, size, `${md5}.png`]);
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                return path;
        }
        return null;
    }

    _showStatic() {
        // 1. Cached Nautilus thumbnail — instant, already rendered.
        const cached = this._cachedThumb();
        if (cached) {
            try {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                    cached, STATIC_MAX_PX, STATIC_MAX_PX, true);
                this._replaceStatic(this._staticOverlay(pixbuf));
                return;
            } catch (e) {
                logError(e, 'STL cached thumbnail unreadable, falling back');
            }
        }

        // 2. On-demand f3d snapshot for modest local files.
        const size = this._fileInfo.get_size();
        const scheme = this._file.get_uri_scheme();
        if (scheme === 'file' && size <= F3D_MAX_BYTES &&
            GLib.find_program_in_path('f3d')) {
            this._renderStatic();
            return;
        }

        // 3. Placeholder with an explicit load action.
        const why = scheme !== 'file'
            ? 'Remote file — load the full model to preview it'
            : 'Large file — load the full model to preview it';
        this._replaceStatic(this._placeholder(why));
    }

    _renderStatic() {
        let tmp;
        try {
            const [fd, path] = GLib.file_open_tmp('stl-preview-XXXXXX.png');
            GLib.close(fd);
            tmp = path;
        } catch (e) {
            this._replaceStatic(this._placeholder('Preview unavailable'));
            return;
        }
        this._tmpRender = tmp;

        const argv = ['/usr/bin/timeout', '120', '/usr/bin/env',
            '-u', 'WAYLAND_DISPLAY',
            'EGL_PLATFORM=surfaceless', 'LIBGL_ALWAYS_SOFTWARE=1',
            '/usr/bin/f3d', this._file.get_path(),
            '--rendering-backend=egl',
            `--resolution=${STATIC_MAX_PX},${STATIC_MAX_PX}`,
            '--filename=false', '--axis=false', '--grid=false',
            '--background-color=#efe3c8',
            '--up=+Z', '--camera-direction=-1,1,-0.5',
            '--output', tmp];
        let proc;
        try {
            proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_SILENCE |
                       Gio.SubprocessFlags.STDERR_SILENCE,
            });
        } catch (e) {
            this._replaceStatic(this._placeholder('Preview unavailable'));
            return;
        }
        proc.wait_async(this._cancellable, (obj, res) => {
            if (this._destroyed)
                return;
            let ok = false;
            try {
                ok = obj.wait_finish(res);
            } catch (e) {
                ok = false; // cancelled or timed out
            }
            if (!ok || !GLib.file_test(tmp, GLib.FileTest.EXISTS)) {
                this._replaceStatic(this._placeholder('Preview unavailable'));
                return;
            }
            try {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                    tmp, STATIC_MAX_PX, STATIC_MAX_PX, true);
                this._replaceStatic(this._staticOverlay(pixbuf));
            } catch (e) {
                this._replaceStatic(this._placeholder('Preview unavailable'));
            }
        });
    }

    _loadInteractive() {
        if (this._destroyed || this._webview)
            return;

        if (this._staticBox) {
            this._staticBox.destroy();
            this._staticBox = null;
        }

        const contentManager = new WebKit2.UserContentManager();
        contentManager.register_script_message_handler('stlReady');
        contentManager.connect('script-message-received::stlReady', () => {
            if (!this._destroyed)
                this.isReady();
        });

        this._webview = new WebKit2.WebView({ user_content_manager: contentManager });
        this._webview.hexpand = true;
        this._webview.vexpand = true;
        this._webview.expand = true;

        /* disable the default context menu of the web view */
        this._webview.connect('context-menu', function () { return true; });

        this._webview.connect('load-changed', this._onLoadChanged.bind(this));
        this._webview.connect('load-failed', (view, loadEvent, uri, error) => {
            if (!this._destroyed)
                this.emit('error', error);
        });
        // The loading spinner lives in the page until __stlLoad resolves.
        this._webview.connect('destroy', () => { this._webview = null; });

        this.add(this._webview);
        this._webview.show_all();
        this._webview.load_uri(GLib.filename_to_uri(VIEWER_PAGE, null));
    }

    _onLoadChanged(view, loadEvent) {
        if (this._destroyed)
            return;
        if (loadEvent !== WebKit2.LoadEvent.FINISHED)
            return;

        // No size cap: this is a local preview, not a web tab — Gio streams
        // the file and the only limits are RAM and parse time.

        this._file.load_contents_async(this._cancellable, (obj, res) => {
            if (this._destroyed)
                return;
            let contents;
            try {
                [, contents] = obj.load_contents_finish(res);
            } catch (e) {
                // Cancelled (window closed mid-load) — stay quiet.
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    this.emit('error', e);
                return;
            }
            const b64 = GLib.base64_encode(contents);
            contents = null;
            const name = _escapeJsString(this._file.get_basename());
            this._webview.run_javascript(
                `window.__stlLoad("${b64}","${name}")`,
                null,
                (webview, result) => {
                    if (this._destroyed)
                        return;
                    try {
                        webview.run_javascript_finish(result);
                    } catch (e) {
                        logError(e, 'STL preview injection failed');
                        return;
                    }
                    // Apply any Z-up toggle flipped while loading.
                    if (this._zUp) {
                        this._webview.run_javascript(
                            'window.__stlSetZUp(true)', null, null);
                    }
                });
        });
    }

    _setZUp(next) {
        this._zUp = next;
        if (this._webview) {
            this._webview.run_javascript(
                `window.__stlSetZUp(${next ? 'true' : 'false'})`, null, null);
        }
        if (this._zToggle) {
            const ctx = this._zToggle.get_style_context();
            if (next)
                ctx.add_class('suggested-action');
            else
                ctx.remove_class('suggested-action');
            this._zToggle.tooltip_text = next
                ? 'Z-up on (model rotated upright). Click to switch back.'
                : 'Toggle Z-up orientation (use when the model appears lying down)';
        }
    }

    populateToolbar(toolbar) {
        const theme = Gtk.IconTheme.get_default();
        let icon = 'view-refresh-symbolic';
        if (theme && theme.has_icon('go-jump-symbolic-rtl'))
            icon = 'go-jump-symbolic-rtl';

        this._zToggle = Utils.createToolButton(this, icon, () => {
            this._setZUp(!this._zUp);
        });
        this._zToggle.tooltip_text =
            'Toggle Z-up orientation (use when the model appears lying down)';
        toolbar.add(this._zToggle);
    }

    get moveOnClick() {
        // Static phase: our click handler loads the model (and stops the
        // event so the window isn't dragged). Interactive phase: clicks and
        // drags belong to OrbitControls, not window dragging.
        return this._webview === null;
    }
}) : undefined;

var mimeTypes = [];
if (_isAvailable())
    mimeTypes = [
        'model/stl',
        'model/mesh',
        'application/sla',
    ];
