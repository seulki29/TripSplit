const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { getReportData, perPersonCategoryAverage } = require('../../src/functions/report');
const { computeSettlement } = require('../../src/lib/settlement');

async function seedTrip(db, { id, group, status, members, expenses }) {
  await db.collection('trips').doc(id).set({
    name: id, group, status, period: { start: null, end: null }, location: '', lodging: '',
  });
  for (const m of members) {
    await db.collection('trips').doc(id).collection('members').doc(m.id).set(m);
  }
  for (const e of expenses) {
    await db.collection('trips').doc(id).collection('expenses').add(e);
  }
}

describe('perPersonCategoryAverage', () => {
  test('divides each confirmed category total by the headcount not excluded from it', () => {
    const members = [
      { id: 'a', excludedCategories: [] },
      { id: 'b', excludedCategories: [] },
    ];
    const expenses = [{ category: '식비', amount: 40000, confirmed: true }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    expect(averages['식비']).toBe(20000);
  });

  test('ignores unconfirmed expenses', () => {
    const members = [{ id: 'a', excludedCategories: [] }];
    const expenses = [{ category: '식비', amount: 40000, confirmed: false }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    expect(averages['식비']).toBeUndefined();
  });

  test('uses headcount even when members have different settlement weights', () => {
    const members = [
      { id: 'a', name: 'A', weight: 2, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
    ];
    const expenses = [{ category: '식비', amount: 90000, enteredBy: 'a', confirmed: true }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    // headcount-based: 90000 / 2 members = 45000 (NOT weight-based)
    expect(averages['식비']).toBe(45000);

    const settlement = computeSettlement(members, expenses);
    // weight-based: 90000 / (2+1) weight units = 30000 per unit -> a owes 60000, b owes 30000
    expect(settlement.perMember.find((m) => m.id === 'a').due).toBe(60000);
    expect(settlement.perMember.find((m) => m.id === 'b').due).toBe(30000);
    // Confirm the two metrics genuinely diverge given unequal weights
    expect(averages['식비']).not.toBe(settlement.perMember.find((m) => m.id === 'a').due);
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
        { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
        { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
      ],
      expenses: [{ category: '식비', amount: 40000, enteredBy: 'a', confirmed: true }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.settlement.perMember.find((m) => m.id === 'a').due).toBe(20000);
    expect(result.currentCategoryAverages['식비']).toBe(20000);
  });

  test('averages the comparison across completed trips in the same group only', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current', group: 'SFA', status: 'active',
      members: [{ id: 'a', name: 'A', weight: 1, excludedCategories: [] }],
      expenses: [{ category: '식비', amount: 50000, enteredBy: 'a', confirmed: true }],
    });
    await seedTrip(db, {
      id: 'past-sfa', group: 'SFA', status: 'completed',
      members: [{ id: 'x', name: 'X', weight: 1, excludedCategories: [] }],
      expenses: [{ category: '식비', amount: 30000, enteredBy: 'x', confirmed: true }],
    });
    await seedTrip(db, {
      id: 'other-group', group: 'FRIENDS', status: 'completed',
      members: [{ id: 'y', name: 'Y', weight: 1, excludedCategories: [] }],
      expenses: [{ category: '식비', amount: 999999, enteredBy: 'y', confirmed: true }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.groupCategoryAverages['식비']).toBe(30000);
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
        { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
        { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
        { id: 'c', name: 'C', weight: 1, excludedCategories: [] },
      ],
      expenses: [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const { settlement } = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(settlement.perMember.reduce((s, m) => s + m.due, 0)).toBe(settlement.totalConfirmed);
    expect(settlement.perMember.reduce((s, m) => s + m.net, 0)).toBe(0);
  });
});
