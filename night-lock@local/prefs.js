import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const BUS_NAME = 'org.gnome.Shell.Extensions.NightLock';
const OBJECT_PATH = '/org/gnome/Shell/Extensions/NightLock';
const INTERFACE = 'org.gnome.Shell.Extensions.NightLock';
const VALID_TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export default class NightLockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._nightLockSettings = settings;
        window.set_default_size(560, 620);

        const mainPage = new Adw.PreferencesPage({
            title: _('Night Lock'),
            name: 'general',
            icon_name: 'weather-clear-night-symbolic',
        });
        window.add(mainPage);

        const general = new Adw.PreferencesGroup({title: _('General')});
        mainPage.add(general);
        this._addSwitch(general, settings, 'automatic', _('Automatic Night Lock'),
            _('Use the local time schedule below.'));
        this._addSwitch(general, settings, 'activate-when-locked',
            _('Activate when locked'), _('Apply Night Lock when GNOME is locked during the schedule.'));

        const statusRow = new Adw.ActionRow({
            title: _('Status'),
            subtitle: _('Checking the GNOME Shell extension…'),
        });
        const refreshButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Refresh status'),
        });
        refreshButton.connect('clicked', () => this._refreshStatus(statusRow));
        statusRow.add_suffix(refreshButton);
        general.add(statusRow);

        const errorRow = new Adw.ActionRow({title: _('Last error')});
        const updateError = () => {
            const message = settings.get_string('last-error');
            errorRow.subtitle = message;
            errorRow.visible = message.length > 0;
        };
        settings.connect('changed::last-error', updateError);
        updateError();
        general.add(errorRow);

        const schedule = new Adw.PreferencesGroup({
            title: _('Schedule'),
            description: _('Times use your current local time zone.'),
        });
        mainPage.add(schedule);
        this._addTime(schedule, settings, 'start-time', _('Start'));
        this._addTime(schedule, settings, 'end-time', _('End'));

        const controls = new Adw.PreferencesGroup({title: _('Controls')});
        mainPage.add(controls);
        this._addAction(controls, _('Night Lock Now'),
            _('Lock GNOME and power off the displays.'), 'Now', statusRow);
        this._addAction(controls, _('Disable Tonight'),
            _('Skip the current overnight schedule.'), 'DisableTonight', statusRow);
        this._addAction(controls, _('Cancel Night Lock'),
            _('Return to the ordinary GNOME lock screen.'), 'Cancel', statusRow);

        const optionsPage = new Adw.PreferencesPage({
            title: _('Wake & behaviour'),
            name: 'wake-behaviour',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(optionsPage);
        const wake = new Adw.PreferencesGroup({title: _('Wake')});
        optionsPage.add(wake);
        this._addSwitch(wake, settings, 'wake-keyboard', _('Keyboard'));
        this._addSwitch(wake, settings, 'wake-mouse-movement', _('Mouse movement'));
        this._addSwitch(wake, settings, 'wake-mouse-button', _('Mouse buttons'));
        this._addSwitch(wake, settings, 'wake-touchpad', _('Touchpad'));
        this._addSwitch(wake, settings, 'wake-touchscreen', _('Touchscreen'));
        this._addInteger(wake, settings, 'motion-threshold', _('Mouse threshold'),
            _('Accumulated pointer movement before waking, in pixels.'), 1, 200, 1, 'px');

        const behavior = new Adw.PreferencesGroup({title: _('Behaviour')});
        optionsPage.add(behavior);
        this._addInteger(behavior, settings, 'redarken-seconds',
            _('Re-darken if not unlocked'), _('Lock-screen inactivity timeout.'), 5, 600, 5, 'sec');
        this._addSwitch(behavior, settings, 'suppress-notifications',
            _('Suppress notifications'), _('Hide banners and lock-screen notifications while active.'));
        this._addSwitch(behavior, settings, 'prevent-suspend',
            _('Prevent suspend'), _('Keep background workloads running while active.'));

        const advanced = new Adw.PreferencesGroup({title: _('Advanced')});
        optionsPage.add(advanced);
        this._addSwitch(advanced, settings, 'power-guard',
            _('Reassert monitor off'), _('Power displays off again after a software wake.'));
        this._addSwitch(advanced, settings, 'debug-logging', _('Debug logging'));

        this._refreshStatus(statusRow);
    }

    _addSwitch(group, settings, key, title, subtitle = '') {
        const row = new Adw.SwitchRow({title, subtitle});
        group.add(row);
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _addTime(group, settings, key, title) {
        const row = new Adw.ActionRow({title, subtitle: _('24-hour time (HH:MM)')});
        const entry = new Gtk.Entry({
            text: settings.get_string(key),
            width_chars: 6,
            max_length: 5,
            valign: Gtk.Align.CENTER,
            input_purpose: Gtk.InputPurpose.DIGITS,
        });
        const commit = () => {
            const value = entry.text.trim();
            if (!VALID_TIME.test(value)) {
                entry.add_css_class('error');
                entry.tooltip_text = _('Enter a time from 00:00 to 23:59.');
                return;
            }
            entry.remove_css_class('error');
            entry.tooltip_text = null;
            settings.set_string(key, value);
        };
        entry.connect('activate', commit);
        entry.connect('notify::has-focus', () => {
            if (!entry.has_focus)
                commit();
        });
        settings.connect(`changed::${key}`, () => {
            if (!entry.has_focus)
                entry.text = settings.get_string(key);
        });
        row.add_suffix(entry);
        row.activatable_widget = entry;
        group.add(row);
    }

    _addInteger(group, settings, key, title, subtitle, min, max, step, unit) {
        const row = new Adw.ActionRow({title, subtitle});
        const adjustment = new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: step,
            page_increment: step * 5,
            value: settings.get_int(key),
        });
        const spin = new Gtk.SpinButton({
            adjustment,
            numeric: true,
            valign: Gtk.Align.CENTER,
            width_chars: 4,
        });
        adjustment.connect('notify::value', () => {
            const value = Math.round(adjustment.value);
            if (settings.get_int(key) !== value)
                settings.set_int(key, value);
        });
        settings.connect(`changed::${key}`, () => {
            const value = settings.get_int(key);
            if (Math.round(adjustment.value) !== value)
                adjustment.value = value;
        });
        const suffix = new Gtk.Label({label: unit, valign: Gtk.Align.CENTER});
        row.add_suffix(spin);
        row.add_suffix(suffix);
        row.activatable_widget = spin;
        group.add(row);
    }

    _addAction(group, title, subtitle, method, statusRow) {
        const row = new Adw.ActionRow({title, subtitle});
        const button = new Gtk.Button({
            label: title,
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', () => {
            button.sensitive = false;
            this._call(method, null, () => {
                button.sensitive = true;
                this._refreshStatus(statusRow);
            }, error => {
                button.sensitive = true;
                statusRow.subtitle = error.message;
            });
        });
        row.add_suffix(button);
        group.add(row);
    }

    _call(method, replyType, onSuccess, onError) {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE, method,
            new GLib.Variant('()', []), replyType,
            Gio.DBusCallFlags.NONE, 2500, null, (connection, result) => {
                try {
                    onSuccess(connection.call_finish(result));
                } catch (error) {
                    onError(error);
                }
            });
    }

    _refreshStatus(row) {
        this._call('GetStatus', new GLib.VariantType('(s)'), result => {
            try {
                const status = JSON.parse(result.deep_unpack()[0]);
                if (typeof status === 'string') {
                    row.subtitle = status;
                    return;
                }
                const state = status.state ?? status.nightLock ?? _('Unknown');
                const session = status.locked === undefined ? '' :
                    (status.locked ? _(' · Session locked') : _(' · Session unlocked'));
                row.subtitle = `${state}${session}`;
            } catch (error) {
                row.subtitle = _('Status response could not be read.');
            }
        }, () => {
            row.subtitle = _('Extension is not running. Log out and back in after installation.');
        });
    }
}
