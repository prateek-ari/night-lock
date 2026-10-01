export const State = Object.freeze({
    NORMAL: 'NORMAL',
    ARMED: 'ARMED',
    ENTERING_NIGHT_LOCK: 'ENTERING_NIGHT_LOCK',
    NIGHT_LOCKED: 'NIGHT_LOCKED',
    USER_WAKE: 'USER_WAKE',
    EXITING: 'EXITING',
    ERROR: 'ERROR',
});

export class StateMachine {
    constructor() {
        this.state = State.NORMAL;
        this.lastApprovedPhysicalInput = null;
        this.lastInteraction = null;
    }

    setSchedule(active) {
        if (this.state === State.NORMAL || this.state === State.ARMED)
            this.state = active ? State.ARMED : State.NORMAL;
        return this.state;
    }

    beginEntry() {
        if (![State.NORMAL, State.ARMED, State.ERROR].includes(this.state))
            return false;
        this._clearInput();
        this.state = State.ENTERING_NIGHT_LOCK;
        return true;
    }

    entered() {
        if (this.state !== State.ENTERING_NIGHT_LOCK)
            return false;
        this.state = State.NIGHT_LOCKED;
        return true;
    }

    approvedInput(nowMs) {
        if (!Number.isFinite(nowMs) ||
            ![State.NIGHT_LOCKED, State.USER_WAKE].includes(this.state))
            return false;
        this.lastApprovedPhysicalInput = nowMs;
        this.lastInteraction = nowMs;
        this.state = State.USER_WAKE;
        return true;
    }

    recentInput(nowMs) {
        const elapsed = nowMs - this.lastApprovedPhysicalInput;
        return this.lastApprovedPhysicalInput !== null &&
            Number.isFinite(nowMs) && elapsed >= 0 && elapsed < 1000;
    }

    redarken(nowMs, timeoutSeconds) {
        if (this.state !== State.USER_WAKE ||
            !Number.isFinite(nowMs) || !Number.isFinite(timeoutSeconds) ||
            timeoutSeconds < 0 || this.lastInteraction === null ||
            nowMs - this.lastInteraction < timeoutSeconds * 1000)
            return false;
        this._clearInput();
        this.state = State.NIGHT_LOCKED;
        return true;
    }

    beginExit() {
        if (![State.ENTERING_NIGHT_LOCK, State.NIGHT_LOCKED,
            State.USER_WAKE, State.ERROR].includes(this.state))
            return false;
        this._clearInput();
        this.state = State.EXITING;
        return true;
    }

    exited(scheduleActive) {
        if (this.state !== State.EXITING)
            return false;
        this._clearInput();
        this.state = scheduleActive ? State.ARMED : State.NORMAL;
        return true;
    }

    fail() {
        this._clearInput();
        this.state = State.ERROR;
    }

    _clearInput() {
        this.lastApprovedPhysicalInput = null;
        this.lastInteraction = null;
    }
}
