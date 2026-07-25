const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const {
  listExpenses, addExpense, updateExpense, confirmExpense,
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
});
