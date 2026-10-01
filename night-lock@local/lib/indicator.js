import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

const NightLockToggle = GObject.registerClass(
class NightLockToggle extends QuickSettings.QuickMenuToggle {
    constructor(settings, callbacks) {
        super({
            title: 'Night Lock',
            subtitle: 'Ready',
            iconName: 'weather-clear-night-symbolic',
            toggleMode: true,
        });

        this._settings = settings;
        this._callbacks = callbacks;
        this.checked = settings.get_boolean('automatic');
        this._checkedId = this.connect('notify::checked', () => {
            if (this._settings.get_boolean('automatic') !== this.checked)
                this._settings.set_boolean('automatic', this.checked);
        });
        this._automaticId = settings.connect('changed::automatic', () => {
            const automatic = settings.get_boolean('automatic');
            if (this.checked !== automatic)
                this.checked = automatic;
        });

        this.menu.setHeader('weather-clear-night-symbolic', 'Night Lock',
            'Keep work running with the displays off');
        this._statusItem = new PopupMenu.PopupMenuItem('Ready', {reactive: false});
        this.menu.addMenuItem(this._statusItem);
        this._scheduleItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._scheduleItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Night Lock Now', () => callbacks.now());
        this.menu.addAction('Disable Tonight', () => callbacks.disableTonight());
        this._cancelItem = this.menu.addAction('Cancel Night Lock', () => callbacks.cancel());
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings…', () => callbacks.settings());
        this._startId = settings.connect('changed::start-time', () => this._updateSchedule());
        this._endId = settings.connect('changed::end-time', () => this._updateSchedule());
        this._updateSchedule();
        this.update({state: 'NORMAL'});
    }

    _updateSchedule() {
        this._scheduleItem.label.text = `Schedule  ${this._settings.get_string('start-time')} → ${this._settings.get_string('end-time')}`;
    }

    update(status) {
        const state = status?.state ?? 'NORMAL';
        let label;
        switch (state) {
        case 'NIGHT_LOCKED':
            label = 'Active · displays off';
            break;
        case 'USER_WAKE':
            label = 'Awake · session locked';
            break;
        case 'ENTERING_NIGHT_LOCK':
            label = 'Starting…';
            break;
        case 'EXITING':
            label = 'Restoring…';
            break;
        case 'ARMED':
            label = 'Armed';
            break;
        case 'ERROR':
            label = 'Error';
            break;
        default:
            label = this._settings.get_boolean('automatic') ? 'Ready' : 'Disabled';
            break;
        }
        this.subtitle = label;
        this._statusItem.label.text = label;
        this._cancelItem.sensitive = state === 'NIGHT_LOCKED' || state === 'USER_WAKE';
    }

    destroy() {
        this._settings.disconnect(this._automaticId);
        this._settings.disconnect(this._startId);
        this._settings.disconnect(this._endId);
        this.disconnect(this._checkedId);
        super.destroy();
    }
});

export const NightLockIndicator = GObject.registerClass(
class NightLockIndicator extends QuickSettings.SystemIndicator {
    constructor(gicon, settings, callbacks) {
        super();
        this._indicator = this._addIndicator();
        this._indicator.gicon = gicon;
        this._indicator.visible = settings.get_boolean('automatic');
        this._settings = settings;
        this._iconSettingsId = settings.connect('changed::automatic', () => {
            this._indicator.visible = settings.get_boolean('automatic') || this._active;
        });
        this._active = false;
        this._toggle = new NightLockToggle(settings, callbacks);
        this.quickSettingsItems.push(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this);
    }

    update(status) {
        const state = status?.state ?? 'NORMAL';
        this._active = state === 'NIGHT_LOCKED' || state === 'USER_WAKE' ||
            state === 'ENTERING_NIGHT_LOCK';
        this._indicator.visible = this._settings.get_boolean('automatic') || this._active;
        this._toggle.update(status);
    }

    destroy() {
        this._settings.disconnect(this._iconSettingsId);
        this.quickSettingsItems.forEach(item => item.destroy());
        this.quickSettingsItems.length = 0;
        super.destroy();
    }
});
