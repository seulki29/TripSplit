const { FakeFirestore } = require('../helpers/fakeFirestore');
const { listPublicTrips } = require('../../src/functions/publicTrips');

describe('listPublicTrips', () => {
  test('requires no session and returns only public-safe fields', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').add({
      name: 'SFA 2026',
      slug: 'sfa-2026',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-08-01', end: '2026-08-05' },
      location: '부산',
      adminPinHash: 'x',
      memberPinHash: 'y',
      createdAt: 100,
    });

    const result = await listPublicTrips(db, {});
    expect(result).toEqual([{
      name: 'SFA 2026',
      slug: 'sfa-2026',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-08-01', end: '2026-08-05' },
      location: '부산',
    }]);
  });

  test('includes setup-status trips (not just active/completed)', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').add({
      name: 'New Trip', slug: 'new-trip', group: 'G', status: 'setup', period: { start: null, end: null }, location: '', createdAt: 100,
    });

    const result = await listPublicTrips(db, {});
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('setup');
  });

  test('sorts newest-first by createdAt', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').add({
      name: 'Old', slug: 'old', group: 'G', status: 'active', period: {}, location: '', createdAt: 100,
    });
    await db.collection('trips').add({
      name: 'New', slug: 'new', group: 'G', status: 'active', period: {}, location: '', createdAt: 200,
    });

    const result = await listPublicTrips(db, {});
    expect(result.map((t) => t.slug)).toEqual(['new', 'old']);
  });

  test('returns an empty array when there are no trips', async () => {
    const db = new FakeFirestore();
    await expect(listPublicTrips(db, {})).resolves.toEqual([]);
  });
});
