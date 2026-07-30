const { FakeFirestore } = require('../helpers/fakeFirestore');
const { requireTripEditable } = require('../../src/lib/tripStatus');

describe('requireTripEditable', () => {
  test('passes when the trip is active', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'active' });
    await expect(requireTripEditable(db, 't1')).resolves.toBeUndefined();
  });

  test('passes when the trip is in setup', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'setup' });
    await expect(requireTripEditable(db, 't1')).resolves.toBeUndefined();
  });

  test('throws TRIP_COMPLETED when the trip is completed', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'completed' });
    await expect(requireTripEditable(db, 't1')).rejects.toThrow('TRIP_COMPLETED');
  });

  test('treats a missing trip doc as editable (callers do their own TRIP_NOT_FOUND check)', async () => {
    const db = new FakeFirestore();
    await expect(requireTripEditable(db, 'nope')).resolves.toBeUndefined();
  });
});
