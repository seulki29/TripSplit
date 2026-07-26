const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { addMember, updateMember } = require('../../src/functions/members');

describe('members', () => {
  test('addMember requires an admin session for the trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await expect(addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' })).rejects.toThrow('FORBIDDEN');
  });

  test('addMember creates a member with default weight 1 and no exclusions', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });
    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({ name: '슬기', weight: 1, excludedCategories: [], account: null });
  });

  test('addMember stores an explicit weight and exclusion list as given', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    const { memberId } = await addMember(db, {
      sessionToken: token, tripId: 't1', name: '슬기', weight: 0.5, excludedCategories: ['식비'],
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({
      name: '슬기', weight: 0.5, excludedCategories: ['식비'], account: null,
    });
  });

  test('addMember rejects a non-numeric weight', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    // Stored as a string this makes every due/net figure in the report NaN.
    await expect(addMember(db, {
      sessionToken: token, tripId: 't1', name: '슬기', weight: 'abc',
    })).rejects.toThrow('INVALID_WEIGHT');

    const members = await db.collection('trips').doc('t1').collection('members').get();
    expect(members.docs).toHaveLength(0);
  });

  test('addMember rejects a negative weight', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await expect(addMember(db, {
      sessionToken: token, tripId: 't1', name: '슬기', weight: -1,
    })).rejects.toThrow('INVALID_WEIGHT');
  });

  test('addMember rejects excludedCategories that is not an array', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    // A truthy non-array sails through `|| []` and later crashes .includes(),
    // breaking getReportData for the entire trip.
    await expect(addMember(db, {
      sessionToken: token, tripId: 't1', name: '슬기', excludedCategories: 5,
    })).rejects.toThrow('INVALID_EXCLUDED_CATEGORIES');

    await expect(addMember(db, {
      sessionToken: token, tripId: 't1', name: '슬기', excludedCategories: '식비',
    })).rejects.toThrow('INVALID_EXCLUDED_CATEGORIES');

    const members = await db.collection('trips').doc('t1').collection('members').get();
    expect(members.docs).toHaveLength(0);
  });

  test('addMember rejects a duplicate name within the same trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await expect(addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' })).rejects.toThrow('NAME_TAKEN');
  });

  test('addMember allows the same name in a different trip', async () => {
    const db = new FakeFirestore();
    const { token: t1 } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { token: t2 } = await createSession(db, { role: 'admin', tripId: 't2' });

    await addMember(db, { sessionToken: t1, tripId: 't1', name: '슬기' });
    await expect(addMember(db, { sessionToken: t2, tripId: 't2', name: '슬기' })).resolves.toBeDefined();
  });

  test('updateMember can set a custom weight and excluded categories', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '충엽' });

    await updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { weight: 1, excludedCategories: ['식비'] },
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().excludedCategories).toEqual(['식비']);
  });

  test('updateMember rejects renaming a member to a name already used by someone else', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await addMember(db, { sessionToken: token, tripId: 't1', name: '행범' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '경건' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { name: '행범' },
    })).rejects.toThrow('NAME_TAKEN');
  });

  test('updateMember rejects renaming to an empty name', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { name: '' },
    })).rejects.toThrow('NAME_REQUIRED');
  });

  test('updateMember rejects a member id that does not exist', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId: 'ghost', patch: { weight: 2 },
    })).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  test('updateMember silently drops fields outside the allowlist', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await updateMember(db, {
      sessionToken: token,
      tripId: 't1',
      memberId,
      patch: {
        role: 'superadmin', tripId: 'another-trip', id: 'hijacked', isAdmin: true, weight: 2,
      },
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({
      name: '슬기', weight: 2, excludedCategories: [], account: null,
    });
    expect(snap.data().role).toBeUndefined();
    expect(snap.data().isAdmin).toBeUndefined();
  });

  test('updateMember rejects a non-numeric weight', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { weight: '2' },
    })).rejects.toThrow('INVALID_WEIGHT');
  });

  test('updateMember rejects a negative weight', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { weight: -1 },
    })).rejects.toThrow('INVALID_WEIGHT');
  });

  test('updateMember accepts a zero weight (a fully subsidised participant)', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { weight: 0 },
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().weight).toBe(0);
  });

  test('updateMember rejects excludedCategories that is not an array', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { excludedCategories: '식비' },
    })).rejects.toThrow('INVALID_EXCLUDED_CATEGORIES');
  });

  test('updateMember can set the account details', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await updateMember(db, {
      sessionToken: token,
      tripId: 't1',
      memberId,
      patch: { account: { bank: '국민', num: '123-456', holder: '슬기' } },
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().account).toEqual({ bank: '국민', num: '123-456', holder: '슬기' });
  });

  test('updateMember with a patch of only non-allowlisted fields is a no-op, not an empty write', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    // Everything here is dropped by the allowlist, leaving nothing to write.
    // Firestore rejects update({}), so this must short-circuit instead.
    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { role: 'admin', bogus: 1 },
    })).resolves.toEqual({ ok: true });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: {},
    })).resolves.toEqual({ ok: true });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({
      name: '슬기', weight: 1, excludedCategories: [], account: null,
    });
  });

  test('updateMember treats a missing patch as an empty patch', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId,
    })).resolves.toEqual({ ok: true });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({
      name: '슬기', weight: 1, excludedCategories: [], account: null,
    });
  });
});
