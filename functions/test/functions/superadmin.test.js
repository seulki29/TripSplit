const { FakeFirestore } = require('../helpers/fakeFirestore');
const { hashSecret } = require('../../src/lib/hashing');
const { createSession } = require('../../src/lib/sessions');
const {
  verifySuperadminPassword, createTrip, listTrips, updateTrip, archiveTrip,
} = require('../../src/functions/superadmin');

describe('superadmin functions', () => {
  test('verifySuperadminPassword issues a session for the correct password', async () => {
    const db = new FakeFirestore();
    const hash = await hashSecret('20112988sk!');

    const { token } = await verifySuperadminPassword(db, hash, { password: '20112988sk!' });
    expect(typeof token).toBe('string');
  });

  test('verifySuperadminPassword rejects the wrong password', async () => {
    const db = new FakeFirestore();
    const hash = await hashSecret('20112988sk!');
    await expect(verifySuperadminPassword(db, hash, { password: 'wrong' })).rejects.toThrow('INVALID_PASSWORD');
  });

  test('repeated wrong superadmin passwords eventually throw TOO_MANY_ATTEMPTS', async () => {
    const db = new FakeFirestore();
    const hash = await hashSecret('20112988sk!');

    for (let i = 0; i < 10; i += 1) {
      await expect(verifySuperadminPassword(db, hash, { password: 'wrong' })).rejects.toThrow('INVALID_PASSWORD');
    }

    await expect(verifySuperadminPassword(db, hash, { password: 'wrong' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
    // The correct password is locked out too while the window is open.
    await expect(verifySuperadminPassword(db, hash, { password: '20112988sk!' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
  }, 30000);

  test('a successful superadmin login resets the attempt counter', async () => {
    const db = new FakeFirestore();
    const hash = await hashSecret('20112988sk!');

    for (let i = 0; i < 9; i += 1) {
      await expect(verifySuperadminPassword(db, hash, { password: 'wrong' })).rejects.toThrow('INVALID_PASSWORD');
    }

    await expect(verifySuperadminPassword(db, hash, { password: '20112988sk!' })).resolves.toBeDefined();

    // Without the reset the counter would already be at 10 and this would be TOO_MANY_ATTEMPTS.
    await expect(verifySuperadminPassword(db, hash, { password: 'wrong' })).rejects.toThrow('INVALID_PASSWORD');
  }, 30000);

  test('createTrip requires a superadmin session', async () => {
    const db = new FakeFirestore();
    await expect(createTrip(db, {
      sessionToken: 'nope', name: 'x', slug: 'x', group: 'g', adminPin: '1111', memberPin: '2222',
    })).rejects.toThrow('UNAUTHENTICATED');
  });

  test('createTrip creates a trip in setup status with hashed PINs', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });

    const { tripId } = await createTrip(db, {
      sessionToken: token, name: 'SFA 2026', slug: 'sfa-2026', group: 'SFA', adminPin: '1111', memberPin: '2222',
    });

    const snap = await db.collection('trips').doc(tripId).get();
    const trip = snap.data();
    expect(trip.status).toBe('setup');
    expect(trip.adminPinHash).not.toBe('1111');
    expect(trip.memberPinHash).not.toBe('2222');
  });

  test('createTrip rejects a duplicate slug', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'dup', group: 'G', adminPin: '1111', memberPin: '2222',
    });

    await expect(createTrip(db, {
      sessionToken: token, name: 'B', slug: 'dup', group: 'G', adminPin: '3333', memberPin: '4444',
    })).rejects.toThrow('SLUG_TAKEN');
  });

  test('listTrips requires a superadmin session', async () => {
    const db = new FakeFirestore();
    await expect(listTrips(db, {
      sessionToken: 'nope',
    })).rejects.toThrow('UNAUTHENTICATED');
  });

  test('listTrips never exposes PIN hashes', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'a', group: 'G', adminPin: '1111', memberPin: '2222',
    });

    const trips = await listTrips(db, { sessionToken: token });
    expect(trips).toHaveLength(1);
    expect(trips[0].adminPinHash).toBeUndefined();
    expect(trips[0].memberPinHash).toBeUndefined();
  });

  test('updateTrip requires a superadmin session', async () => {
    const db = new FakeFirestore();
    await expect(updateTrip(db, {
      sessionToken: 'nope', tripId: 'x', patch: { name: 'y' },
    })).rejects.toThrow('UNAUTHENTICATED');
  });

  test('updateTrip re-hashes a new admin PIN instead of storing it raw', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    const { tripId } = await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'a', group: 'G', adminPin: '1111', memberPin: '2222',
    });

    await updateTrip(db, { sessionToken: token, tripId, patch: { adminPin: '9999' } });

    const snap = await db.collection('trips').doc(tripId).get();
    expect(snap.data().adminPinHash).not.toBe('9999');
    expect(snap.data().adminPin).toBeUndefined();
  });

  test('archiveTrip requires a superadmin session', async () => {
    const db = new FakeFirestore();
    await expect(archiveTrip(db, {
      sessionToken: 'nope', tripId: 'x',
    })).rejects.toThrow('UNAUTHENTICATED');
  });

  test('archiveTrip removes the trip and its members subcollection', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    const { tripId } = await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'a', group: 'G', adminPin: '1111', memberPin: '2222',
    });
    await db.collection('trips').doc(tripId).collection('members').doc('m1').set({ name: 'X' });

    await archiveTrip(db, { sessionToken: token, tripId });

    const snap = await db.collection('trips').doc(tripId).get();
    expect(snap.exists).toBe(false);

    const memberSnap = await db.collection('trips').doc(tripId).collection('members').doc('m1').get();
    expect(memberSnap.exists).toBe(false);
  });
});
