const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { getReportData, perPersonCategoryAverage, tripDays } = require('../../src/functions/report');
const { computeSettlement } = require('../../src/lib/settlement');

async function seedTrip(db, {
  id, group, status, members, expenses, period = { start: '2026-01-01', end: '2026-01-02' },
}) {
  await db.collection('trips').doc(id).set({
    name: id, group, status, period, location: '', lodging: '',
  });
  for (const m of members) {
    await db.collection('trips').doc(id).collection('members').doc(m.id).set(m);
  }
  for (const e of expenses) {
    await db.collection('trips').doc(id).collection('expenses').add(e);
  }
}

describe('perPersonCategoryAverage', () => {
  test('splits a confirmed expense across all members and divides by headcount when nobody is excluded', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ];
    const expenses = [{
      category: '식비', amount: 40000, confirmed: true, excludedMembers: [],
    }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    expect(averages['식비']).toBe(20000);
  });

  test('ignores unconfirmed expenses', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }];
    const expenses = [{ category: '식비', amount: 40000, confirmed: false }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    expect(averages['식비']).toBeUndefined();
  });

  test("excludes an expense's excludedMembers from both the split and the due headcount", () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ];
    // b is excluded from this expense, so only a is eligible and only a owes anything.
    const expenses = [{
      category: '식비', amount: 40000, confirmed: true, excludedMembers: ['b'],
    }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    // a alone splits the full 40000 -> a's due is 40000, headcount of members who owe is 1.
    expect(averages['식비']).toBe(40000);
  });

  test('uses headcount, not settlement weight, to average -- diverges from computeSettlement per-member due', () => {
    const members = [
      { id: 'a', name: 'A', weight: 2 },
      { id: 'b', name: 'B', weight: 1 },
    ];
    const expenses = [{
      category: '식비', amount: 90000, enteredBy: 'a', confirmed: true, excludedMembers: [],
    }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    // headcount-based: 90000 / 2 members who owe = 45000 (NOT weight-based)
    expect(averages['식비']).toBe(45000);

    const settlement = computeSettlement(members, expenses);
    // weight-based: 90000 split 2:1 -> a owes 60000, b owes 30000
    expect(settlement.perMember.find((m) => m.id === 'a').due).toBe(60000);
    expect(settlement.perMember.find((m) => m.id === 'b').due).toBe(30000);
    // Confirm the two metrics genuinely diverge given unequal weights
    expect(averages['식비']).not.toBe(settlement.perMember.find((m) => m.id === 'a').due);
  });

  test('divides every category total by the same trip-wide due headcount, not a per-category count', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
      { id: 'c', name: 'C', weight: 1 },
    ];
    const expenses = [
      // c is excluded here: only a and b split 60000 (30000 each).
      {
        category: '식비', amount: 60000, confirmed: true, excludedMembers: ['c'],
      },
      // a and b are excluded here: only c takes the full 90000.
      {
        category: '숙박', amount: 90000, confirmed: true, excludedMembers: ['a', 'b'],
      },
    ];

    const { averages } = perPersonCategoryAverage(members, expenses);
    // Every member owes something somewhere in the trip -> headcount is 3 for both categories.
    expect(averages['식비']).toBe(20000); // 60000 / 3
    expect(averages['숙박']).toBe(30000); // 90000 / 3
  });
});

describe('getReportData', () => {
  test('returns settlement and current-trip category averages', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [
        { id: 'a', name: 'A', weight: 1 },
        { id: 'b', name: 'B', weight: 1 },
      ],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.settlement.perMember.find((m) => m.id === 'a').due).toBe(20000);
    // 20000 per person over a 2-day trip
    expect(result.currentCategoryPerDay['식비']).toBe(10000);
    expect(result.tripDays).toBe(2);
  });

  test('returns each expense with its id, photoPath, and excludedMembers', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [
        { id: 'a', name: 'A', weight: 1 },
        { id: 'b', name: 'B', weight: 1 },
      ],
      expenses: [{
        category: '식비',
        amount: 40000,
        enteredBy: 'a',
        confirmed: true,
        excludedMembers: ['b'],
        photoPath: 'receipts/current/x.jpg',
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.expenses).toHaveLength(1);
    const [expense] = result.expenses;
    expect(expense.id).toEqual(expect.any(String));
    expect(expense.photoPath).toBe('receipts/current/x.jpg');
    expect(expense.excludedMembers).toEqual(['b']);
  });

  test('returns account and settled for each member in perMember, merged from the member docs', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [
        {
          id: 'a', name: 'A', weight: 1, account: { bank: 'KB', holder: 'A', number: '123' }, settled: true,
        },
        { id: 'b', name: 'B', weight: 1 },
      ],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    const a = result.settlement.perMember.find((m) => m.id === 'a');
    const b = result.settlement.perMember.find((m) => m.id === 'b');
    expect(a.account).toEqual({ bank: 'KB', holder: 'A', number: '123' });
    expect(a.settled).toBe(true);
    expect(b.account).toBeNull();
    expect(b.settled).toBe(false);
  });

  test('averages the comparison across completed trips in the same group only', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 50000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'past-sfa',
      group: 'SFA',
      status: 'completed',
      members: [{ id: 'x', name: 'X', weight: 1 }],
      expenses: [{
        category: '식비', amount: 30000, enteredBy: 'x', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'other-group',
      group: 'FRIENDS',
      status: 'completed',
      members: [{ id: 'y', name: 'Y', weight: 1 }],
      expenses: [{
        category: '식비', amount: 999999, enteredBy: 'y', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    // past-sfa: 30000 per person over 2 days
    expect(result.groupCategoryPerDayAverages['식비']).toBe(15000);
    expect(result.tripsInComparison).toBe(1);
  });

  test('rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current', group: 'SFA', status: 'active', members: [], expenses: [],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'other-trip' });

    await expect(getReportData(db, { sessionToken: token, tripId: 'current' })).rejects.toThrow('FORBIDDEN');
  });

  test('the settlement returned to the client balances to zero even for an indivisible total', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [
        { id: 'a', name: 'A', weight: 1 },
        { id: 'b', name: 'B', weight: 1 },
        { id: 'c', name: 'C', weight: 1 },
      ],
      expenses: [{
        category: '식비', amount: 100000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const { settlement } = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(settlement.perMember.reduce((s, m) => s + m.due, 0)).toBe(settlement.totalConfirmed);
    expect(settlement.perMember.reduce((s, m) => s + m.net, 0)).toBe(0);
  });
});

