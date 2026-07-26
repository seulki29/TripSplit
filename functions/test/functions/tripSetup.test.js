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

  test('updateTripSetup ignores disallowed fields like status or PIN hashes in patch', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active', adminPinHash: 'original-hash' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await updateTripSetup(db, {
      sessionToken: token,
      tripId: tripRef.id,
      patch: { status: 'setup', adminPinHash: 'attacker-value', location: '속초' },
    });

    const snap = await tripRef.get();
    expect(snap.data().status).toBe('active');
    expect(snap.data().adminPinHash).toBe('original-hash');
    expect(snap.data().location).toBe('속초');
  });

  test('updateTripSetup treats a missing patch as an empty patch instead of crashing', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active', location: '영월', lodging: '동강시스타' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });
    const before = (await tripRef.get()).data();

    await expect(updateTripSetup(db, {
      sessionToken: token, tripId: tripRef.id, patch: undefined,
    })).resolves.toEqual({ ok: true });

    expect((await tripRef.get()).data()).toEqual(before);
  });

  test('a patch-less save on a setup trip still performs the documented first-save status flip', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await updateTripSetup(db, { sessionToken: token, tripId: tripRef.id });

    expect((await tripRef.get()).data().status).toBe('active');
  });

  test('updateTripSetup rejects a trip that does not exist', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'ghost' });

    await expect(updateTripSetup(db, {
      sessionToken: token, tripId: 'ghost', patch: { location: '영월' },
    })).rejects.toThrow('TRIP_NOT_FOUND');
  });
});
