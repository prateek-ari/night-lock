// A one-second fixed window prevents tiny movement from accumulating overnight.
export class MotionAccumulator {
    constructor() {
        this.reset();
    }

    reset() {
        this._device = null;
        this._x = null;
        this._y = null;
        this._windowStart = null;
        this._distance = 0;
    }

    sample(device, x, y, nowMs, thresholdPx) {
        if (!Number.isFinite(x) || !Number.isFinite(y) ||
            !Number.isFinite(nowMs) || !Number.isFinite(thresholdPx) ||
            thresholdPx <= 0)
            return false;

        if (this._windowStart === null || device !== this._device ||
            nowMs < this._windowStart || nowMs - this._windowStart >= 1000) {
            this._device = device;
            this._x = x;
            this._y = y;
            this._windowStart = nowMs;
            this._distance = 0;
            return false;
        }

        this._distance += Math.hypot(x - this._x, y - this._y);
        this._x = x;
        this._y = y;
        if (this._distance < thresholdPx)
            return false;

        this.reset();
        return true;
    }
}
