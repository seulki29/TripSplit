const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { getTripSetup, updateTripSetup, setTripStatus } = require('../../src/functions/tripSetup');
const { addMember } = require('../../src/functions/members');
const { addExpense } = require('../../src/functions/expenses');

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

  test('updateTripSetup with a patch of only non-allowlisted fields is a no-op, not an empty write', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active', location: '영월', lodging: '동강시스타' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });
    const before = (await tripRef.get()).data();

    // The trip is already active, so there is no status flip to write either:
    // the update map is empty and Firestore rejects update({}).
    await expect(updateTripSetup(db, {
      sessionToken: token, tripId: tripRef.id, patch: { status: 'setup', slug: 'stolen' },
    })).resolves.toEqual({ ok: true });

    await expect(updateTripSetup(db, {
      sessionToken: token, tripId: tripRef.id, patch: {},
    })).resolves.toEqual({ ok: true });

    expect((await tripRef.get()).data()).toEqual(before);
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

describe('setTripStatus + edit-lock', () => {
  test('setTripStatus requires an admin session', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active' });
    const { token } = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: 'm1' });
    await expect(setTripStatus(db, { sessionToken: token, tripId: tripRef.id, status: 'completed' }))
      .rejects.toThrow('FORBIDDEN');
  });

  test('setTripStatus flips active <-> completed', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await setTripStatus(db, { sessionToken: token, tripId: tripRef.id, status: 'completed' });
    expect((await db.collection('trips').doc(tripRef.id).get()).data().status).toBe('completed');

    await setTripStatus(db, { sessionToken: token, tripId: tripRef.id, status: 'active' });
    expect((await db.collection('trips').doc(tripRef.id).get()).data().status).toBe('active');
  });

  test('setTripStatus rejects an invalid status', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });
    await expect(setTripStatus(db, { sessionToken: token, tripId: tripRef.id, status: 'setup' }))
      .rejects.toThrow('INVALID_STATUS');
  });

  test('setTripStatus rejects a missing trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'ghost' });
    await expect(setTripStatus(db, { sessionToken: token, tripId: 'ghost', status: 'completed' }))
      .rejects.toThrow('TRIP_NOT_FOUND');
  });

  test('a completed trip blocks addExpense and addMember', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'completed' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await expect(addMember(db, { sessionToken: token, tripId: tripRef.id, name: '슬기' }))
      .rejects.toThrow('TRIP_COMPLETED');
    await expect(addExpense(db, {
      sessionToken: token, tripId: tripRef.id, enteredBy: 'm1', category: '식비', amount: 1000,
    })).rejects.toThrow('TRIP_COMPLETED');
  });

  test('an active trip allows addMember (guard passes)', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: tripRef.id, name: '슬기' });
    expect(memberId).toBeTruthy();
  });
});