describe('tripDays', () => {
  test('counts both endpoints, so a same-day trip is one day', () => {
    expect(tripDays({ start: '2026-07-30', end: '2026-07-30' })).toBe(1);
  });

  test('counts an inclusive multi-day range', () => {
    expect(tripDays({ start: '2026-07-30', end: '2026-08-02' })).toBe(4);
  });

  test('is immune to DST -- the span is measured in UTC', () => {
    expect(tripDays({ start: '2026-03-01', end: '2026-03-31' })).toBe(31);
  });

  test('returns null for a missing, partial, or malformed period', () => {
    expect(tripDays(null)).toBeNull();
    expect(tripDays({})).toBeNull();
    expect(tripDays({ start: null, end: null })).toBeNull();
    expect(tripDays({ start: '2026-07-30', end: null })).toBeNull();
    expect(tripDays({ start: '2026/07/30', end: '2026/08/02' })).toBeNull();
  });

  test('returns null when the end precedes the start', () => {
    expect(tripDays({ start: '2026-08-02', end: '2026-07-30' })).toBeNull();
  });
});

describe('getReportData per-day normalisation', () => {
  test('normalises the current trip by its own length', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-07-01', end: '2026-07-04' }, // 4 days
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 80000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.tripDays).toBe(4);
    expect(result.currentCategoryPerDay['식비']).toBe(20000); // 80000 / 4
  });

  test('compares against past trips on a per-day basis, so trip length does not skew it', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-07-01', end: '2026-07-02' }, // 2 days
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    // A 4-day trip that spent twice as much in total -- but the same per day.
    await seedTrip(db, {
      id: 'past-long',
      group: 'SFA',
      status: 'completed',
      period: { start: '2026-01-01', end: '2026-01-04' },
      members: [{ id: 'x', name: 'X', weight: 1 }],
      expenses: [{
        category: '식비', amount: 80000, enteredBy: 'x', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.currentCategoryPerDay['식비']).toBe(20000);
    expect(result.groupCategoryPerDayAverages['식비']).toBe(20000);
    expect(result.tripsInComparison).toBe(1);
  });

  test('drops a past trip with no usable period from both the average and the count', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-07-01', end: '2026-07-02' },
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'past-good',
      group: 'SFA',
      status: 'completed',
      period: { start: '2026-01-01', end: '2026-01-02' },
      members: [{ id: 'x', name: 'X', weight: 1 }],
      expenses: [{
        category: '식비', amount: 30000, enteredBy: 'x', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'past-undated',
      group: 'SFA',
      status: 'completed',
      period: { start: null, end: null },
      members: [{ id: 'y', name: 'Y', weight: 1 }],
      expenses: [{
        category: '식비', amount: 999999, enteredBy: 'y', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.groupCategoryPerDayAverages['식비']).toBe(15000); // 30000 / 2, undated one ignored
    expect(result.tripsInComparison).toBe(1);
  });

  test('reports tripDays null and no comparison when the current trip has no period', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: null, end: null },
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'past-good',
      group: 'SFA',
      status: 'completed',
      period: { start: '2026-01-01', end: '2026-01-02' },
      members: [{ id: 'x', name: 'X', weight: 1 }],
      expenses: [{
        category: '식비', amount: 30000, enteredBy: 'x', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.tripDays).toBeNull();
    expect(result.currentCategoryPerDay).toEqual({});
    expect(result.tripsInComparison).toBe(0);
    // The settlement itself is unaffected by a missing period.
    expect(result.settlement.totalConfirmed).toBe(40000);
  });

  test('no longer ships the trip-total category fields', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.currentCategoryAverages).toBeUndefined();
    expect(result.groupCategoryAverages).toBeUndefined();
  });
});
