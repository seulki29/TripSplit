const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession, requireSession } = require('../../src/lib/sessions');

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
});
