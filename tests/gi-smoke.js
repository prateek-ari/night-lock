import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Display, parseX11Dpms} from '../night-lock@local/lib/display.js';
import {LockMonitor} from '../night-lock@local/lib/lockMonitor.js';
import {NotificationManager} from '../night-lock@local/lib/notificationManager.js';
import {SleepInhibitor} from '../night-lock@local/lib/sleepInhibitor.js';
import {InputMonitor} from '../night-lock@local/lib/inputMonitor.js';

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
    throw new Error('Run this test with GSETTINGS_BACKEND=memory');

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function inhibitorCount() {
    const process = Gio.Subprocess.new(['systemd-inhibit', '--list', '--no-pager'],
        Gio.SubprocessFlags.STDOUT_PIPE);
    const [ok, output] = process.communicate_utf8(null, null);
    assert(ok && process.get_successful(), 'Could not list inhibitors');
    return output.split('\n').filter(line => line.includes('Night Lock')).length;
}

const extension = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.night-lock'});
const dpms = parseX11Dpms(`DPMS (Display Power Management Signaling):
  Standby: 300    Suspend: 600    Off: 900
  DPMS is Enabled
  Monitor is Off`);
assert(dpms.enabled && dpms.standby === 300 && dpms.suspend === 600 &&
    dpms.off === 900 && dpms.mode === 3, 'X11 DPMS parser failed');
const desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
const notifications = new NotificationManager(extension);
for (const key of ['show-banners', 'show-in-lock-screen'])
    desktop.reset(key);
const defaults = [desktop.get_boolean('show-banners'),
    desktop.get_boolean('show-in-lock-screen')];
notifications.suppress();
assert(notifications.hasRecovery && !desktop.get_boolean('show-banners') &&
    !desktop.get_boolean('show-in-lock-screen'), 'Notifications were not suppressed');
// Simulate a new extension instance recovering after a crash.
new NotificationManager(extension).restore();
assert(!notifications.hasRecovery, 'Recovery record was not cleared');
for (const [index, key] of ['show-banners', 'show-in-lock-screen'].entries()) {
    assert(desktop.get_user_value(key) === null,
        `${key}: a schema default became an explicit override`);
    assert(desktop.get_boolean(key) === defaults[index], `${key}: wrong default restored`);
}
desktop.set_boolean('show-banners', false);
desktop.set_boolean('show-in-lock-screen', true);
notifications.suppress();
notifications.restore();
assert(desktop.get_user_value('show-banners')?.get_boolean() === false &&
    desktop.get_user_value('show-in-lock-screen')?.get_boolean() === true,
    'Explicit notification values were not restored');

const display = new Display();
const lock = new LockMonitor();
try {
    assert([-1, 0, 1, 2, 3].includes(await display.getMode()), 'Invalid display mode');
    assert(typeof await lock.getActive() === 'boolean', 'Invalid lock state');
    assert(typeof InputMonitor === 'function', 'Input monitor failed to import');
} finally {
    display.destroy();
    lock.destroy();
}

const before = inhibitorCount();
const inhibitor = new SleepInhibitor();
try {
    inhibitor.acquire();
    assert(inhibitorCount() === before + 1, 'Inhibitor was not acquired');
} finally {
    inhibitor.release();
}
assert(inhibitorCount() === before, 'Inhibitor FD was not released immediately');
print('Night Lock GJS/GIO smoke checks passed');
