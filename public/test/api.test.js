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
const { errorMessageFor } = await import('../errorMessages.js');

function fakeFetchOnce(status, body) {
  return mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe('errorMessageFor', () => {
  test('translates known codes to Korean and falls back for unknown', () => {
    assert.equal(errorMessageFor('INVALID_PIN'), 'PIN이 올바르지 않습니다.');
    assert.equal(errorMessageFor('TOO_MANY_ATTEMPTS'), '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.');
    assert.equal(errorMessageFor('SOMETHING_UNMAPPED'), '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
  });
});

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

  test('throws with a translated Korean message on a callable error response, preserving the raw status', async () => {
    globalThis.fetch = fakeFetchOnce(400, { error: { status: 'INVALID_ARGUMENT', message: 'INVALID_PIN' } });

    await assert.rejects(
      () => callFunction('verifyAdminPin', { slug: 'x', pin: '0000' }),
      (err) => {
        assert.equal(err.message, 'PIN이 올바르지 않습니다.');
        assert.equal(err.status, 'INVALID_ARGUMENT');
        return true;
      }
    );
  });

  test('callFunction throws a translated Korean message but preserves err.status', async () => {
    globalThis.fetch = fakeFetchOnce(400, { error: { status: 'INVALID_PIN', message: 'INVALID_PIN' } });

    await assert.rejects(
      () => callFunction('verifyAdminPin', { slug: 's', pin: '0' }),
      (err) => {
        assert.equal(err.message, 'PIN이 올바르지 않습니다.');
        assert.equal(err.status, 'INVALID_PIN');
        return true;
      }
    );
  });

  test('falls back to a generic Korean message for an unmapped domain error code', async () => {
    globalThis.fetch = fakeFetchOnce(400, { error: { status: 'FAILED_PRECONDITION', message: 'SOMETHING_UNMAPPED' } });

    await assert.rejects(
      () => callFunction('someFn', {}),
      (err) => {
        assert.equal(err.message, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
        assert.equal(err.status, 'FAILED_PRECONDITION');
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
    assert.match(url, /^http:\/\/127\.0\.0\.1:5001\/demo-sfayw\/asia-northeast3\/listTrips$/);
  });

  test('throws a clean INTERNAL error if the response body is not valid JSON', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    }));

    await assert.rejects(
      () => callFunction('someFn', {}),
      (err) => {
        assert.equal(err.status, 'INTERNAL');
        return true;
      }
    );
  });

  test('session is cleared before reload is invoked, not after', async () => {
    const { getSession } = await import('../session.js');
    setSession({ token: 'tok', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    let sessionWasClearedWhenReloadFired = null;
    globalThis.location.reload = mock.fn(() => {
      sessionWasClearedWhenReloadFired = (getSession() === null);
    });
    globalThis.fetch = fakeFetchOnce(401, { error: { status: 'UNAUTHENTICATED', message: 'x' } });

    await assert.rejects(() => callFunction('listExpenses', {}));

    assert.equal(sessionWasClearedWhenReloadFired, true);
  });

  test('handles a lowercase/mixed-case error status from the backend', async () => {
    const { getSession } = await import('../session.js');
    setSession({ token: 'tok', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    globalThis.fetch = fakeFetchOnce(401, { error: { status: 'unauthenticated', message: 'expired' } });

    await assert.rejects(
      () => callFunction('listExpenses', {}),
      (err) => {
        assert.equal(err.status, 'UNAUTHENTICATED');
        return true;
      }
    );
    assert.equal(getSession(), null);
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
