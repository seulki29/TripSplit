const { FakeFirestore } = require('../helpers/fakeFirestore');
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { createSession } = require('../../src/lib/sessions');
const {
  listExpenses, addExpense, updateExpense, deleteExpense, confirmExpense,
  setExpenseExclusions, setExpenseWaypoint,
} = require('../../src/functions/expenses');

describe('expenses', () => {
  test('a member adding an expense is always attributed to themselves', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000, enteredBy: 'someone-else',
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().enteredBy).toBe('m1');
    expect(snap.data().recordedBy).toBe('member');
    expect(snap.data().confirmed).toBe(false);
  });

  test('an admin adding an expense must supply a valid enteredBy member', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await db.collection('trips').doc('t1').collection('members').doc('m1').set({ name: 'X' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '숙박', amount: 200000, enteredBy: 'm1',
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().enteredBy).toBe('m1');
    expect(snap.data().recordedBy).toBe('admin');
  });

  test('an admin adding an expense for an unknown member is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await expect(addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '숙박', amount: 1000, enteredBy: 'ghost',
    })).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  test('an invalid category is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await expect(addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '해외여행', amount: 1000,
    })).rejects.toThrow('INVALID_CATEGORY');
  });

  test('a member can edit their own unconfirmed expense', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await updateExpense(db, { sessionToken: token, tripId: 't1', expenseId, patch: { amount: 12000 } });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().amount).toBe(12000);
  });

  test('a member cannot edit someone else\'s expense', async () => {
    const db = new FakeFirestore();
    const { token: mine } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: theirs } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm2' });
    const { expenseId } = await addExpense(db, {
      sessionToken: mine, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(updateExpense(db, {
      sessionToken: theirs, tripId: 't1', expenseId, patch: { amount: 1 },
    })).rejects.toThrow('FORBIDDEN');
  });

  test('a member cannot edit their own expense once it is confirmed', async () => {
    const db = new FakeFirestore();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: admin } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });
    await confirmExpense(db, {
      sessionToken: admin, tripId: 't1', expenseId, confirmed: true,
    });

    await expect(updateExpense(db, {
      sessionToken: member, tripId: 't1', expenseId, patch: { amount: 1 },
    })).rejects.toThrow('EXPENSE_LOCKED');
  });

  test('an admin can edit any expense regardless of who entered it or confirmation state', async () => {
    const db = new FakeFirestore();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: admin } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });
    await confirmExpense(db, { sessionToken: admin, tripId: 't1', expenseId, confirmed: true });

    await updateExpense(db, { sessionToken: admin, tripId: 't1', expenseId, patch: { amount: 9999 } });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().amount).toBe(9999);
  });

  test('confirmExpense requires an admin session', async () => {
    const db = new FakeFirestore();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(confirmExpense(db, {
      sessionToken: member, tripId: 't1', expenseId, confirmed: true,
    })).rejects.toThrow('FORBIDDEN');
  });

  test('listExpenses returns every expense in the trip with its id', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await addExpense(db, { sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 1000 });
    await addExpense(db, { sessionToken: token, tripId: 't1', date: '2026-08-02', category: '교통비', amount: 2000 });

    const result = await listExpenses(db, { sessionToken: token, tripId: 't1' });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBeDefined();
  });

  test('a member cannot self-confirm their own expense via updateExpense patch', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await updateExpense(db, { sessionToken: token, tripId: 't1', expenseId, patch: { confirmed: true } });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().confirmed).toBe(false);
  });

  test('updateExpense rejects an invalid amount in patch', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(updateExpense(db, {
      sessionToken: token, tripId: 't1', expenseId, patch: { amount: -500 },
    })).rejects.toThrow('INVALID_AMOUNT');
  });

  test('updateExpense treats a missing patch as an empty patch instead of crashing', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(updateExpense(db, {
      sessionToken: token, tripId: 't1', expenseId, patch: undefined,
    })).resolves.toEqual({ ok: true });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().amount).toBe(10000);
    expect(snap.data().category).toBe('식비');
  });

  test('addExpense rejects a photoPath belonging to a different trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await expect(addExpense(db, {
      sessionToken: token,
      tripId: 't1',
      date: '2026-08-01',
      category: '식비',
      amount: 10000,
      photoPath: `receipts/othertrip/${'a'.repeat(32)}.jpg`,
    })).rejects.toThrow('INVALID_PHOTO_PATH');
  });

  test('addExpense rejects a photoPath outside the receipts namespace', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await expect(addExpense(db, {
      sessionToken: token,
      tripId: 't1',
      date: '2026-08-01',
      category: '식비',
      amount: 10000,
      photoPath: 'evil/path.jpg',
    })).rejects.toThrow('INVALID_PHOTO_PATH');
  });

  test('addExpense accepts a well-formed photoPath for its own trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const photoPath = `receipts/t1/${'a'.repeat(32)}.jpg`;

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000, photoPath,
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().photoPath).toBe(photoPath);
  });

  test('updateExpense rejects a malformed photoPath in the patch', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(updateExpense(db, {
      sessionToken: token, tripId: 't1', expenseId, patch: { photoPath: 'evil/path.jpg' },
    })).rejects.toThrow('INVALID_PHOTO_PATH');
  });

  test('updateExpense accepts an explicit null photoPath to clear the photo', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const photoPath = `receipts/t1/${'a'.repeat(32)}.jpg`;
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000, photoPath,
    });

    await expect(updateExpense(db, {
      sessionToken: token, tripId: 't1', expenseId, patch: { photoPath: null },
    })).resolves.toEqual({ ok: true });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().photoPath).toBeNull();
  });

  test('addExpense initialises isWaypoint to false', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-11', category: '식비', amount: 10000,
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().isWaypoint).toBe(false);
  });
});

