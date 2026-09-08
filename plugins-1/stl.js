/* STL viewer plugin for sushi (NautilusPreviewer) 51+ / GTK4.
 *
 * Installs to ~/.local/share/sushi/plugins-1/stl.js (see ../install.sh).
 * Same two-phase design as the v50 entry (../viewers/stl.js): an instant
 * static render (cached thumbnail, f3d snapshot, or placeholder) with a
 * click-to-load swap into the bundled three.js WebView. Only the shell
 * differs (Adw.Bin + overlay load button instead of GTK3 widgets).
 *
 * NOTE: written against upstream plugins/example.js + plugin-api-1.js and
 * NOT yet runtime-tested — the author's machine runs sushi 50. If you can
 * test on sushi 51, see docs/TESTING.md.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later WITH GStreamer-exception-2008
 */

import Adw from 'gi://Adw';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import WebKit from 'gi://WebKit?version=6.0';

import { Renderer, ResizePolicy } from 'resource://org/gnome/NautilusPreviewer/plugin-api-1.js';

const VIEWER_PAGE = GLib.build_filenamev(
    [GLib.get_user_data_dir(), 'sushi', 'stl-preview', 'stl-viewer.html']);

const THUMB_SIZES = ['x-large', 'large', 'normal'];
const STATIC_MAX_PX = 640;
const F3D_MAX_BYTES = 50 * 1024 * 1024;

function fmtSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(0)} kB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const Klass = class STLRenderer extends Adw.Bin {
    static {
        GObject.registerClass({ Implements: [Renderer] }, this);
    }

    constructor(file, fileInfo, constructProperties = {}) {
        super(constructProperties);

        this._file = file;
        this._fileInfo = fileInfo;
        this._webview = null;
        this._destroyed = false;
        this._cancellable = new Gio.Cancellable();
        this._tmpRender = null;

        this.connect('destroy', () => {
            this._destroyed = true;
            try {
                this._cancellable.cancel();
            } catch (e) { /* already gone */ }
        });

        this._loadButton = new Gtk.Button({
            label: `Load interactive model (${fmtSize(fileInfo.get_size())})`,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.END,
            margin_bottom: 12,
            css_classes: ['suggested-action'],
        });
        this._loadButton.connect('clicked', () => this._loadInteractive());

        this._overlay = new Gtk.Overlay();
        this._overlay.add_overlay(this._loadButton);
        this.set_child(this._overlay);

        this.markReady();
        this._showStatic();
    }

    get resizePolicy() {
        return ResizePolicy.MAX_SIZE;
    }

    _setStatic(widget) {
        if (this._destroyed)
            return;
        this._overlay.set_child(widget);
    }

    _cachedThumb() {
        const md5 = GLib.compute_checksum_for_string(
            GLib.ChecksumType.MD5, this._file.get_uri(), -1);
        const cache = GLib.build_filenamev([GLib.get_user_cache_dir(), 'thumbnails']);
        for (const size of THUMB_SIZES) {
            const path = GLib.build_filenamev([cache, size, `${md5}.png`]);
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                return path;
        }
        return null;
    }

    _showStatic() {
        const cached = this._cachedThumb();
        if (cached) {
            try {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                    cached, STATIC_MAX_PX, STATIC_MAX_PX, true);
                this._setStatic(Gtk.Picture.new_for_pixbuf(pixbuf));
                return;
            } catch (e) { /* fall through */ }
        }

        const scheme = this._file.get_uri_scheme();
        if (scheme === 'file' && this._fileInfo.get_size() <= F3D_MAX_BYTES &&
            GLib.find_program_in_path('f3d')) {
            this._renderStatic();
            return;
        }

        const label = new Gtk.Label({
            label: scheme !== 'file'
                ? 'Remote file — load the full model to preview it'
                : 'Large file — load the full model to preview it',
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this._setStatic(label);
    }

    _renderStatic() {
        let tmp;
        try {
            const [fd, path] = GLib.file_open_tmp('stl-preview-XXXXXX.png');
            GLib.close(fd);
            tmp = path;
        } catch (e) {
            return;
        }
        this._tmpRender = tmp;

        const proc = new Gio.Subprocess({
            argv: ['/usr/bin/timeout', '120', '/usr/bin/env',
                '-u', 'WAYLAND_DISPLAY',
                'EGL_PLATFORM=surfaceless', 'LIBGL_ALWAYS_SOFTWARE=1',
                '/usr/bin/f3d', this._file.get_path(),
                '--rendering-backend=egl',
                `--resolution=${STATIC_MAX_PX},${STATIC_MAX_PX}`,
                '--filename=false', '--axis=false', '--grid=false',
                '--background-color=#efe3c8',
                '--up=+Z', '--camera-direction=-1,1,-0.5',
                '--output', tmp],
            flags: Gio.SubprocessFlags.STDOUT_SILENCE |
                   Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.wait_async(this._cancellable, (obj, res) => {
            if (this._destroyed)
                return;
            let ok = false;
            try {
                ok = obj.wait_finish(res);
            } catch (e) {
                ok = false;
            }
            if (!ok)
                return;
            try {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                    tmp, STATIC_MAX_PX, STATIC_MAX_PX, true);
                this._setStatic(Gtk.Picture.new_for_pixbuf(pixbuf));
            } catch (e) { /* keep the label/button */ }
        });
    }

    _eval(script) {
        if (this._destroyed || !this._webview)
            return;
        // WebKit 6.0 renamed run_javascript to evaluate_javascript; try both.
        try {
            if (this._webview.evaluate_javascript) {
                this._webview.evaluate_javascript(script, -1, null, null, null);
                return;
            }
        } catch (e) { /* fall through */ }
        try {
            this._webview.run_javascript(script, null, null);
        } catch (e) {
            logError(e, 'STL preview script failed');
        }
    }

    _loadInteractive() {
        if (this._destroyed || this._webview)
            return;

        const contentManager = new WebKit.UserContentManager();
        contentManager.registerScriptMessageHandler('stlReady');
        contentManager.connect('script-message-received::stlReady', () => {
            if (!this._destroyed)
                this.markReady();
        });

        this._webview = new WebKit.WebView({ user_content_manager: contentManager });
        this._webview.connect('load-changed', (_view, loadEvent) => {
            if (!this._destroyed && loadEvent === WebKit.LoadEvent.FINISHED)
                this._injectModel();
        });

        this._overlay.set_child(this._webview);
        this._webview.load_uri(GLib.filename_to_uri(VIEWER_PAGE, null));
    }

    async _injectModel() {
        // No size cap: local preview, not a web tab. Limits are RAM and
        // parse time, and failures surface via __stlError in the page.
        let contents;
        try {
            [, contents] = await this._file.load_contents_async(this._cancellable);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                this._eval(`window.__stlError("${'Failed to load model'}")`);
            return;
        }
        const name = this._file.get_basename()
            .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        this._eval(`window.__stlLoad("${GLib.base64_encode(contents)}","${name}")`);
    }
};

export const contentTypes = [
    'model/stl',
    'model/mesh',
    'application/sla',
];
