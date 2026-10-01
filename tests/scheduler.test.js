import test from 'node:test';
import assert from 'node:assert/strict';
import {isScheduleActive, scheduleSuppressed, disableUntil} from '../night-lock@local/lib/scheduler.js';

const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);

test('overnight schedule includes its start and excludes its end', () => {
    for (const [hour, minute, expected] of [
        [22, 59, false], [23, 0, true], [23, 59, true],
        [0, 0, true], [6, 59, true], [7, 0, false],
    ])
        assert.equal(isScheduleActive(at(2, hour, minute), '23:00', '07:00'), expected);
});

test('daytime schedule and zero-duration schedule', () => {
    assert.equal(isScheduleActive(at(2, 9), '09:00', '17:00'), true);
    assert.equal(isScheduleActive(at(2, 17), '09:00', '17:00'), false);
    assert.equal(isScheduleActive(at(2, 12), '09:00', '09:00'), false);
    assert.equal(disableUntil(at(2, 12), '09:00', '09:00'), Math.floor(at(2, 12).getTime() / 1000));
});

test('reject malformed times', () => {
    for (const bad of ['24:00', '7:00', '07:60', '07:00x', ''])
        assert.throws(() => isScheduleActive(at(2, 9), bad, '07:00'), RangeError);
});

test('disable tonight ends with the correct overnight occurrence', () => {
    const morningEnd = at(2, 7).getTime() / 1000;
    const tomorrowEnd = at(3, 7).getTime() / 1000;
    assert.equal(disableUntil(at(2, 2), '23:00', '07:00'), morningEnd);
    assert.equal(disableUntil(at(2, 10), '23:00', '07:00'), tomorrowEnd);
    assert.equal(disableUntil(at(2, 23), '23:00', '07:00'), tomorrowEnd);
    assert.equal(scheduleSuppressed(at(2, 6, 59), morningEnd), true);
    assert.equal(scheduleSuppressed(at(2, 7), morningEnd), false);
});

test('disable upcoming daytime schedule after its end', () => {
    assert.equal(disableUntil(at(2, 8), '09:00', '17:00'), at(2, 17).getTime() / 1000);
    assert.equal(disableUntil(at(2, 18), '09:00', '17:00'), at(3, 17).getTime() / 1000);
});

test('calendar arithmetic handles spring-forward days', () => {
    const oldTz = process.env.TZ;
    try {
        process.env.TZ = 'America/New_York';
        const spring = new Date(2026, 2, 7, 23, 30);
        const result = new Date(disableUntil(spring, '23:00', '07:00') * 1000);
        assert.equal(result.getDate(), 8);
        assert.equal(result.getHours(), 7);
        assert.equal((result - spring) / 3600000, 6.5);
    } finally {
        if (oldTz === undefined)
            delete process.env.TZ;
        else
            process.env.TZ = oldTz;
    }
});