async function seed() {
  const db = new FakeFirestore();
  const bucket = makeFakeBucket();
  const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 'trip1' });
  return { db, bucket, adminToken };
}

describe('deleteExpense', () => {
  test('a member can delete their own unconfirmed expense', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(deleteExpense(db, bucket, { sessionToken: token, tripId: 't1', expenseId })).resolves.toEqual({ ok: true });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.exists).toBe(false);
  });

  test("a member cannot delete someone else's expense", async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token: mine } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: theirs } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm2' });
    const { expenseId } = await addExpense(db, {
      sessionToken: mine, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(deleteExpense(db, bucket, {
      sessionToken: theirs, tripId: 't1', expenseId,
    })).rejects.toThrow('FORBIDDEN');

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.exists).toBe(true);
  });

  test('a member cannot delete their own expense once it is confirmed', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: admin } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });
    await confirmExpense(db, { sessionToken: admin, tripId: 't1', expenseId, confirmed: true });

    await expect(deleteExpense(db, bucket, {
      sessionToken: member, tripId: 't1', expenseId,
    })).rejects.toThrow('EXPENSE_LOCKED');

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.exists).toBe(true);
  });

  test('an admin can delete any expense regardless of who entered it or confirmation state', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: admin } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });
    await confirmExpense(db, { sessionToken: admin, tripId: 't1', expenseId, confirmed: true });

    await expect(deleteExpense(db, bucket, { sessionToken: admin, tripId: 't1', expenseId })).resolves.toEqual({ ok: true });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.exists).toBe(false);
  });

  test('deleting a nonexistent expense throws EXPENSE_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await expect(deleteExpense(db, bucket, {
      sessionToken: token, tripId: 't1', expenseId: 'ghost',
    })).rejects.toThrow('EXPENSE_NOT_FOUND');
  });

  test('rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token: t1 } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: t2 } = await createSession(db, { role: 'admin', tripId: 't2' });
    const { expenseId } = await addExpense(db, {
      sessionToken: t1, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(deleteExpense(db, bucket, {
      sessionToken: t2, tripId: 't1', expenseId,
    })).rejects.toThrow('FORBIDDEN');
  });

  test('requires a session at all', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    await expect(deleteExpense(db, bucket, {
      sessionToken: 'nope', tripId: 't1', expenseId: 'e1',
    })).rejects.toThrow('UNAUTHENTICATED');
  });

  test('deletes the storage object when the expense has a photoPath', async () => {
    const { db, bucket, adminToken } = await seed();
    await db.collection('trips').doc('trip1').collection('expenses').doc('e1')
      .set({ enteredBy: 'm1', confirmed: false, photoPath: 'receipts/trip1/abc.jpg' });
    await deleteExpense(db, bucket, { sessionToken: adminToken, tripId: 'trip1', expenseId: 'e1' });
    expect(bucket.deleted).toEqual(['receipts/trip1/abc.jpg']);
  });

  test('still deletes the expense when the storage delete fails', async () => {
    const { db, bucket, adminToken } = await seed();
    await db.collection('trips').doc('trip1').collection('expenses').doc('e1')
      .set({ enteredBy: 'm1', confirmed: false, photoPath: 'receipts/trip1/abc.jpg' });
    bucket.failNextDelete = true;
    await deleteExpense(db, bucket, { sessionToken: adminToken, tripId: 'trip1', expenseId: 'e1' });
    const snap = await db.collection('trips').doc('trip1').collection('expenses').doc('e1').get();
    expect(snap.exists).toBe(false);
  });

  test('does not touch storage when the expense has no photoPath', async () => {
    const { db, bucket, adminToken } = await seed();
    await db.collection('trips').doc('trip1').collection('expenses').doc('e1')
      .set({ enteredBy: 'm1', confirmed: false, photoPath: null });
    await deleteExpense(db, bucket, { sessionToken: adminToken, tripId: 'trip1', expenseId: 'e1' });
    expect(bucket.deleted).toEqual([]);
  });
});

