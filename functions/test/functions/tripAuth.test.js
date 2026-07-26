const { FakeFirestore } = require('../helpers/fakeFirestore');
const { hashSecret } = require('../../src/lib/hashing');
const { verifyAdminPin, verifyMemberPin, findTripBySlug } = require('../../src/functions/tripAuth');

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
    expect(session.tripId).toBe(tripRef.id);
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

  test('verifyAdminPin rejects a missing slug with MISSING_FIELDS, not a TypeError', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);
    await expect(verifyAdminPin(db, { slug: undefined, pin: '1111' })).rejects.toThrow('MISSING_FIELDS');
  });

  test('verifyMemberPin rejects a missing slug or name with MISSING_FIELDS', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);
    await expect(verifyMemberPin(db, { name: '슬기', pin: '2222' })).rejects.toThrow('MISSING_FIELDS');
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', pin: '2222' })).rejects.toThrow('MISSING_FIELDS');
  });

  test('findTripBySlug rejects a missing slug with MISSING_FIELDS', async () => {
    const db = new FakeFirestore();
    await expect(findTripBySlug(db, undefined)).rejects.toThrow('MISSING_FIELDS');
  });
});

describe('tripAuth login throttling', () => {
  test('repeated wrong admin PINs eventually throw TOO_MANY_ATTEMPTS instead of INVALID_PIN', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);

    for (let i = 0; i < 10; i += 1) {
      await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
    }

    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
    // Even the correct PIN is locked out while the window is open.
    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: '1111' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
  }, 30000);

  test('a successful admin login resets the attempt counter', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);

    for (let i = 0; i < 9; i += 1) {
      await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
    }

    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: '1111' })).resolves.toBeDefined();

    // Without the reset the counter would already be at 10 and this would be TOO_MANY_ATTEMPTS.
    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
  }, 30000);

  test('admin throttling is scoped per trip slug', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);
    await makeTrip(db, { slug: 'other-trip' });

    for (let i = 0; i < 10; i += 1) {
      await verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' }).catch(() => {});
    }

    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
    await expect(verifyAdminPin(db, { slug: 'other-trip', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
  }, 30000);

  test('repeated wrong member PINs eventually throw TOO_MANY_ATTEMPTS', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    for (let i = 0; i < 10; i += 1) {
      await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
    }

    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: 'wrong' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
  }, 30000);

  test('member throttling is scoped per member name, so one member cannot lock out another', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });
    await tripRef.collection('members').add({ name: '행범', weight: 1, excludedCategories: [] });

    for (let i = 0; i < 10; i += 1) {
      await verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: 'wrong' }).catch(() => {});
    }

    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: '2222' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '행범', pin: '2222' })).resolves.toBeDefined();
  }, 30000);

  test('a successful member login resets the attempt counter', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    for (let i = 0; i < 9; i += 1) {
      await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
    }

    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: '2222' })).resolves.toBeDefined();
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
  }, 30000);
});
