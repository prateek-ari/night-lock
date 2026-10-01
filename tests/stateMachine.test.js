import test from 'node:test';
import assert from 'node:assert/strict';
import {StateMachine, State} from '../night-lock@local/lib/stateMachine.js';
import {isScheduleActive, disableUntil, scheduleSuppressed} from '../night-lock@local/lib/scheduler.js';

test('locked before start activates at start and remains dark past end', () => {
    const machine = new StateMachine();
    let locked = true;
    const schedule = (hour, minute) => isScheduleActive(new Date(2026, 9, 2, hour, minute), '23:00', '07:00');
    machine.setSchedule(schedule(22, 59));
    assert.equal(machine.state, State.NORMAL);
    machine.setSchedule(schedule(23, 0));
    if (locked && machine.state === State.ARMED) {
        machine.beginEntry();
        machine.entered();
    }
    assert.equal(machine.state, State.NIGHT_LOCKED);
    machine.setSchedule(schedule(7, 0));
    assert.equal(machine.state, State.NIGHT_LOCKED);
    locked = false;
    if (!locked) {
        machine.beginExit();
        machine.exited(schedule(7, 0));
    }
    assert.equal(machine.state, State.NORMAL);
});

test('disabled tonight prevents a scheduled entry', () => {
    const now = new Date(2026, 9, 2, 22, 0);
    const disabledUntil = disableUntil(now, '23:00', '07:00');
    const atStart = new Date(2026, 9, 2, 23, 0);
    const machine = new StateMachine();
    machine.setSchedule(isScheduleActive(atStart, '23:00', '07:00') &&
        !scheduleSuppressed(atStart, disabledUntil));
    assert.equal(machine.state, State.NORMAL);
});

test('approved input token is short and only explicit input creates it', () => {
    const machine = new StateMachine();
    assert.equal(machine.beginEntry(), true);
    assert.equal(machine.entered(), true);
    // A notification or external display-power change does not call approvedInput.
    assert.equal(machine.recentInput(100), false);
    assert.equal(machine.state, State.NIGHT_LOCKED);
    assert.equal(machine.approvedInput(100), true);
    assert.equal(machine.state, State.USER_WAKE);
    assert.equal(machine.recentInput(1099), true);
    assert.equal(machine.recentInput(1100), false);
    assert.equal(machine.recentInput(99), false);
});

test('lock-screen interaction refreshes inactivity timer and redarkening clears token', () => {
    const machine = new StateMachine();
    machine.beginEntry();
    machine.entered();
    machine.approvedInput(1000);
    assert.equal(machine.redarken(30000, 30), false);
    machine.approvedInput(30000);
    assert.equal(machine.redarken(59999, 30), false);
    assert.equal(machine.redarken(60000, 30), true);
    assert.equal(machine.state, State.NIGHT_LOCKED);
    assert.equal(machine.recentInput(60000), false);
});

test('failed entry can recover and unlock can clean up an error', () => {
    const machine = new StateMachine();
    machine.beginEntry();
    machine.fail();
    assert.equal(machine.state, State.ERROR);
    assert.equal(machine.beginEntry(), true);
    machine.fail();
    assert.equal(machine.beginExit(), true);
    assert.equal(machine.exited(true), true);
    assert.equal(machine.state, State.ARMED);
    assert.equal(machine.entered(), false);
});

test('invalid transitions do not mutate state', () => {
    const machine = new StateMachine();
    assert.equal(machine.entered(), false);
    assert.equal(machine.beginExit(), false);
    assert.equal(machine.approvedInput(10), false);
    assert.equal(machine.redarken(100, 30), false);
    assert.equal(machine.state, State.NORMAL);
});