describe('excludedMembers on expenses', () => {
  test('addExpense defaults excludedMembers to []', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01',
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().excludedMembers).toEqual([]);
  });

  test('addExpense accepts a valid excludedMembers array', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await db.collection('trips').doc('t1').collection('members').doc('m2').set({ name: 'M2' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01', excludedMembers: ['m2'],
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().excludedMembers).toEqual(['m2']);
  });

  test('addExpense rejects an excludedMembers id not in the trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await expect(addExpense(db, {
      sessionToken: token, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01', excludedMembers: ['ghost'],
    })).rejects.toThrow('INVALID_EXCLUDED_MEMBERS');
  });

  test('updateExpense accepts a valid excludedMembers patch', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await db.collection('trips').doc('t1').collection('members').doc('m2').set({ name: 'M2' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01',
    });

    await updateExpense(db, {
      sessionToken: token, tripId: 't1', expenseId, patch: { excludedMembers: ['m2'] },
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().excludedMembers).toEqual(['m2']);
  });

  test('updateExpense rejects an excludedMembers id not in the trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01',
    });

    await expect(updateExpense(db, {
      sessionToken: token, tripId: 't1', expenseId, patch: { excludedMembers: ['ghost'] },
    })).rejects.toThrow('INVALID_EXCLUDED_MEMBERS');
  });
});

