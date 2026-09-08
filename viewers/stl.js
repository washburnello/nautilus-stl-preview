/*
 * STL viewer for sushi (NautilusPreviewer) ≤ 50 / GTK3.
 *
 * Installs to ~/.local/share/sushi/viewers/stl.js (see ../install.sh).
 * Interactive three.js preview (vendored, offline) with drag-to-rotate,
 * scroll-to-zoom and a session-only Z-up toggle in the toolbar.
 *
 * How it works: the WebView loads the bundled viewer page from file:// and
 * the model bytes are injected via run_javascript as base64. Gio reads the
 * file, so local paths and smb:// URIs both work, and the WebView stays on
 * its locked-down sandboxed context with no file access of its own.
 */

const { Gio, GLib, GObject, Gtk } = imports.gi;

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

// Refuse absurdly large files: base64 inflates ~33% and the whole model
// sits in one JS string. Local-only thumbnails already cap at 50MB;
// 200MB is a generous ceiling for an interactive preview.
const MAX_BYTES = 200 * 1024 * 1024;

function _isAvailable() {
    if (WebKit2 === undefined)
        return false;
    return GLib.file_test(VIEWER_PAGE, GLib.FileTest.EXISTS);
}

function _escapeJsString(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
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
}, class STLRenderer extends WebKit2.WebView {
    get ready() {
        return !!this._ready;
    }

    get fullscreen() {
        return !!this._fullscreen;
    }

    _init(file, fileInfo) {
        const contentManager = new WebKit2.UserContentManager();
        contentManager.register_script_message_handler('stlReady');
        contentManager.connect('script-message-received::stlReady', () => {
            this.isReady();
        });

        super._init({ user_content_manager: contentManager });

        this._file = file;
        this._zUp = false;

        /* disable the default context menu of the web view */
        this.connect('context-menu', function () { return true; });

        this.connect('load-changed', this._onLoadChanged.bind(this));
        this.connect('load-failed', (view, loadEvent, uri, error) => {
            this.emit('error', error);
        });

        this.load_uri(GLib.filename_to_uri(VIEWER_PAGE, null));
    }

    _onLoadChanged(view, loadEvent) {
        if (loadEvent !== WebKit2.LoadEvent.FINISHED)
            return;

        const size = this._file.query_info(
            Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
            Gio.FileQueryInfoFlags.NONE, null).get_size();
        if (size > MAX_BYTES) {
            // Shown in-page (not via the 'error' signal): sushi only
            // surfaces renderer errors in an already-visible window, so a
            // fresh open would stay invisible forever.
            const mb = (size / 1024 / 1024).toFixed(0);
            const limit = (MAX_BYTES / 1024 / 1024).toFixed(0);
            const msg = `File is too large for interactive preview (${mb} MB; limit ${limit} MB)`;
            this.run_javascript(
                `window.__stlError("${_escapeJsString(msg)}")`,
                null,
                () => { this.isReady(); });
            return;
        }

        this._file.load_contents_async(null, (obj, res) => {
            let contents;
            try {
                [, contents] = obj.load_contents_finish(res);
            } catch (e) {
                this.emit('error', e);
                return;
            }
            const b64 = GLib.base64_encode(contents);
            const name = _escapeJsString(this._file.get_basename());
            this.run_javascript(
                `window.__stlLoad("${b64}","${name}")`,
                null,
                (webview, result) => {
                    try {
                        webview.run_javascript_finish(result);
                    } catch (e) {
                        logError(e, 'STL preview injection failed');
                    }
                });
        });
    }

    _setZUp(next) {
        this._zUp = next;
        this.run_javascript(`window.__stlSetZUp(${next ? 'true' : 'false'})`,
                            null, null);
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
        // Clicks and drags belong to OrbitControls, not window dragging.
        return false;
    }
}) : undefined;

var mimeTypes = [];
if (_isAvailable())
    mimeTypes = [
        'model/stl',
        'model/mesh',
        'application/sla',
    ];
