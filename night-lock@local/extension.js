import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Display} from './lib/display.js';
import {LockMonitor} from './lib/lockMonitor.js';
import {NotificationManager} from './lib/notificationManager.js';
import {SleepInhibitor} from './lib/sleepInhibitor.js';
import {InputMonitor} from './lib/inputMonitor.js';
import {NightLockIndicator} from './lib/indicator.js';
import {State, StateMachine} from './lib/stateMachine.js';
import {isScheduleActive, scheduleSuppressed, disableUntil} from './lib/scheduler.js';
import {configure, log, debug} from './lib/logger.js';

const BUS = 'org.gnome.Shell.Extensions.NightLock';
const PATH = '/org/gnome/Shell/Extensions/NightLock';
const XML = `<node><interface name="${BUS}">
<method name="GetStatus"><arg type="s" direction="out"/></method>
<method name="Now"/><method name="Cancel"/><method name="DisableTonight"/>
<method name="Enable"/><method name="Disable"/>
</interface></node>`;
const ACTIVE = [State.ENTERING_NIGHT_LOCK, State.NIGHT_LOCKED, State.USER_WAKE];
const monotonic = () => GLib.get_monotonic_time() / 1000;

export default class NightLock extends Extension {
    enable() {
        this._running = true;
        this._generation = (this._generation ?? 0) + 1;
        this._epoch = {};
        this._ready = false;
        this._manualRequested = false;
        this._skipLock = false;
        this._machine = new StateMachine();
        this._settings = this.getSettings();
        configure(this._settings);
        this._notifications = new NotificationManager(this._settings);
        this._inhibitor = new SleepInhibitor();
        this._display = new Display(mode => this._onPower(mode), () => this._reassert('monitor configuration changed'), this._settings);
        this._input = new InputMonitor(this._settings, kind => this._approved(kind),
            () => this._reassert('unapproved local input'));
        this._lock = new LockMonitor(active => this._onLock(active));
        this._settingsId = this._settings.connect('changed', (_settings, key) => {
            if (['last-error', 'recovery-state', 'recovery-active', 'x11-dpms-recovery'].includes(key))
                return;
            this._safe(() => this._tick());
        });
        this._modeId = Main.sessionMode.connect('updated', () => this._updateUI());
        this._shieldId = Main.screenShield.connect('locked-changed', () => this._onLock(Main.screenShield.locked));
        this._shutdownId = global.connect('shutdown', () => this.disable());
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, {
            GetStatus: () => JSON.stringify(this._status()),
            Now: () => this._safe(() => this._now()),
            Cancel: () => this._safe(() => this._cancel()),
            DisableTonight: () => this._safe(() => this._disableTonight()),
            Enable: () => this._settings.set_boolean('automatic', true),
            Disable: () => this._safe(() => { this._settings.set_boolean('automatic', false); this._cancel(); }),
        });
        this._dbus.export(Gio.DBus.session, PATH);
        this._busId = Gio.bus_own_name_on_connection(Gio.DBus.session, BUS, Gio.BusNameOwnerFlags.NONE, null, null);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._safe(() => this._tick());
            return this._running ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        this._updateUI();
        const epoch = this._epoch;
        this._startup().catch(error => {
            if (this._running && epoch === this._epoch)
                this._error(error);
        });
    }

    async _startup() {
        const epoch = this._epoch;
        // Subscribe first, query second; consult Shell's actual auth lock before
        // acting on an ActiveChanged/GetActive value (blanking is not locking).
        await this._lock.getActive();
        if (!this._running || epoch !== this._epoch)
            return;
        const stale = this._settings.get_boolean('recovery-active') ||
            this._settings.get_string('x11-dpms-recovery') !== '';
        const resume = this._settings.get_boolean('recovery-active') && Main.screenShield.locked;
        if (resume) {
            this._ready = true;
            log('recovering locked Night Lock session');
            this._enter();
        } else {
            this._notifications.restore();
            if (stale)
                await this._display.setMode(0);
            if (!this._running || epoch !== this._epoch)
                return;
            this._settings.set_boolean('recovery-active', false);
            Gio.Settings.sync();
            this._ready = true;
            this._tick();
        }
    }

    _schedule() {
        const now = new Date();
        return this._settings.get_boolean('automatic') &&
            !scheduleSuppressed(now, Number(this._settings.get_int64('disabled-until'))) &&
            isScheduleActive(now, this._settings.get_string('start-time'), this._settings.get_string('end-time'));
    }

    _tick() {
        if (!this._running || !this._ready)
            return;
        const previous = this._machine.state;
        const scheduled = this._schedule();
        this._machine.setSchedule(scheduled);
        if (previous !== this._machine.state)
            log(scheduled ? 'schedule armed' : 'schedule inactive');
        if (this._machine.state === State.USER_WAKE &&
            this._machine.redarken(monotonic(), this._settings.get_int('redarken-seconds'))) {
            this._input.reset();
            log('lock-screen inactivity; re-darkening');
            this._powerOff();
        }
        if ([State.NORMAL, State.ARMED].includes(this._machine.state) &&
            Main.screenShield.locked && !this._skipLock &&
            (this._manualRequested || (scheduled && this._settings.get_boolean('activate-when-locked'))))
            this._enter();
        if (this._machine.state === State.NIGHT_LOCKED && this._settings.get_boolean('power-guard')) {
            // PropertiesChanged is primary. This catches a lost signal/invalidation.
            const second = Math.floor(monotonic() / (GLib.getenv('XDG_SESSION_TYPE') === 'x11' ? 1000 : 5000));
            if (second !== this._reconcileSecond) {
                this._reconcileSecond = second;
                const generation = this._generation;
                this._display.getMode().then(mode => {
                    if (this._running && generation === this._generation)
                        this._onPower(mode);
                }).catch(error => {
                    if (this._running && generation === this._generation)
                        this._error(error);
                });
            }
        }
        this._updateUI();
    }

    _onLock(active) {
        if (!this._running || !this._ready)
            return;
        this._safe(() => {
            if (!Main.screenShield.locked) {
                log('session unlocked');
                this._manualRequested = false;
                this._skipLock = false;
                this._exit();
            } else if (active) {
                log('session locked');
                this._tick();
            }
        });
    }

    async _enter() {
        if (!this._running || !this._ready || !Main.screenShield.locked || !this._machine.beginEntry())
            return;
        const generation = ++this._generation;
        try {
            const mode = await this._display.getMode();
            if (!this._running || generation !== this._generation || !Main.screenShield.locked)
                return;
            if (mode === -1)
                throw new Error('Mutter reports monitor power saving unsupported. Keeping the ordinary GNOME lock; Night Lock is unavailable on this display backend.');
            if (!this._settings.set_boolean('recovery-active', true))
                throw new Error('Could not persist Night Lock recovery state');
            Gio.Settings.sync();
            if (this._settings.get_boolean('prevent-suspend'))
                this._inhibitor.acquire();
            if (this._settings.get_boolean('suppress-notifications'))
                this._notifications.suppress();
            this._input.start();
            this._machine.entered();
            this._settings.set_string('last-error', '');
            this._powerOff();
            this._updateUI();
        } catch (error) {
            if (this._running && generation === this._generation)
                this._error(error);
        }
    }

    _powerOff() {
        const generation = this._generation;
        this._display.setMode(3).then(applied => {
            if (applied && this._running && generation === this._generation && this._machine.state === State.NIGHT_LOCKED)
                debug('displays OFF');
        }).catch(error => {
            if (this._running && generation === this._generation)
                this._error(error);
        });
    }

    _reassert(reason) {
        if (this._running && this._machine.state === State.NIGHT_LOCKED) {
            debug(reason);
            this._powerOff();
        }
    }

    _onPower(mode) {
        if (!this._running || this._machine.state !== State.NIGHT_LOCKED || !this._settings.get_boolean('power-guard'))
            return;
        if (mode === -1) {
            this._error(new Error('Monitor power saving became unsupported. Night Lock cancelled.'));
        } else if (mode !== 3) {
            // Only InputMonitor can mint the token. Notification/session-idle
            // signals and D-Bus callers never mint it.
            if (mode === 0 && this._machine.recentInput(monotonic()))
                this._approved('recent local input');
            else {
                log('ignored non-user display wake');
                this._powerOff();
            }
        }
    }

    _approved(kind) {
        if (!this._running)
            return false;
        const waking = this._machine.state === State.NIGHT_LOCKED;
        if (!this._machine.approvedInput(monotonic()))
            return false;
        debug(`approved ${kind} activity`);
        if (waking) {
            log('approved local activity; display ON, session remains locked');
            const generation = this._generation;
            this._display.setMode(0).catch(error => {
                if (this._running && generation === this._generation)
                    this._error(error);
            });
            this._updateUI();
        }
        return waking;
    }

    async _now() {
        if (!this._ready)
            return;
        const generation = this._generation;
        this._skipLock = false;
        this._manualRequested = true;
        if (Main.screenShield.locked) {
            this._enter();
            return;
        }
        try {
            await this._lock.lock();
            if (this._running && generation === this._generation && this._manualRequested && !Main.screenShield.locked)
                throw new Error('GNOME did not establish an authentication lock. Night Lock was not activated.');
        } catch (error) {
            if (this._running && generation === this._generation)
                this._error(error);
        }
    }

    _cancel() {
        this._manualRequested = false;
        // Latch cancellation even if a pending normal Lock request has not
        // reached locked-changed yet. Clear only on a later genuine unlock.
        this._skipLock = true;
        this._exit();
    }

    _disableTonight() {
        this._settings.set_int64('disabled-until', disableUntil(new Date(),
            this._settings.get_string('start-time'), this._settings.get_string('end-time')));
        this._cancel();
        this._tick();
    }

    _exit() {
        ++this._generation;
        if (!this._machine.beginExit()) {
            this._machine.setSchedule(this._schedule());
            this._updateUI();
            return;
        }
        this._cleanup();
        this._machine.exited(this._schedule());
        this._updateUI();
    }

    _cleanup() {
        const epoch = this._epoch;
        const generation = this._generation;
        const settings = this._settings;
        const needsDisplayRecovery = settings.get_boolean('recovery-active') ||
            settings.get_string('x11-dpms-recovery') !== '';
        this._input?.stop();
        try { this._inhibitor?.release(); } catch (error) { log(`inhibitor release failed: ${error.message}`); }
        let restored = false;
        try {
            this._notifications?.restore();
            restored = true;
        } catch (error) {
            log(`settings recovery failed: ${error.message}; recovery record retained`);
        }
        if (!needsDisplayRecovery) {
            log('Night Lock resources released');
            return;
        }
        this._display?.setMode(0).then(applied => {
            // Keep the write-ahead recovery marker until the actual final ON
            // write succeeds. A newer entry/enable owns its own recovery state.
            if (applied && restored && epoch === this._epoch && generation === this._generation) {
                settings.set_boolean('recovery-active', false);
                Gio.Settings.sync();
            }
        }).catch(error => log(`display recovery failed: ${error.message}; recovery record retained`));
        log('Night Lock resources released');
    }

    _safe(action) {
        try { return action(); } catch (error) { this._error(error); }
    }

    _error(error) {
        if (!this._running)
            return;
        ++this._generation;
        this._skipLock = Main.screenShield.locked;
        this._manualRequested = false;
        this._machine.fail();
        this._settings.set_string('last-error', error.message);
        log(`ERROR: ${error.message}`);
        this._cleanup();
        this._updateUI();
    }

    _status() {
        return {
            state: this._machine.state, locked: Main.screenShield.locked,
            automatic: this._settings.get_boolean('automatic'),
            schedule: `${this._settings.get_string('start-time')}–${this._settings.get_string('end-time')}`,
            scheduleActive: this._safeSchedule(),
            disabledUntil: Number(this._settings.get_int64('disabled-until')),
            lastError: this._settings.get_string('last-error'),
            sessionType: GLib.getenv('XDG_SESSION_TYPE') ?? 'unknown',
        };
    }
    _safeSchedule() { try { return this._schedule(); } catch { return false; } }

    _updateUI() {
        if (!this._running)
            return;
        const userMode = Main.sessionMode.currentMode !== 'unlock-dialog' &&
            (Main.sessionMode.currentMode === 'user' || Main.sessionMode.parentMode === 'user');
        if (!userMode) {
            this._indicator?.destroy();
            this._indicator = null;
            return;
        }
        if (!this._indicator) {
            const gicon = new Gio.FileIcon({file: this.dir.get_child('icons').get_child('night-lock-symbolic.svg')});
            this._indicator = new NightLockIndicator(gicon, this._settings, {
                now: () => this._safe(() => this._now()),
                disableTonight: () => this._safe(() => this._disableTonight()),
                cancel: () => this._safe(() => this._cancel()),
                settings: () => this.openPreferences(),
            });
        }
        this._indicator.update(this._status());
    }

    disable() {
        if (!this._running)
            return;
        this._running = false;
        ++this._generation;
        if (this._timer) { GLib.Source.remove(this._timer); this._timer = 0; }
        if (this._settingsId) this._settings.disconnect(this._settingsId);
        if (this._modeId) Main.sessionMode.disconnect(this._modeId);
        if (this._shieldId) Main.screenShield.disconnect(this._shieldId);
        if (this._shutdownId) global.disconnect(this._shutdownId);
        this._settingsId = this._modeId = this._shieldId = this._shutdownId = 0;
        this._dbus?.unexport();
        if (this._busId) { Gio.bus_unown_name(this._busId); this._busId = 0; }
        this._cleanup();
        this._lock?.destroy();
        this._display?.destroy();
        this._indicator?.destroy();
        this._indicator = null;
        configure(null);
    }
}
