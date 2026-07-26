import { test, describe, mock, beforeEach } from 'node:test';
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
globalThis.location = { hostname: 'localhost', href: '', reload: mock.fn() };

const { setSession } = await import('../session.js');
const { callFunction } = await import('../api.js');

function fakeFetchOnce(status, body) {
  return mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe('callFunction', () => {
  beforeEach(() => {
    globalThis.localStorage = makeFakeLocalStorage();
    globalThis.location.reload.mock.resetCalls();
  });

  test('returns the result on success', async () => {
    globalThis.fetch = fakeFetchOnce(200, { result: { tripId: 't1' } });
    const result = await callFunction('createTrip', { name: 'X' });
    assert.deepEqual(result, { tripId: 't1' });
  });

  test('attaches sessionToken from the stored session automatically', async () => {
    setSession({ token: 'tok123', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    const fetchMock = fakeFetchOnce(200, { result: { ok: true } });
    globalThis.fetch = fetchMock;

    await callFunction('updateTripSetup', { patch: { location: '속초' } });

    const [, options] = fetchMock.mock.calls[0].arguments;
    const sentBody = JSON.parse(options.body);
    assert.equal(sentBody.data.sessionToken, 'tok123');
    assert.equal(sentBody.data.patch.location, '속초');
  });

  test('does not overwrite an explicitly-provided sessionToken', async () => {
    setSession({ token: 'stored-token', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    const fetchMock = fakeFetchOnce(200, { result: { ok: true } });
    globalThis.fetch = fetchMock;

    await callFunction('someFn', { sessionToken: 'explicit-token' });

    const [, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(JSON.parse(options.body).data.sessionToken, 'explicit-token');
  });

  test('throws with the domain error message and status on a callable error response', async () => {
    globalThis.fetch = fakeFetchOnce(400, { error: { status: 'INVALID_ARGUMENT', message: 'INVALID_PIN' } });

    await assert.rejects(
      () => callFunction('verifyAdminPin', { slug: 'x', pin: '0000' }),
      (err) => {
        assert.equal(err.message, 'INVALID_PIN');
        assert.equal(err.status, 'INVALID_ARGUMENT');
        return true;
      }
    );
  });

  test('clears the session and reloads on UNAUTHENTICATED', async () => {
    setSession({ token: 'expired-tok', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    globalThis.fetch = fakeFetchOnce(401, { error: { status: 'UNAUTHENTICATED', message: 'SESSION_EXPIRED' } });

    await assert.rejects(() => callFunction('listExpenses', {}));

    const { getSession } = await import('../session.js');
    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });

  test('clears the session and reloads on PERMISSION_DENIED', async () => {
    setSession({ token: 'tok', expiresAt: Date.now() + 100000, role: 'member', tripId: 't1', tripSlug: 'sfa-2026', memberId: 'm1' });
    globalThis.fetch = fakeFetchOnce(403, { error: { status: 'PERMISSION_DENIED', message: 'FORBIDDEN' } });

    await assert.rejects(() => callFunction('updateExpense', {}));

    const { getSession } = await import('../session.js');
    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });

  test('uses the local emulator URL when hostname is localhost', async () => {
    const fetchMock = fakeFetchOnce(200, { result: {} });
    globalThis.fetch = fetchMock;
    await callFunction('listTrips', {});
    const [url] = fetchMock.mock.calls[0].arguments;
    assert.match(url, /^http:\/\/127\.0\.0\.1:5001\/demo-sfayw\/us-central1\/listTrips$/);
  });
});

describe('logout', () => {
  beforeEach(() => {
    globalThis.localStorage = makeFakeLocalStorage();
    globalThis.location.reload.mock.resetCalls();
  });

  test('calls the logout function, clears the session, and reloads', async () => {
    const { setSession, getSession } = await import('../session.js');
    setSession({ token: 'tok', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    globalThis.fetch = fakeFetchOnce(200, { result: { ok: true } });

    const { logout } = await import('../api.js');
    await logout();

    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });

  test('still clears the session and reloads even if the logout call itself fails', async () => {
    const { setSession, getSession } = await import('../session.js');
    setSession({ token: 'already-expired', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    globalThis.fetch = mock.fn(async () => { throw new Error('network down'); });

    const { logout } = await import('../api.js');
    await logout();

    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });
});