describe('setExpenseExclusions', () => {
  async function seedTrip() {
    const db = new FakeFirestore();
    const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { token: memberToken } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await db.collection('trips').doc('t1').collection('members').doc('m1').set({ name: 'M1' });
    await db.collection('trips').doc('t1').collection('members').doc('m2').set({ name: 'M2' });
    return { db, adminToken, memberToken };
  }

  test('overwrites excludedMembers on all listed expenses (admin)', async () => {
    const { db, adminToken, memberToken } = await seedTrip();
    const a = (await addExpense(db, {
      sessionToken: memberToken, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01',
    })).expenseId;
    const b = (await addExpense(db, {
      sessionToken: memberToken, tripId: 't1', category: '식비', amount: 2000, date: '2026-08-01',
    })).expenseId;

    await setExpenseExclusions(db, {
      sessionToken: adminToken, tripId: 't1', expenseIds: [a, b], excludedMemberIds: ['m2'],
    });

    for (const id of [a, b]) {
      const snap = await db.collection('trips').doc('t1').collection('expenses').doc(id).get();
      expect(snap.data().excludedMembers).toEqual(['m2']);
    }
  });

  test('clears exclusions when excludedMemberIds is empty', async () => {
    const { db, adminToken, memberToken } = await seedTrip();
    const a = (await addExpense(db, {
      sessionToken: memberToken, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01', excludedMembers: ['m2'],
    })).expenseId;

    await setExpenseExclusions(db, {
      sessionToken: adminToken, tripId: 't1', expenseIds: [a], excludedMemberIds: [],
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(a).get();
    expect(snap.data().excludedMembers).toEqual([]);
  });

  test('rejects EXPENSE_NOT_FOUND if any id is missing', async () => {
    const { db, adminToken } = await seedTrip();

    await expect(setExpenseExclusions(db, {
      sessionToken: adminToken, tripId: 't1', expenseIds: ['nope'], excludedMemberIds: [],
    })).rejects.toThrow('EXPENSE_NOT_FOUND');
  });

  test('rejects INVALID_EXCLUDED_MEMBERS for an unknown member id', async () => {
    const { db, adminToken, memberToken } = await seedTrip();
    const a = (await addExpense(db, {
      sessionToken: memberToken, tripId: 't1', category: '식비', amount: 1000, date: '2026-08-01',
    })).expenseId;

    await expect(setExpenseExclusions(db, {
      sessionToken: adminToken, tripId: 't1', expenseIds: [a], excludedMemberIds: ['ghost'],
    })).rejects.toThrow('INVALID_EXCLUDED_MEMBERS');
  });

  test('rejects a non-admin session', async () => {
    const { db, memberToken } = await seedTrip();

    await expect(setExpenseExclusions(db, {
      sessionToken: memberToken, tripId: 't1', expenseIds: [], excludedMemberIds: [],
    })).rejects.toThrow();
  });
});

describe('setExpenseWaypoint', () => {
  async function setup(db, { status = 'active' } = {}) {
    const tripRef = await db.collection('trips').add({
      slug: 'a', name: 'A', group: 'G', status, adminPinHash: 'x', memberPinHash: 'y',
    });
    const m1 = await tripRef.collection('members').add({ name: '가', weight: 1 });
    const m2 = await tripRef.collection('members').add({ name: '나', weight: 1 });
    const owner = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m1.id });
    const other = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m2.id });
    const expRef = await tripRef.collection('expenses').add({
      date: '2026-08-11', category: '식비', amount: 10000, merchant: '동문시장', detail: '',
      enteredBy: m1.id, recordedBy: 'member', photoPath: null, excludedMembers: [],
      confirmed: false, confirmedAt: null, isWaypoint: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    return {
      tripId: tripRef.id, tripRef, expenseId: expRef.id, expRef,
      ownerToken: owner.token, otherToken: other.token,
    };
  }

  test('경유지로 표시하고 해제한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);

    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);

    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: false,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(false);
  });

  // updateExpense와의 결정적 차이. 경로 맵은 공동의 기록이다.
  test('남이 입력한 경비에도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await setExpenseWaypoint(db, {
      sessionToken: t.otherToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  // 확정 후가 이 기능의 주 사용 시점이다.
  test('확정된 경비에도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await t.expRef.update({ confirmed: true });
    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  // 완료된 여행의 회고가 주 사용 시점이다.
  test('완료된 여행에서도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db, { status: 'completed' });
    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  test('불린이 아닌 값을 불린으로 강제한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: 'yes',
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  test('없는 경비는 EXPENSE_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: 'nope', isWaypoint: true,
    })).rejects.toThrow('EXPENSE_NOT_FOUND');
  });

  test('다른 여행의 세션은 FORBIDDEN', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { token } = await createSession(db, { role: 'member', tripId: 'other', memberId: 'x' });
    await expect(setExpenseWaypoint(db, {
      sessionToken: token, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    })).rejects.toThrow('FORBIDDEN');
  });

  test('세션이 없으면 UNAUTHENTICATED', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(setExpenseWaypoint(db, {
      tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    })).rejects.toThrow('UNAUTHENTICATED');
  });
});

