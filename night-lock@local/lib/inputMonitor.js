import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {MotionAccumulator} from './motion.js';

// This listens to Shell's local input stream, including while its own lock
// screen is shown. No key code or character is read or retained.
export class InputMonitor {
    constructor(settings, onApproved = () => {}, onUnapproved = () => {}) {
        this._settings = settings;
        this._onApproved = onApproved;
        this._onUnapproved = onUnapproved;
        this._signalId = 0;
        this._lastUnapproved = -Infinity;
        this.reset();
    }

    start() {
        if (!this._signalId)
            this._signalId = global.stage.connect('captured-event', (_stage, event) => this._onEvent(event));
    }

    stop() {
        if (this._signalId) {
            global.stage.disconnect(this._signalId);
            this._signalId = 0;
        }
        this.reset();
    }

    reset() {
        this._motion = new MotionAccumulator();
    }

    _onEvent(event) {
        this._approvedThisEvent = false;
        const type = event.type();
        const mayWakeX11 = [Clutter.EventType.KEY_PRESS, Clutter.EventType.KEY_RELEASE,
            Clutter.EventType.BUTTON_PRESS, Clutter.EventType.BUTTON_RELEASE,
            Clutter.EventType.MOTION, Clutter.EventType.SCROLL,
            Clutter.EventType.TOUCH_BEGIN, Clutter.EventType.TOUCH_UPDATE,
            Clutter.EventType.TOUCHPAD_SWIPE, Clutter.EventType.TOUCHPAD_PINCH,
            Clutter.EventType.TOUCHPAD_HOLD].includes(type);
        const flags = event.get_flags();
        if (flags & (Clutter.EventFlags.FLAG_SYNTHETIC |
                     Clutter.EventFlags.FLAG_INPUT_METHOD |
                     Clutter.EventFlags.FLAG_POINTER_EMULATED)) {
            if (mayWakeX11)
                this._reject();
            return false;
        }

        // On X11, XInput's source device is the physical slave device. The
        // logical master and XTEST devices cannot grant the wake token.
        const device = event.get_source_device?.() ?? event.get_device?.();
        if (!device || device.get_device_mode?.() !== Clutter.InputMode.PHYSICAL) {
            if (mayWakeX11)
                this._reject();
            return false;
        }
        const name = device.get_device_name?.() ?? '';
        if (/xtest|virtual|uinput|ydotool|remote/i.test(name)) {
            if (mayWakeX11)
                this._reject();
            return false;
        }

        const kind = device.get_device_type();
        if (type === Clutter.EventType.KEY_PRESS &&
            kind === Clutter.InputDeviceType.KEYBOARD_DEVICE &&
            this._settings.get_boolean('wake-keyboard')) {
            this._approve('keyboard');
        } else if (type === Clutter.EventType.BUTTON_PRESS &&
                   kind === Clutter.InputDeviceType.POINTER_DEVICE &&
                   this._settings.get_boolean('wake-mouse-button')) {
            this._approve('mouse button');
        } else if (type === Clutter.EventType.MOTION &&
                   kind === Clutter.InputDeviceType.POINTER_DEVICE &&
                   this._settings.get_boolean('wake-mouse-movement')) {
            this._motionEvent(event, device, 'mouse movement');
        } else if (kind === Clutter.InputDeviceType.TOUCHPAD_DEVICE &&
                   this._settings.get_boolean('wake-touchpad')) {
            if (type === Clutter.EventType.MOTION)
                this._motionEvent(event, device, 'touchpad');
            else if ([Clutter.EventType.TOUCHPAD_SWIPE,
                      Clutter.EventType.TOUCHPAD_PINCH,
                      Clutter.EventType.TOUCHPAD_HOLD,
                      Clutter.EventType.BUTTON_PRESS].includes(type))
                this._approve('touchpad');
        } else if (kind === Clutter.InputDeviceType.TOUCHSCREEN_DEVICE &&
                   type === Clutter.EventType.TOUCH_BEGIN &&
                   this._settings.get_boolean('wake-touchscreen')) {
            this._approve('touchscreen');
        }
        if (mayWakeX11 && !this._approvedThisEvent)
            this._reject();
        return false;
    }

    _motionEvent(event, device, reason) {
        const [x, y] = event.get_coords();
        const now = GLib.get_monotonic_time() / 1000;
        if (this._motion.sample(device, x, y, now,
            this._settings.get_int('motion-threshold')))
            this._approve(reason);
    }

    _approve(reason) {
        this._approvedThisEvent = true;
        this._onApproved(reason);
    }

    _reject() {
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastUnapproved < 250)
            return;
        this._lastUnapproved = now;
        this._onUnapproved();
    }
}
