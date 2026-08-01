import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, MAX_EDGE } from '../imageResize.js';

describe('fitWithin', () => {
  test('the default max edge is 1024', () => {
    assert.equal(MAX_EDGE, 1024);
  });

  test('scales a landscape photo down so its long edge is exactly the max', () => {
    assert.deepEqual(fitWithin(2048, 1536, 1024), { width: 1024, height: 768 });
  });

  test('scales a portrait photo down on its height', () => {
    assert.deepEqual(fitWithin(1536, 2048, 1024), { width: 768, height: 1024 });
  });

  test('never upscales an image that already fits', () => {
    assert.deepEqual(fitWithin(800, 600, 1024), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(1024, 1024, 1024), { width: 1024, height: 1024 });
  });

  test('rounds the short edge rather than truncating it', () => {
    // 100 * 1024 / 3000 = 34.13
    assert.deepEqual(fitWithin(3000, 100, 1024), { width: 1024, height: 34 });
  });

  test('keeps the short edge at a minimum of 1px on an extreme ratio', () => {
    // 5 * 1024 / 10000 = 0.512, which must not round down to a zero-height canvas
    assert.deepEqual(fitWithin(10000, 5, 1024), { width: 1024, height: 1 });
  });

  test('defends against zero or garbage dimensions instead of returning NaN', () => {
    assert.deepEqual(fitWithin(0, 0, 1024), { width: 1, height: 1 });
    assert.deepEqual(fitWithin(NaN, NaN, 1024), { width: 1, height: 1 });
  });

  test('uses the default max edge when none is passed', () => {
    assert.deepEqual(fitWithin(4096, 4096), { width: 1024, height: 1024 });
  });
});
