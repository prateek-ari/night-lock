// One-shot login/uninstall recovery. This is not a daemon and never unlocks GNOME.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {NotificationManager} from './notificationManager.js';
import {restoreX11Dpms} from './display.js';

const directory = ARGV[0] ?? `${GLib.get_user_data_dir()}/gnome-shell/extensions/night-lock@local`;
const source = Gio.SettingsSchemaSource.new_from_directory(`${directory}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.night-lock', false);
if (!schema) throw new Error('Night Lock schema was not found');
const settings = new Gio.Settings({settings_schema: schema});
const notifications = new NotificationManager(settings);
const needsDisplayRecovery = settings.get_boolean('recovery-active') ||
    settings.get_string('x11-dpms-recovery') !== '';
const stale = needsDisplayRecovery || notifications.hasRecovery;
if (stale) {
    const force = ARGV.includes('--force');
    const hasOwner = () => Gio.DBus.session.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', ['org.gnome.Shell.Extensions.NightLock']),
        new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, 3000, null).deep_unpack()[0];
    let owner = hasOwner();
    if (force && owner) {
        const deadline = GLib.get_monotonic_time() + 3_000_000;
        while (owner && GLib.get_monotonic_time() < deadline) {
            GLib.usleep(50_000);
            owner = hasOwner();
        }
        if (owner)
            throw new Error('Night Lock is still running. Recovery files were retained; disable it and retry.');
    }
    if (!owner) {
        const locked = force ? false : Gio.DBus.session.call_sync('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver',
            'org.gnome.ScreenSaver', 'GetActive', null, new GLib.VariantType('(b)'),
            Gio.DBusCallFlags.NONE, 5000, null).deep_unpack()[0];
        if (!locked) {
            notifications.restore();
            let busError = null;
            if (needsDisplayRecovery) {
            try {
                Gio.DBus.session.call_sync('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
                    'org.freedesktop.DBus.Properties', 'Set',
                    new GLib.Variant('(ssv)', ['org.gnome.Mutter.DisplayConfig', 'PowerSaveMode', new GLib.Variant('i', 0)]),
                    null, Gio.DBusCallFlags.NONE, 5000, null);
            } catch (error) { busError = error; }
            // X11 physical recovery is independent of Shell's bus availability.
            await restoreX11Dpms(settings);
            if (busError)
                throw busError;
            }
            settings.set_boolean('recovery-active', false);
            Gio.Settings.sync();
            print('[NightLock] recovered display and notification settings');
        }
    }
    if (force && (settings.get_boolean('recovery-active') || notifications.hasRecovery ||
        settings.get_string('x11-dpms-recovery') !== ''))
        throw new Error('Night Lock recovery is incomplete. Keep the extension files and retry recovery.');
}
