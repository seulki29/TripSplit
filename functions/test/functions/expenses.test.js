const { FakeFirestore } = require('../helpers/fakeFirestore');
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { createSession } = require('../../src/lib/sessions');
const {
  listExpenses, addExpense, updateExpense, deleteExpense, confirmExpense,
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
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '기타', amount: 1000,
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
