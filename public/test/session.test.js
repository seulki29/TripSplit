import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

globalThis.localStorage = makeFakeLocalStorage();
const { getSession, setSession, clearSession } = await import('../session.js');

describe('session.js', () => {
  beforeEach(() => {
    globalThis.localStorage = makeFakeLocalStorage();
  });

  test('getSession returns null when nothing is stored', () => {
    assert.equal(getSession(), null);
  });

  test('setSession then getSession round-trips', () => {
    const session = { token: 'abc', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null };
    setSession(session);
    assert.deepEqual(getSession(), session);
  });

  test('getSession returns null and clears storage for an expired session', () => {
    setSession({ token: 'abc', expiresAt: Date.now() - 1000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    assert.equal(getSession(), null);
    assert.equal(localStorage.getItem('sfayw_session'), null);
  });

  test('getSession returns null for unparsable stored data', () => {
    localStorage.setItem('sfayw_session', 'not json');
    assert.equal(getSession(), null);
  });

  test('clearSession removes the stored session', () => {
    setSession({ token: 'abc', expiresAt: Date.now() + 100000, role: 'member', tripId: 't1', tripSlug: 'sfa-2026', memberId: 'm1' });
    clearSession();
    assert.equal(getSession(), null);
  });
});
