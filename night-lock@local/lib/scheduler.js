// Pure local-time schedule calculations. Date's local calendar operations handle
// midnight and daylight-saving changes without assuming a 24-hour day.

function minutesOfDay(value) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
        throw new RangeError(`Invalid time: ${value}`);
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function localEnd(date, minutes, nextDay) {
    const end = new Date(date.getTime());
    end.setHours(0, 0, 0, 0);
    if (nextDay)
        end.setDate(end.getDate() + 1);
    end.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return end;
}

export function isScheduleActive(date, start, end) {
    const from = minutesOfDay(start);
    const until = minutesOfDay(end);
    if (from === until)
        return false;

    const now = date.getHours() * 60 + date.getMinutes();
    return from < until
        ? now >= from && now < until
        : now >= from || now < until;
}

export function scheduleSuppressed(date, disabledUntilSeconds) {
    return Number.isFinite(disabledUntilSeconds) &&
        date.getTime() / 1000 < disabledUntilSeconds;
}

// Suppress the active schedule, or the next occurrence when outside it.
// A zero-duration schedule has no interval to suppress.
export function disableUntil(date, start, end) {
    const from = minutesOfDay(start);
    const until = minutesOfDay(end);
    if (from === until)
        return Math.floor(date.getTime() / 1000);

    const now = date.getHours() * 60 + date.getMinutes();
    const endIsTomorrow = now >= until;
    return Math.floor(localEnd(date, until, endIsTomorrow).getTime() / 1000);
}
