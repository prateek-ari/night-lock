#!/usr/bin/gjs -m
// Development only: render the real libadwaita UI without restarting Shell.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gsk from 'gi://Gsk?version=4.0';

for (const file of ['org.gnome.Shell.Extensions.src.gresource', 'org.gnome.Extensions.data.gresource'])
    Gio.resources_register(Gio.Resource.load(`/usr/share/gnome-shell/${file}`));
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const dir = root.get_child('night-lock@local');
const metadata = JSON.parse(new TextDecoder().decode(dir.get_child('metadata.json').load_contents(null)[1]));
const {default: Preferences} = await import(dir.get_child('prefs.js').get_uri());
const prefs = new Preferences({...metadata, dir, path: dir.get_path()});
const {ExtensionPreferences} = await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
ExtensionPreferences.lookupByURL = () => prefs;
const app = new Adw.Application({application_id: 'io.github.prateek_ari.NightLock.Preview', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, title: 'Night Lock', search_enabled: false});
    prefs.fillPreferencesWindow(window);
    window.set_default_size(620, 950);
    print(`Automatic default: ${window._nightLockSettings.get_boolean('automatic')}`);
    window.present();
    if (ARGV[0]) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            const paintable = new Gtk.WidgetPaintable({widget: window});
            const snapshot = new Gtk.Snapshot();
            paintable.snapshot(snapshot, window.get_width(), window.get_height());
            const node = snapshot.to_node();
            const renderer = Gsk.Renderer.new_for_surface(window.get_surface());
            const texture = renderer.render_texture(node, null);
            texture.save_to_png(ARGV[0]);
            renderer.unrealize();
            print(`Saved actual GTK preferences screenshot: ${ARGV[0]}`);
            if (ARGV[1]) {
                window.set_visible_page_name('wake-behaviour');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    const p = new Gtk.WidgetPaintable({widget: window});
                    const s = new Gtk.Snapshot();
                    p.snapshot(s, window.get_width(), window.get_height());
                    const r = Gsk.Renderer.new_for_surface(window.get_surface());
                    r.render_texture(s.to_node(), null).save_to_png(ARGV[1]);
                    r.unrealize();
                    window.close();
                    return GLib.SOURCE_REMOVE;
                });
            } else window.close();
            return GLib.SOURCE_REMOVE;
        });
    }
});
app.run([]);
