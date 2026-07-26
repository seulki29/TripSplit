const { FakeFirestore } = require('../helpers/fakeFirestore');
const { hashSecret } = require('../../src/lib/hashing');
const { createSession, requireSession } = require('../../src/lib/sessions');
const {
  verifyAdminPin, verifyMemberPin, findTripBySlug, listMembersForLogin, logout,
} = require('../../src/functions/tripAuth');

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

describe('listMembersForLogin', () => {
  test('returns only id and name pairs, never weight/exclusions/account data', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const memberRef = await tripRef.collection('members').add({
      name: '슬기',
      weight: 0.5,
      excludedCategories: ['식비'],
      account: { bank: '국민', num: '123-456', holder: '슬기' },
    });

    const result = await listMembersForLogin(db, { slug: 'sfa-2026' });

    expect(result).toEqual([{ id: memberRef.id, name: '슬기' }]);
    expect(Object.keys(result[0]).sort()).toEqual(['id', 'name']);
  });

  test('returns every registered member', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });
    await tripRef.collection('members').add({ name: '행범', weight: 1, excludedCategories: [] });

    const result = await listMembersForLogin(db, { slug: 'sfa-2026' });
    expect(result.map((m) => m.name).sort()).toEqual(['슬기', '행범']);
  });

  test('returns an empty array for a trip with no members yet', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);

    await expect(listMembersForLogin(db, { slug: 'sfa-2026' })).resolves.toEqual([]);
  });

  test('rejects an unknown slug', async () => {
    const db = new FakeFirestore();
    await expect(listMembersForLogin(db, { slug: 'no-such-trip' })).rejects.toThrow('TRIP_NOT_FOUND');
  });

  test('rejects a missing slug with MISSING_FIELDS', async () => {
    const db = new FakeFirestore();
    await expect(listMembersForLogin(db, {})).rejects.toThrow('MISSING_FIELDS');
  });

  test('is throttled by the shared login throttle (20 per window)', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);

    for (let i = 0; i < 20; i += 1) {
      await expect(listMembersForLogin(db, { slug: 'sfa-2026' })).resolves.toEqual([]);
    }

    await expect(listMembersForLogin(db, { slug: 'sfa-2026' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
  });

  test('roster throttling does not consume the admin login budget for the same slug', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);

    for (let i = 0; i < 20; i += 1) {
      await listMembersForLogin(db, { slug: 'sfa-2026' });
    }
    await expect(listMembersForLogin(db, { slug: 'sfa-2026' })).rejects.toThrow('TOO_MANY_ATTEMPTS');

    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: '1111' })).resolves.toBeDefined();
  }, 30000);
});

describe('logout', () => {
  test('deletes the session so the token stops working', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await expect(requireSession(db, token, ['member'], 't1')).resolves.toBeDefined();

    await expect(logout(db, { sessionToken: token })).resolves.toEqual({ ok: true });

    await expect(requireSession(db, token, ['member'], 't1')).rejects.toThrow('UNAUTHENTICATED');
  });

  test('logging out twice does not throw', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await logout(db, { sessionToken: token });
    await expect(logout(db, { sessionToken: token })).resolves.toEqual({ ok: true });
  });

  test('a bogus or missing token is a harmless no-op', async () => {
    const db = new FakeFirestore();
    await expect(logout(db, { sessionToken: 'never-existed' })).resolves.toEqual({ ok: true });
    await expect(logout(db, {})).resolves.toEqual({ ok: true });
  });

  test('only the given session is deleted', async () => {
    const db = new FakeFirestore();
    const { token: mine } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: theirs } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm2' });

    await logout(db, { sessionToken: mine });

    await expect(requireSession(db, theirs, ['member'], 't1')).resolves.toBeDefined();
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

    // 슬기's per-name bucket is exhausted...
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: '2222' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
    // ...but the trip-wide bucket (limit 30) still has room, so another member
    // logs in normally. Both throttles apply to every attempt now.
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '행범', pin: '2222' })).resolves.toBeDefined();
    // 행범's success resets the trip-wide counter but not 슬기's own bucket.
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: '2222' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
  }, 30000);

  test('a fresh name on every request cannot bypass the member PIN throttle', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    // The attacker is guessing memberPinHash, which is shared by the whole trip.
    // Every request carries a brand-new name, so every per-name bucket sees only
    // one attempt: only the trip-wide bucket can stop this.
    const outcomes = [];
    for (let i = 0; i < 40; i += 1) {
      outcomes.push(await verifyMemberPin(db, { slug: 'sfa-2026', name: `attacker-${i}`, pin: 'wrong' })
        .then(() => 'LOGGED_IN', (err) => err.message));
    }

    expect(outcomes.slice(0, 30)).toEqual(Array(30).fill('INVALID_PIN'));
    // Attempt 31 onwards: the shared secret's guess budget is spent.
    expect(outcomes.slice(30)).toEqual(Array(10).fill('TOO_MANY_ATTEMPTS'));
  }, 60000);

  test('a correct member PIN with a bogus name does not refund the throttle budget', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    // MEMBER_NOT_FOUND is a success oracle for the PIN, so it must not reset the
    // counters — otherwise finding the PIN buys unlimited further attempts.
    for (let i = 0; i < 30; i += 1) {
      await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: `ghost-${i}`, pin: '2222' })).rejects.toThrow('MEMBER_NOT_FOUND');
    }

    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: 'ghost-30', pin: '2222' })).rejects.toThrow('TOO_MANY_ATTEMPTS');
  }, 60000);

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