describe('expense scheduleId', () => {
  async function setup(db) {
    const tripRef = await db.collection('trips').add({
      slug: 'a', name: 'A', group: 'G', status: 'active', adminPinHash: 'x', memberPinHash: 'y',
    });
    const m1 = await tripRef.collection('members').add({ name: '가', weight: 1 });
    const s1 = await tripRef.collection('schedules').add({
      planId: 'default', title: '성산일출봉', category: '놀이', date: '2026-08-11',
      startMin: 660, endMin: 780, participants: [m1.id],
    });
    const { token } = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m1.id });
    return {
      tripId: tripRef.id, tripRef, memberId: m1.id, scheduleId: s1.id, token,
    };
  }

  const base = (t, over = {}) => ({
    sessionToken: t.token,
    tripId: t.tripId,
    date: '2026-08-11',
    category: '식비',
    amount: 10000,
    ...over,
  });

  test('addExpense가 scheduleId를 null로 초기화한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t));
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBeNull();
  });

  test('실재하는 scheduleId를 저장한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t, { scheduleId: t.scheduleId }));
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBe(t.scheduleId);
  });

  test('없는 scheduleId는 SCHEDULE_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(addExpense(db, base(t, { scheduleId: 'nope' }))).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });

  // 다른 여행의 일정에 붙이면 그 여행 구성원이 아닌 사람들의 분담이 섞인다.
  test('다른 여행의 scheduleId는 SCHEDULE_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const other = await setup(db);
    await expect(
      addExpense(db, base(t, { scheduleId: other.scheduleId })),
    ).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });

  test('updateExpense가 scheduleId를 바꾼다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t));
    await updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: t.scheduleId },
    });
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBe(t.scheduleId);
  });

  test('updateExpense가 null로 연결을 해제한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t, { scheduleId: t.scheduleId }));
    await updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: null },
    });
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBeNull();
  });

  test('patch에 scheduleId가 없으면 기존 값이 유지된다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t, { scheduleId: t.scheduleId }));
    await updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { amount: 20000 },
    });
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBe(t.scheduleId);
  });

  test('updateExpense도 없는 scheduleId를 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t));
    await expect(updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: 'nope' },
    })).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });

  // A callable takes whatever the client sends. None of these values is a
  // document id: real Firestore's validateResourcePath throws an opaque
  // "not a valid resource path" Error for a non-string or empty id, which
  // toHttpsError cannot classify and therefore downgrades to INTERNAL_ERROR.
  const BAD_IDS = [
    ['숫자', 123],
    ['빈 문자열', ''],
    ['객체', {}],
    ['배열', []],
    ['불린', true],
  ];

  BAD_IDS.forEach(([label, bad]) => {
    test(`addExpense가 ${label} scheduleId를 거부한다`, async () => {
      const db = new FakeFirestore();
      const t = await setup(db);
      await expect(addExpense(db, base(t, { scheduleId: bad }))).rejects.toThrow('SCHEDULE_NOT_FOUND');
    });

    test(`updateExpense가 ${label} scheduleId를 거부한다`, async () => {
      const db = new FakeFirestore();
      const t = await setup(db);
      const { expenseId } = await addExpense(db, base(t));
      await expect(updateExpense(db, {
        sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: bad },
      })).rejects.toThrow('SCHEDULE_NOT_FOUND');
    });
  });

  // The cases above cannot fail against FakeFirestore even with no type guard,
  // because its doc() stringifies any id and the resulting path simply does not
  // exist. These two can: they park a schedule at the id a number stringifies
  // to, so an ungated lookup finds it and links the expense to a schedule the
  // caller never named. This is the type confusion the guard exists to stop.
  async function seedNumericIdSchedule(t) {
    await t.tripRef.collection('schedules').doc('123').set({
      planId: 'default', title: '숫자 id', category: '놀이', date: '2026-08-11',
      startMin: 660, endMin: 780, participants: [],
    });
  }

  test('숫자 scheduleId가 같은 문자열 id의 일정에 연결되지 않는다 (addExpense)', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await seedNumericIdSchedule(t);
    await expect(addExpense(db, base(t, { scheduleId: 123 }))).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });

  test('숫자 scheduleId가 같은 문자열 id의 일정에 연결되지 않는다 (updateExpense)', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await seedNumericIdSchedule(t);
    const { expenseId } = await addExpense(db, base(t));
    await expect(updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: 123 },
    })).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });
});
