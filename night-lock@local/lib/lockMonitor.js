import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.ScreenSaver';
const OBJECT_PATH = '/org/gnome/ScreenSaver';
const INTERFACE = 'org.gnome.ScreenSaver';

export class LockMonitor {
    constructor(onChanged = () => {}) {
        this._onChanged = onChanged;
        this._connection = Gio.DBus.session;
        this._signalId = this._connection.signal_subscribe(
            BUS_NAME, INTERFACE, 'ActiveChanged', OBJECT_PATH, null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) =>
                this._onChanged(parameters.get_child_value(0).get_boolean()));
    }

    async getActive() {
        const reply = await this._call('GetActive', null, new GLib.VariantType('(b)'));
        return reply.get_child_value(0).get_boolean();
    }

    lock() {
        return this._call('Lock', null, null);
    }

    _call(method, parameters, replyType) {
        return new Promise((resolve, reject) => {
            this._connection.call(BUS_NAME, OBJECT_PATH, INTERFACE, method,
                parameters, replyType, Gio.DBusCallFlags.NONE, 3000, null,
                (bus, result) => {
                    try {
                        resolve(bus.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    destroy() {
        if (this._signalId) {
            this._connection.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
    }
}
