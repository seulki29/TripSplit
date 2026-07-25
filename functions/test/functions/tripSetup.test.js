const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { getTripSetup, updateTripSetup } = require('../../src/functions/tripSetup');

async function makeTrip(db, overrides = {}) {
  const ref = await db.collection('trips').add({
    slug: 'a', name: 'A', group: 'G', status: 'setup', adminPinHash: 'x', memberPinHash: 'y', ...overrides,
  });
  return ref;
}

describe('tripSetup', () => {
  test('getTripSetup returns trip fields without PIN hashes', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    const result = await getTripSetup(db, { sessionToken: token, tripId: tripRef.id });
    expect(result.name).toBe('A');
    expect(result.adminPinHash).toBeUndefined();
  });

  test('getTripSetup rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'admin', tripId: 'some-other-trip' });

    await expect(getTripSetup(db, { sessionToken: token, tripId: tripRef.id })).rejects.toThrow('FORBIDDEN');
  });

  test('updateTripSetup requires an admin session, not a member session', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: 'm1' });

    await expect(updateTripSetup(db, {
      sessionToken: token, tripId: tripRef.id, patch: { location: '영월' },
    })).rejects.toThrow('FORBIDDEN');
  });

  test('updateTripSetup moves status from setup to active on first save', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await updateTripSetup(db, {
      sessionToken: token,
      tripId: tripRef.id,
      patch: { period: { start: '2026-08-01', end: '2026-08-02' }, location: '영월', lodging: '동강시스타' },
    });

    const snap = await tripRef.get();
    expect(snap.data().status).toBe('active');
    expect(snap.data().location).toBe('영월');
  });

  test('updateTripSetup leaves an already-active trip active', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await updateTripSetup(db, { sessionToken: token, tripId: tripRef.id, patch: { location: '속초' } });

    const snap = await tripRef.get();
    expect(snap.data().status).toBe('active');
  });
});
