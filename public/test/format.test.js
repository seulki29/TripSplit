import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from '../format.js';

describe('formatDate', () => {
  test('drops the year and renders month.day', () => {
    assert.equal(formatDate('2026-07-30'), '7.30');
  });

  test('strips leading zeros from both month and day', () => {
    assert.equal(formatDate('2026-07-05'), '7.5');
    assert.equal(formatDate('2026-01-01'), '1.1');
  });

  test('keeps two-digit months and days intact', () => {
    assert.equal(formatDate('2026-12-25'), '12.25');
  });

  test('returns an empty string for falsy input', () => {
    assert.equal(formatDate(''), '');
    assert.equal(formatDate(null), '');
    assert.equal(formatDate(undefined), '');
  });

  test('passes through anything that is not a YYYY-MM-DD date', () => {
    assert.equal(formatDate('30/07/2026'), '30/07/2026');
    assert.equal(formatDate('2026-7-3'), '2026-7-3');
  });
});
