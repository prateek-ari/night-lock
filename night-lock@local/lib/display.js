import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';
const INTERFACE = 'org.gnome.Mutter.DisplayConfig';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const X11 = GLib.getenv('XDG_SESSION_TYPE') === 'x11';
const DPMS_RECOVERY_KEY = 'x11-dpms-recovery';

function runXset(args, capture = false) {
    return new Promise((resolve, reject) => {
        let subprocess;
        try {
            const launcher = new Gio.SubprocessLauncher({flags: capture ?
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE : Gio.SubprocessFlags.STDERR_PIPE});
            launcher.setenv('LC_ALL', 'C', true);
            subprocess = launcher.spawnv(['xset', ...args]);
        } catch (error) {
            reject(error);
            return;
        }
        let timedOut = false;
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            timer = 0;
            timedOut = true;
            subprocess.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        subprocess.communicate_utf8_async(null, null, (process, result) => {
            if (timer) GLib.Source.remove(timer);
            try {
                const [, stdout, stderr] = process.communicate_utf8_finish(result);
                if (timedOut)
                    throw new Error('X11 DPMS command timed out');
                if (!process.get_successful())
                    throw new Error(`xset ${args.join(' ')} failed: ${(stderr ?? '').trim()}`);
                resolve(stdout ?? '');
            } catch (error) {
                reject(error);
            }
        });
    });
}

export function parseX11Dpms(output) {
    const timeouts = output.match(/Standby:\s*(\d+)\s+Suspend:\s*(\d+)\s+Off:\s*(\d+)/);
    const enabled = output.match(/DPMS is (Enabled|Disabled)/);
    const match = output.match(/Monitor is (On|Standby|Suspend|Off)/);
    if (!timeouts || !enabled || !match)
        throw new Error('Unable to read the X11 DPMS state and timeouts');
    const [standby, suspend, off] = timeouts.slice(1).map(Number);
    if (![standby, suspend, off].every(value =>
        Number.isSafeInteger(value) && value >= 0 && value <= 4294967295))
        throw new Error('Invalid X11 DPMS timeouts');
    return {enabled: enabled[1] === 'Enabled', standby, suspend, off,
        mode: {On: 0, Standby: 1, Suspend: 2, Off: 3}[match[1]]};
}

function readRecovery(settings) {
    if (!settings)
        return null;
    const raw = settings.get_string(DPMS_RECOVERY_KEY);
    if (!raw)
        return null;
    const saved = JSON.parse(raw);
    if (![saved.standby, saved.suspend, saved.off].every(value =>
        Number.isSafeInteger(value) && value >= 0 && value <= 4294967295))
        throw new Error('Invalid saved X11 DPMS timeouts');
    return saved;
}

// Usable by crash recovery after Shell restarts, independently of a Display
// object and its D-Bus connection. A failed restore leaves the record intact.
export async function restoreX11Dpms(settings) {
    if (!X11)
        return false;
    const saved = readRecovery(settings);
    const state = parseX11Dpms(await runXset(['q'], true));
    if (!state.enabled) {
        if (saved)
            throw new Error('Cannot restore X11 DPMS timeouts while DPMS is disabled');
        return false;
    }
    await runXset(['dpms', 'force', 'on']);
    if (!saved)
        return false;
    await runXset(['dpms', String(saved.standby), String(saved.suspend), String(saved.off)]);
    if (!settings.set_string(DPMS_RECOVERY_KEY, ''))
        throw new Error('Could not clear saved X11 DPMS timeouts');
    Gio.Settings.sync();
    return true;
}

async function getX11DpmsMode() {
    const state = parseX11Dpms(await runXset(['q'], true));
    return state.enabled ? state.mode : PowerSaveMode.UNSUPPORTED;
}

