const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const {
  addMember, updateMember, listMembers, setMemberSettled,
} = require('../../src/functions/members');

describe('members', () => {
  test('addMember requires an admin session for the trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await expect(addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' })).rejects.toThrow('FORBIDDEN');
  });

  test('addMember creates a member with default weight 1 and unsettled', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });
    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({
      name: '슬기', weight: 1, account: null, settled: false,
    });
  });

  test('addMember stores a provided account and defaults it to null', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    const withAccount = await addMember(db, {
      sessionToken: token, tripId: 't1', name: '슬기', account: '우리 1111-22',
    });
    const a = await db.collection('trips').doc('t1').collection('members').doc(withAccount.memberId).get();
    expect(a.data().account).toBe('우리 1111-22');

    const noAccount = await addMember(db, { sessionToken: token, tripId: 't1', name: '민수' });
    const b = await db.collection('trips').doc('t1').collection('members').doc(noAccount.memberId).get();
    expect(b.data().account).toBeNull();
  });

  test('addMember stores an explicit weight as given', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    const { memberId } = await addMember(db, {
      sessionToken: token, tripId: 't1', name: '슬기', weight: 0.5,
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({
      name: '슬기', weight: 0.5, account: null, settled: false,
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

  test('updateMember can set a custom weight', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '충엽' });

    await updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { weight: 1 },
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().weight).toEqual(1);
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
      name: '슬기', weight: 2, account: null, settled: false,
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
      name: '슬기', weight: 1, account: null, settled: false,
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
      name: '슬기', weight: 1, account: null, settled: false,
    });
  });

  test('listMembers returns full member records for an admin session', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기', weight: 1.5 });

    const result = await listMembers(db, { sessionToken: token, tripId: 't1' });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('슬기');
    expect(result[0].weight).toBe(1.5);
    expect(result[0].settled).toBe(false);
    expect(result[0].id).toBeDefined();
  });

  test('listMembers requires an admin session, not a member session', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await expect(listMembers(db, { sessionToken: token, tripId: 't1' })).rejects.toThrow('FORBIDDEN');
  });

  test('listMembers rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'other-trip' });
    await expect(listMembers(db, { sessionToken: token, tripId: 't1' })).rejects.toThrow('FORBIDDEN');
  });
});

describe('setMemberSettled', () => {
  test('marks a member settled and unsettled (admin)', async () => {
    const db = new FakeFirestore();
    const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: adminToken, tripId: 't1', name: '슬기' });

    await setMemberSettled(db, {
      sessionToken: adminToken, tripId: 't1', memberId, settled: true,
    });
    let snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().settled).toBe(true);

    await setMemberSettled(db, {
      sessionToken: adminToken, tripId: 't1', memberId, settled: false,
    });
    snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().settled).toBe(false);
  });

  test('rejects MEMBER_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 't1' });

    await expect(setMemberSettled(db, {
      sessionToken: adminToken, tripId: 't1', memberId: 'nope', settled: true,
    })).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  test('rejects a non-admin session', async () => {
    const db = new FakeFirestore();
    const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: adminToken, tripId: 't1', name: '슬기' });
    const { token: memberToken } = await createSession(db, { role: 'member', tripId: 't1', memberId });

    await expect(setMemberSettled(db, {
      sessionToken: memberToken, tripId: 't1', memberId, settled: true,
    })).rejects.toThrow();
  });
});
