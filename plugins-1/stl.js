/* STL viewer plugin for sushi (NautilusPreviewer) 51+ / GTK4.
 *
 * Installs to ~/.local/share/sushi/plugins-1/stl.js (see ../install.sh).
 * Same bundled three.js viewer as the v50 entry (../viewers/stl.js);
 * only the shell differs (Adw.Bin + overlay toggle instead of toolbar).
 *
 * NOTE: written against upstream plugins/example.js + plugin-api-1.js and
 * NOT yet runtime-tested — the author's machine runs sushi 50. If you can
 * test on sushi 51, see docs/TESTING.md.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later WITH GStreamer-exception-2008
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import WebKit from 'gi://WebKit?version=6.0';

import { Renderer, ResizePolicy } from 'resource://org/gnome/NautilusPreviewer/plugin-api-1.js';

const VIEWER_PAGE = GLib.build_filenamev(
    [GLib.get_user_data_dir(), 'sushi', 'stl-preview', 'stl-viewer.html']);
const MAX_BYTES = 200 * 1024 * 1024;

export const Klass = class STLRenderer extends Adw.Bin {
    static {
        GObject.registerClass({ Implements: [Renderer] }, this);
    }

    constructor(file, fileInfo, constructProperties = {}) {
        super(constructProperties);

        this._file = file;
        this._zUp = false;

        const contentManager = new WebKit.UserContentManager();
        contentManager.registerScriptMessageHandler('stlReady');
        contentManager.connect('script-message-received::stlReady', () => {
            this.markReady();
        });

        this._webview = new WebKit.WebView({ user_content_manager: contentManager });
        // Keep the WebView sandboxed: model bytes are injected, never fetched.
        this._webview.connect('load-changed', (_view, loadEvent) => {
            if (loadEvent === WebKit.LoadEvent.FINISHED)
                this._injectModel();
        });

        this._toggle = new Gtk.Button({
            icon_name: 'go-jump-symbolic-rtl',
            halign: Gtk.Align.END,
            valign: Gtk.Align.START,
            margin_top: 8,
            margin_end: 8,
            tooltip_text: 'Toggle Z-up orientation (use when the model appears lying down)',
        });
        this._toggle.connect('clicked', () => this._setZUp(!this._zUp));

        const overlay = new Gtk.Overlay();
        overlay.set_child(this._webview);
        overlay.add_overlay(this._toggle);
        this.set_child(overlay);

        this._webview.load_uri(GLib.filename_to_uri(VIEWER_PAGE, null));
    }

    get resizePolicy() {
        return ResizePolicy.MAX_SIZE;
    }

    _eval(script) {
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

    async _injectModel() {
        let info;
        try {
            info = await this._file.query_info_async(
                Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            logError(e, 'STL preview stat failed');
            return;
        }
        if (info.get_size() > MAX_BYTES) {
            logError(new Error('File is too large for interactive preview'));
            return;
        }
        let contents;
        try {
            [, contents] = await this._file.load_contents_async(null);
        } catch (e) {
            logError(e, 'STL preview read failed');
            return;
        }
        const name = this._file.get_basename()
            .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        this._eval(`window.__stlLoad("${GLib.base64_encode(contents)}","${name}")`);
    }

    _setZUp(next) {
        this._zUp = next;
        this._eval(`window.__stlSetZUp(${next ? 'true' : 'false'})`);
        if (next)
            this._toggle.add_css_class('suggested-action');
        else
            this._toggle.remove_css_class('suggested-action');
        this._toggle.tooltip_text = next
            ? 'Z-up on (model rotated upright). Click to switch back.'
            : 'Toggle Z-up orientation (use when the model appears lying down)';
    }
};

export const contentTypes = [
    'model/stl',
    'model/mesh',
    'application/sla',
];
