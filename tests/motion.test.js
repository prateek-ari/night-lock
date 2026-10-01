import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionAccumulator} from '../night-lock@local/lib/motion.js';

test('meaningful accumulated movement wakes, tiny jitter does not', () => {
    const motion = new MotionAccumulator();
    assert.equal(motion.sample('mouse', 0, 0, 0, 8), false);
    assert.equal(motion.sample('mouse', 1, 1, 100, 8), false);
    assert.equal(motion.sample('mouse', 2, 1, 200, 8), false);
    assert.equal(motion.sample('mouse', 9, 1, 300, 8), true);
    assert.equal(motion.sample('mouse', 10, 1, 400, 8), false);
});

test('jitter window and device change reset accumulated distance', () => {
    const motion = new MotionAccumulator();
    motion.sample('mouse-a', 0, 0, 0, 8);
    motion.sample('mouse-a', 5, 0, 500, 8);
    assert.equal(motion.sample('mouse-a', 6, 0, 1000, 8), false);
    assert.equal(motion.sample('mouse-a', 10, 0, 1100, 8), false);
    assert.equal(motion.sample('mouse-b', 20, 0, 1200, 8), false);
    assert.equal(motion.sample('mouse-b', 27, 0, 1300, 8), false);
    assert.equal(motion.sample('mouse-b', 28, 0, 1400, 8), true);
});

test('invalid samples cannot create a wake', () => {
    const motion = new MotionAccumulator();
    assert.equal(motion.sample('mouse', NaN, 0, 0, 8), false);
    assert.equal(motion.sample('mouse', 0, 0, 0, 0), false);
});
