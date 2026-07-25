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
});
