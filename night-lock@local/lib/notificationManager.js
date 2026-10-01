import Gio from 'gi://Gio';
import {log} from './logger.js';

const DESKTOP_SCHEMA = 'org.gnome.desktop.notifications';
const RECOVERY_KEY = 'recovery-state';

export class NotificationManager {
    constructor(extensionSettings) {
        this._extensionSettings = extensionSettings;
        this._notifications = new Gio.Settings({schema_id: DESKTOP_SCHEMA});
    }

    get hasRecovery() {
        return this._extensionSettings.get_string(RECOVERY_KEY) !== '';
    }

    suppress() {
        for (const key of ['show-banners', 'show-in-lock-screen']) {
            if (!this._notifications.is_writable(key))
                throw new Error(`Notification setting ${key} cannot be changed`);
        }
        if (!this._extensionSettings.is_writable(RECOVERY_KEY))
            throw new Error('Notification recovery state cannot be saved');
        if (!this.hasRecovery) {
            const snapshot = {
                showBanners: this._notifications.get_boolean('show-banners'),
                showInLockScreen: this._notifications.get_boolean('show-in-lock-screen'),
                showBannersUser: this._notifications.get_user_value('show-banners')?.get_boolean() ?? null,
                showInLockScreenUser: this._notifications.get_user_value('show-in-lock-screen')?.get_boolean() ?? null,
            };
            if (!this._extensionSettings.set_string(RECOVERY_KEY, JSON.stringify(snapshot)))
                throw new Error('Could not save notification recovery state');
            Gio.Settings.sync();
        }
        if (!this._notifications.set_boolean('show-banners', false) ||
            !this._notifications.set_boolean('show-in-lock-screen', false))
            throw new Error('Could not suppress lock-screen notifications');
        Gio.Settings.sync();
        log('notifications suppressed');
    }

    restore() {
        const raw = this._extensionSettings.get_string(RECOVERY_KEY);
        if (!raw)
            return;
        const snapshot = JSON.parse(raw);
        if (typeof snapshot.showBanners !== 'boolean' || typeof snapshot.showInLockScreen !== 'boolean')
            throw new Error('Invalid Night Lock notification recovery state');
        for (const key of ['show-banners', 'show-in-lock-screen']) {
            if (!this._notifications.is_writable(key))
                throw new Error(`Notification setting ${key} cannot be restored`);
        }
        const restoreKey = (key, value, userValue) => {
            if (userValue === null) {
                this._notifications.reset(key);
                if (this._notifications.get_user_value(key) !== null)
                    throw new Error(`Could not reset notification setting ${key}`);
            } else if (!this._notifications.set_boolean(key, userValue ?? value)) {
                throw new Error(`Could not restore notification setting ${key}`);
            }
        };
        restoreKey('show-banners', snapshot.showBanners, snapshot.showBannersUser);
        restoreKey('show-in-lock-screen', snapshot.showInLockScreen, snapshot.showInLockScreenUser);
        Gio.Settings.sync();
        if (!this._extensionSettings.set_string(RECOVERY_KEY, ''))
            throw new Error('Could not clear notification recovery state');
        Gio.Settings.sync();
        log('notification settings restored');
    }
}
