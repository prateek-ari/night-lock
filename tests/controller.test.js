import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {State, StateMachine} from '../night-lock@local/lib/stateMachine.js';

// Exercise the actual extension controller with its GNOME imports replaced by
// tiny fakes. This runs async transitions without loading a Shell process.
const source = readFileSync(new URL('../night-lock@local/extension.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace('export default class NightLock', 'class NightLock') +
    '\nglobalThis.TestNightLock = NightLock;';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}

function fixture() {
    let nowMs = 10_000;
    const counters = {suppress: 0, restore: 0, acquire: 0, release: 0,
        start: 0, stop: 0, modes: []};
    const values = new Map([
        ['automatic', false], ['activate-when-locked', true],
        ['suppress-notifications', true], ['prevent-suspend', true],
        ['recovery-active', false], ['recovery-state', ''], ['x11-dpms-recovery', ''],
        ['start-time', '23:00'], ['end-time', '07:00'],
        ['disabled-until', 0], ['redarken-seconds', 30],
        ['power-guard', true], ['last-error', ''],
    ]);
    const settings = {
        get_boolean: key => values.get(key),
        get_string: key => values.get(key),
        get_int: key => values.get(key),
        get_int64: key => values.get(key),
        set_boolean: (key, value) => values.set(key, value),
        set_string: (key, value) => values.set(key, value),
        set_int64: (key, value) => values.set(key, value),
    };
    const Main = {screenShield: {locked: true}};
    const context = {
        Extension: class {}, Main, State, StateMachine,
        Gio: {Settings: {sync() {}}},
        GLib: {get_monotonic_time: () => nowMs * 1000, getenv: () => 'x11'},
        isScheduleActive: () => false, scheduleSuppressed: () => false,
        disableUntil: () => 0, log() {}, debug() {},
    };
    runInNewContext(source, context, {filename: 'extension.js'});
    const controller = new context.TestNightLock();
    controller._running = true;
    controller._generation = 0;
    controller._epoch = {};
    controller._ready = true;
    controller._manualRequested = false;
    controller._skipLock = false;
    controller._machine = new StateMachine();
    controller._settings = settings;
    controller._notifications = {
        hasRecovery: false,
        suppress: () => counters.suppress++,
        restore: () => counters.restore++,
    };
    controller._inhibitor = {
        acquire: () => counters.acquire++,
        release: () => counters.release++,
    };
    controller._input = {
        start: () => counters.start++,
        stop: () => counters.stop++,
        reset() {},
    };
    controller._display = {
        getMode: () => Promise.resolve(0),
        setMode: mode => { counters.modes.push(mode); return Promise.resolve(true); },
    };
    controller._lock = {getActive: () => Promise.resolve(true)};
    controller._updateUI = () => {};
    return {controller, Main, counters, values,
        setNow: value => { nowMs = value; }};
}

test('cancel during pending display read cannot commit an entry', async () => {
    const {controller, counters, values} = fixture();
    const mode = deferred();
    controller._display.getMode = () => mode.promise;
    const entering = controller._enter();
    assert.equal(controller._machine.state, State.ENTERING_NIGHT_LOCK);
    controller._cancel();
    assert.equal(controller._machine.state, State.NORMAL);
    mode.resolve(0);
    await entering;
    assert.equal(counters.suppress, 0);
    assert.equal(counters.acquire, 0);
    assert.equal(counters.start, 0);
    assert.deepEqual(counters.modes, []);
    assert.equal(values.get('recovery-active'), false);
});

test('unlock during pending display read leaves no Night Lock resources', async () => {
    const {controller, Main, counters} = fixture();
    const mode = deferred();
    controller._display.getMode = () => mode.promise;
    const entering = controller._enter();
    Main.screenShield.locked = false;
    controller._onLock(false);
    mode.resolve(0);
    await entering;
    assert.equal(controller._machine.state, State.NORMAL);
    assert.equal(counters.suppress, 0);
    assert.equal(counters.acquire, 0);
    assert.equal(counters.start, 0);
});

test('startup query gates lock signals and resumes stale locked state without notification restore', async () => {
    const {controller, counters, values} = fixture();
    const query = deferred();
    controller._lock.getActive = () => query.promise;
    controller._ready = false;
    values.set('recovery-active', true);
    controller._notifications.hasRecovery = true;
    const startup = controller._startup();
    controller._onLock(true);
    controller._tick();
    await controller._enter();
    assert.equal(controller._machine.state, State.NORMAL);
    query.resolve(true);
    await startup;
    await Promise.resolve();
    assert.equal(controller._ready, true);
    assert.equal(counters.restore, 0);
    assert.equal(counters.suppress, 1);
    assert.equal(controller._machine.state, State.NIGHT_LOCKED);
});

test('unlocked startup recovery waits for display ON before admitting new work', async () => {
    const {controller, Main, counters, values} = fixture();
    const on = deferred();
    Main.screenShield.locked = false;
    controller._ready = false;
    values.set('recovery-active', true);
    controller._notifications.hasRecovery = true;
    controller._display.setMode = () => on.promise;
    const startup = controller._startup();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(counters.restore, 1);
    assert.equal(controller._ready, false);
    assert.equal(values.get('recovery-active'), true);
    controller._onLock(false);
    assert.equal(controller._machine.state, State.NORMAL);
    on.resolve(true);
    await startup;
    assert.equal(controller._ready, true);
    assert.equal(values.get('recovery-active'), false);
});

test('an unsupported display backend enters error without retaining resources', async () => {
    const {controller, counters, values} = fixture();
    controller._display.getMode = () => Promise.resolve(-1);
    await controller._enter();
    assert.equal(controller._machine.state, State.ERROR);
    assert.equal(counters.suppress, 0);
    assert.equal(counters.acquire, 0);
    assert.equal(values.get('recovery-active'), false);
    assert.match(values.get('last-error'), /unsupported/);
});

test('cancel latches across a pending Lock reply and later lock signal', async () => {
    const {controller, Main, counters, values} = fixture();
    const lock = deferred();
    Main.screenShield.locked = false;
    controller._lock.lock = () => lock.promise;
    controller._schedule = () => true;
    const requesting = controller._now();
    assert.equal(controller._manualRequested, true);
    controller._cancel();
    assert.equal(controller._skipLock, true);
    Main.screenShield.locked = true;
    controller._onLock(true);
    lock.resolve();
    await requesting;
    assert.equal(controller._machine.state, State.ARMED);
    assert.equal(counters.suppress, 0);
    assert.equal(values.get('last-error'), '');
    Main.screenShield.locked = false;
    controller._onLock(false);
    assert.equal(controller._skipLock, false);
});

test('a rejected stale Lock request after cancel does not put controller in ERROR', async () => {
    const {controller, Main, values} = fixture();
    const lock = deferred();
    Main.screenShield.locked = false;
    controller._lock.lock = () => lock.promise;
    const requesting = controller._now();
    controller._cancel();
    lock.reject(new Error('stale Lock request failed'));
    await requesting;
    assert.equal(controller._machine.state, State.NORMAL);
    assert.equal(values.get('last-error'), '');
});

test('recovery marker is retained until display ON succeeds', async () => {
    const {controller, values} = fixture();
    const on = deferred();
    values.set('recovery-active', true);
    controller._display.setMode = () => on.promise;
    controller._machine.beginEntry();
    controller._machine.entered();
    controller._exit();
    assert.equal(values.get('recovery-active'), true);
    on.resolve(true);
    await on.promise;
    await Promise.resolve();
    assert.equal(values.get('recovery-active'), false);
});

test('old enable lifetime cannot clear a newer recovery marker', async () => {
    const {controller, values} = fixture();
    const on = deferred();
    values.set('recovery-active', true);
    controller._display.setMode = () => on.promise;
    controller._cleanup();
    controller._epoch = {}; // Simulate a new enable on the same extension object.
    on.resolve(true);
    await on.promise;
    await Promise.resolve();
    assert.equal(values.get('recovery-active'), true);
});

test('unapproved display ON is reasserted OFF without granting a wake token', () => {
    const {controller, counters} = fixture();
    controller._machine.beginEntry();
    controller._machine.entered();
    controller._onPower(0);
    assert.equal(controller._machine.state, State.NIGHT_LOCKED);
    assert.equal(controller._machine.lastApprovedPhysicalInput, null);
    assert.deepEqual(counters.modes, [3]);
});

test('approved wake, inactivity re-darken, and unlock perform the full cleanup', () => {
    const {controller, Main, counters, setNow, values} = fixture();
    controller._machine.beginEntry();
    controller._machine.entered();
    values.set('recovery-active', true);
    assert.equal(controller._approved('keyboard'), true);
    assert.equal(controller._machine.state, State.USER_WAKE);
    assert.deepEqual(counters.modes, [0]);
    controller._onPower(0);
    assert.deepEqual(counters.modes, [0]);
    values.set('power-guard', false); // Keep this test focused on inactivity.
    setNow(39_999);
    controller._tick();
    assert.equal(controller._machine.state, State.USER_WAKE);
    setNow(40_000);
    controller._tick();
    assert.equal(controller._machine.state, State.NIGHT_LOCKED);
    assert.deepEqual(counters.modes, [0, 3]);
    Main.screenShield.locked = false;
    controller._onLock(false);
    assert.equal(controller._machine.state, State.NORMAL);
    assert.deepEqual(counters.modes, [0, 3, 0]);
    assert.equal(counters.stop, 1);
    assert.equal(counters.release, 1);
    assert.equal(counters.restore, 1);
});
