const { FakeFirestore } = require('../helpers/fakeFirestore');
const { hashSecret } = require('../../src/lib/hashing');
const { verifyAdminPin, verifyMemberPin } = require('../../src/functions/tripAuth');

async function makeTrip(db, overrides = {}) {
  const adminPinHash = await hashSecret('1111');
  const memberPinHash = await hashSecret('2222');
  const ref = await db.collection('trips').add({
    slug: 'sfa-2026', name: 'SFA', group: 'SFA', status: 'setup', adminPinHash, memberPinHash, ...overrides,
  });
  return ref;
}

describe('tripAuth', () => {
  test('verifyAdminPin issues an admin session for the correct PIN', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);

    const { token } = await verifyAdminPin(db, { slug: 'sfa-2026', pin: '1111' });
    const session = (await db.collection('sessions').doc(token).get()).data();
    expect(session.role).toBe('admin');
    expect(session.tripId).toBe(tripRef.id);
  });

  test('verifyAdminPin rejects the wrong PIN', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);
    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
  });

  test('verifyAdminPin rejects an unknown slug', async () => {
    const db = new FakeFirestore();
    await expect(verifyAdminPin(db, { slug: 'no-such-trip', pin: '1111' })).rejects.toThrow('TRIP_NOT_FOUND');
  });

  test('verifyMemberPin issues a member session tied to the matching member document', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const memberRef = await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    const { token } = await verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: '2222' });
    const session = (await db.collection('sessions').doc(token).get()).data();
    expect(session.role).toBe('member');
    expect(session.memberId).toBe(memberRef.id);
  });

  test('verifyMemberPin rejects a name that is not a registered member', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '모르는사람', pin: '2222' })).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  test('verifyMemberPin rejects the wrong PIN even for a real member', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
  });
});
