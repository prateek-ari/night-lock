import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import {log} from './logger.js';

export class SleepInhibitor {
    constructor() {
        this._stream = null;
    }

    get active() {
        return this._stream !== null;
    }

    acquire() {
        if (this._stream)
            return;
        const [reply, fdList] = Gio.DBus.system.call_with_unix_fd_list_sync(
            'org.freedesktop.login1', '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager', 'Inhibit',
            new GLib.Variant('(ssss)', [
                'sleep', 'Night Lock', 'Night Lock: background jobs are running', 'block',
            ]), new GLib.VariantType('(h)'), Gio.DBusCallFlags.NONE, 5000, null, null);
        const handle = reply.get_child_value(0).get_handle();
        // get() duplicates the FD while the list retains its original. Steal
        // the original so closing our stream immediately releases the lease.
        const fds = fdList.steal_fds();
        if (handle < 0 || handle >= fds.length) {
            for (const fd of fds)
                new GioUnix.InputStream({fd, close_fd: true}).close(null);
            throw new Error('login1 returned an invalid inhibitor FD handle');
        }
        for (let index = 0; index < fds.length; index++) {
            const stream = new GioUnix.InputStream({fd: fds[index], close_fd: true});
            if (index === handle)
                this._stream = stream;
            else
                stream.close(null);
        }
        log('sleep inhibitor acquired');
    }

    release() {
        if (!this._stream)
            return;
        const stream = this._stream;
        this._stream = null;
        stream.close(null);
        log('sleep inhibitor released');
    }
}
