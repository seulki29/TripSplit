import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute } from '../app.js';

describe('matchRoute', () => {
  test('routes /sa/<anything> to the superadmin view', () => {
    assert.deepEqual(matchRoute('/sa/9f2k7'), { view: 'superadmin', params: {} });
  });

  test('routes /t/<slug> to the trip view (login or member, resolved at runtime)', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026'), { view: 'trip', params: { slug: 'sfa-2026' } });
  });

  test('routes /t/<slug>/admin to the admin view', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026/admin'), { view: 'admin', params: { slug: 'sfa-2026' } });
  });

  test('routes /t/<slug>/report to the report view', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026/report'), { view: 'report', params: { slug: 'sfa-2026' } });
  });

  test('trailing slash on /t/<slug>/ still routes to trip', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026/'), { view: 'trip', params: { slug: 'sfa-2026' } });
  });

  test('an unrecognized path routes to notfound', () => {
    assert.deepEqual(matchRoute('/something/else'), { view: 'notfound', params: {} });
  });

  test('the bare root path routes to notfound', () => {
    assert.deepEqual(matchRoute('/'), { view: 'notfound', params: {} });
  });

  test('/sa with no trailing segment routes to notfound', () => {
    assert.deepEqual(matchRoute('/sa'), { view: 'notfound', params: {} });
  });
});
