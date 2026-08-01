import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, categorySlug, categoryMark, categoryTag, categoryDot,
} from '../categories.js';

describe('categories.js', () => {
  test('the category list matches the backend list in functions/src/lib/categories.js', () => {
    // Hardcoded on purpose: the frontend (ESM) and backend (CJS) cannot share a
    // module without a build step, so this test is the drift alarm. If it fails,
    // reconcile both files -- do not just edit the expectation.
    assert.deepEqual(CATEGORIES, ['숙박', '식비', '장보기', '교통비', '놀이', '기타']);
  });

  test('every category maps to its own slug and mark colour', () => {
    assert.deepEqual(CATEGORIES.map(categorySlug),
      ['lodging', 'food', 'grocery', 'transport', 'play', 'etc']);
    assert.deepEqual(CATEGORIES.map(categoryMark),
      ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7']);
  });

  test('marks are unique -- no two categories share a colour', () => {
    const marks = CATEGORIES.map(categoryMark);
    assert.equal(new Set(marks).size, marks.length);
  });

  test('an unknown category falls back to the etc slot instead of throwing', () => {
    assert.equal(categorySlug('항공료'), 'etc');
    assert.equal(categoryMark('항공료'), '#4a3aa7');
    assert.equal(categorySlug(undefined), 'etc');
  });

  test('categoryTag emits a tag carrying the slug as a data attribute', () => {
    assert.equal(categoryTag('식비'), '<span class="tag" data-cat="food">식비</span>');
  });

  test('categoryTag escapes the label so stored data cannot inject markup', () => {
    assert.equal(categoryTag('<img src=x>'),
      '<span class="tag" data-cat="etc">&lt;img src=x&gt;</span>');
  });

  test('categoryDot emits a dot carrying the mark colour', () => {
    assert.equal(categoryDot('숙박'), '<span class="cat-dot" style="background:#2a78d6"></span>');
  });
});