function call(connection, iface, method, parameters, replyType) {
    return new Promise((resolve, reject) => {
        connection.call(BUS_NAME, OBJECT_PATH, iface, method, parameters, replyType,
            Gio.DBusCallFlags.NONE, 3000, null, (bus, result) => {
                try {
                    resolve(bus.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export const PowerSaveMode = Object.freeze({UNSUPPORTED: -1, ON: 0, STANDBY: 1, SUSPEND: 2, OFF: 3});

export class Display {
    constructor(onMode = () => {}, onMonitors = () => {}, settings = null) {
        this._onMode = onMode;
        this._onMonitors = onMonitors;
        this._settings = settings;
        this._connection = Gio.DBus.session;
        this._pendingWrite = null;
        this._writing = false;
        this._destroyed = false;
        this._propertiesId = this._connection.signal_subscribe(
            BUS_NAME, PROPERTIES, 'PropertiesChanged', OBJECT_PATH, null,
            Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [iface, changed, invalidated] = parameters.deep_unpack();
                if (iface !== INTERFACE)
                    return;
                if (Object.hasOwn(changed, 'PowerSaveMode'))
                    this._onMode(changed.PowerSaveMode.deep_unpack());
                else if (invalidated.includes('PowerSaveMode'))
                    this.getMode().then(mode => {
                        if (!this._destroyed)
                            this._onMode(mode);
                    }).catch(error => console.error(error, '[NightLock] display property read failed'));
            });
        this._monitorsId = this._connection.signal_subscribe(
            BUS_NAME, INTERFACE, 'MonitorsChanged', OBJECT_PATH, null,
            Gio.DBusSignalFlags.NONE, () => this._onMonitors());
    }

    async getMode() {
        const reply = await call(this._connection, PROPERTIES, 'Get',
            new GLib.Variant('(ss)', [INTERFACE, 'PowerSaveMode']),
            new GLib.VariantType('(v)'));
        const mode = reply.get_child_value(0).get_variant().get_int32();
        if (!X11 || mode === PowerSaveMode.UNSUPPORTED)
            return mode;
        // An X11 client can wake DPMS without updating Mutter's cached
        // PowerSaveMode property, so inspect the X server directly as backup.
        return getX11DpmsMode();
    }

    setMode(mode) {
        if (![PowerSaveMode.ON, PowerSaveMode.STANDBY, PowerSaveMode.SUSPEND, PowerSaveMode.OFF].includes(mode))
            throw new Error(`Invalid PowerSaveMode: ${mode}`);
        return new Promise((resolve, reject) => {
            if (this._pendingWrite?.mode === mode) {
                this._pendingWrite.waiters.push({resolve, reject});
            } else {
                // A newer requested state supersedes all not-yet-started
                // writes. In particular, ON never waits behind a queue of
                // jitter/guard OFF requests. One in-flight write may finish.
                for (const waiter of this._pendingWrite?.waiters ?? [])
                    waiter.resolve(false);
                this._pendingWrite = {mode, waiters: [{resolve, reject}]};
            }
            this._drainWrites();
        });
    }

    async _drainWrites() {
        if (this._writing)
            return;
        this._writing = true;
        try {
            while (this._pendingWrite) {
                const request = this._pendingWrite;
                this._pendingWrite = null;
                try {
                    await this._writeMode(request.mode);
                    for (const waiter of request.waiters)
                        waiter.resolve(true);
                } catch (error) {
                    for (const waiter of request.waiters)
                        waiter.reject(error);
                }
            }
        } finally {
            this._writing = false;
        }
    }

    async _writeMode(mode) {
        if (X11 && mode === PowerSaveMode.OFF && !readRecovery(this._settings)) {
            if (!this._settings || !this._settings.is_writable(DPMS_RECOVERY_KEY))
                throw new Error('Cannot save original X11 DPMS timeouts');
            const original = parseX11Dpms(await runXset(['q'], true));
            if (!original.enabled)
                throw new Error('X11 DPMS is disabled');
            if (!this._settings.set_string(DPMS_RECOVERY_KEY, JSON.stringify({
                standby: original.standby, suspend: original.suspend, off: original.off,
            })))
                throw new Error('Could not save original X11 DPMS timeouts');
            Gio.Settings.sync();
        }
        const setMutter = () => call(this._connection, PROPERTIES, 'Set',
            new GLib.Variant('(ssv)', [INTERFACE, 'PowerSaveMode', new GLib.Variant('i', mode)]), null);
        if (X11 && mode === PowerSaveMode.ON) {
            let busError = null;
            try {
                await setMutter();
            } catch (error) {
                busError = error;
            }
            // Still recover the physical screen and the saved X server
            // timeouts if Shell's own D-Bus service is unavailable.
            await restoreX11Dpms(this._settings);
            if (busError)
                throw busError;
        } else {
            await setMutter();
        }
        if (X11 && mode !== PowerSaveMode.ON) {
            // A same-value D-Bus Set need not reach Mutter's X11 backend.
            // Force the X server's DPMS level even when its property is
            // already OFF. Do not invoke xset on Wayland.
            await runXset(['dpms', 'force', mode === 1 ? 'standby' :
                mode === 2 ? 'suspend' : 'off']);
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._propertiesId) {
            this._connection.signal_unsubscribe(this._propertiesId);
            this._propertiesId = 0;
        }
        if (this._monitorsId) {
            this._connection.signal_unsubscribe(this._monitorsId);
            this._monitorsId = 0;
        }
    }
}
