const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession, requireSession, revokeTripSessions } = require('../../src/lib/sessions');

describe('sessions', () => {
  test('a freshly created session is accepted by requireSession', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'trip1' });

    const session = await requireSession(db, token, ['admin']);
    expect(session.role).toBe('admin');
    expect(session.tripId).toBe('trip1');
  });

  test('an unknown token is rejected', async () => {
    const db = new FakeFirestore();
    await expect(requireSession(db, 'not-a-real-token', ['admin'])).rejects.toThrow('UNAUTHENTICATED');
  });

  test('an expired session is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'trip1' });
    await db.collection('sessions').doc(token).update({ expiresAt: Date.now() - 1000 });

    await expect(requireSession(db, token, ['admin'])).rejects.toThrow('SESSION_EXPIRED');
  });

  test('a role not in the allow-list is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 'trip1', memberId: 'm1' });
    await expect(requireSession(db, token, ['admin'])).rejects.toThrow('FORBIDDEN');
  });

  test('a session scoped to one trip cannot act on another trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'trip1' });
    await expect(requireSession(db, token, ['admin'], 'trip2')).rejects.toThrow('FORBIDDEN');
  });

  test('a superadmin session is exempt from the trip-scope check', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    const session = await requireSession(db, token, ['superadmin'], 'trip2');
    expect(session.role).toBe('superadmin');
  });

  test('a member session scoped to one trip cannot act on another trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 'trip1', memberId: 'm1' });
    await expect(requireSession(db, token, ['member'], 'trip2')).rejects.toThrow('FORBIDDEN');
  });

  test('createSession rejects invalid roles', async () => {
    const db = new FakeFirestore();
    await expect(createSession(db, { role: 'not-a-real-role' })).rejects.toThrow('INVALID_ROLE');
  });

  test('createSession returns role, tripId, and memberId alongside the token', async () => {
    const db = new FakeFirestore();
    const result = await createSession(db, { role: 'member', tripId: 'trip1', memberId: 'm1' });
    expect(result).toEqual({
      token: result.token,
      expiresAt: result.expiresAt,
      role: 'member',
      tripId: 'trip1',
      memberId: 'm1',
    });
  });

  test('createSession returns null tripId/memberId for a superadmin session', async () => {
    const db = new FakeFirestore();
    const result = await createSession(db, { role: 'superadmin' });
    expect(result.tripId).toBeNull();
    expect(result.memberId).toBeNull();
  });

  test('stores a ttlAt Timestamp matching expiresAt for the Firestore TTL policy', async () => {
    const db = new FakeFirestore();
    const { token, expiresAt } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const stored = (await db.collection('sessions').doc(token).get()).data();
    expect(stored.ttlAt.toMillis()).toBe(expiresAt);
  });
});

describe('revokeTripSessions', () => {
  test('deletes every session for the given trip', async () => {
    const db = new FakeFirestore();
    const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 'trip1' });
    const { token: memberToken } = await createSession(db, { role: 'member', tripId: 'trip1', memberId: 'm1' });
    const { token: otherMemberToken } = await createSession(db, { role: 'member', tripId: 'trip1', memberId: 'm2' });

    await revokeTripSessions(db, 'trip1');

    for (const token of [adminToken, memberToken, otherMemberToken]) {
      await expect(requireSession(db, token, ['admin', 'member'])).rejects.toThrow('UNAUTHENTICATED');
    }
  });

  test('leaves sessions for other trips untouched', async () => {
    const db = new FakeFirestore();
    const { token: doomed } = await createSession(db, { role: 'admin', tripId: 'trip1' });
    const { token: survivor } = await createSession(db, { role: 'admin', tripId: 'trip2' });

    await revokeTripSessions(db, 'trip1');

    await expect(requireSession(db, doomed, ['admin'])).rejects.toThrow('UNAUTHENTICATED');
    await expect(requireSession(db, survivor, ['admin'], 'trip2')).resolves.toBeDefined();
  });

  test('leaves trip-less superadmin sessions untouched', async () => {
    const db = new FakeFirestore();
    const { token: superadminToken } = await createSession(db, { role: 'superadmin' });

    await revokeTripSessions(db, 'trip1');

    await expect(requireSession(db, superadminToken, ['superadmin'])).resolves.toBeDefined();
  });

  test('revoking a trip with no sessions is a no-op', async () => {
    const db = new FakeFirestore();
    await expect(revokeTripSessions(db, 'trip-with-nothing')).resolves.toBeUndefined();
  });
});
