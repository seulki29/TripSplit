const { computeSettlement, allocateInteger } = require('../../src/lib/settlement');

describe('computeSettlement', () => {
  test('splits a category total evenly across members with weight 1', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(50000);
    expect(result.perMember.find((m) => m.id === 'b').due).toBe(50000);
  });

  test('a 0.5-weight member (e.g. a child) owes half as much', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'kid', name: "A's kid", weight: 0.5, excludedCategories: [] },
    ];
    const expenses = [{ category: '숙박', amount: 150000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(100000);
    expect(result.perMember.find((m) => m.id === 'kid').due).toBe(50000);
  });

  test('a member excluded from a category owes nothing for it', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: ['식비'] },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(100000);
    expect(result.perMember.find((m) => m.id === 'b').due).toBe(0);
  });

  test('unconfirmed expenses are excluded from every total', () => {
    const members = [{ id: 'a', name: 'A', weight: 1, excludedCategories: [] }];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: false }];

    const result = computeSettlement(members, expenses);
    expect(result.totalConfirmed).toBe(0);
    expect(result.perMember[0].due).toBe(0);
  });

  test('net is what was paid minus what was owed', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
    ];
    const expenses = [{ category: '교통비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').net).toBe(50000);
    expect(result.perMember.find((m) => m.id === 'b').net).toBe(-50000);
  });

  test('a category where every member is excluded from it allocates nothing (documented edge case)', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: ['숙박'] },
    ];
    const expenses = [{ category: '숙박', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.categoryTotals['숙박']).toBe(100000);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(0);
  });

  test('due amounts sum exactly to the category total for a non-divisible split (no rounding drift)', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
      { id: 'c', name: 'C', weight: 1, excludedCategories: [] },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    const sumDue = result.perMember.reduce((s, m) => s + m.due, 0);
    const sumNet = result.perMember.reduce((s, m) => s + m.net, 0);

    expect(sumDue).toBe(100000);
    expect(sumNet).toBe(0);
  });

  test('the leftover 원 lands on exactly one member, never split or duplicated', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
      { id: 'c', name: 'C', weight: 1, excludedCategories: [] },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const dues = computeSettlement(members, expenses).perMember.map((m) => m.due).sort();
    expect(dues).toEqual([33333, 33333, 33334]);
  });

  test('every due amount is a whole number of 원', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 0.5, excludedCategories: [] },
      { id: 'c', name: 'C', weight: 1, excludedCategories: [] },
    ];
    const expenses = [
      { category: '식비', amount: 77777, enteredBy: 'a', confirmed: true },
      { category: '숙박', amount: 13, enteredBy: 'b', confirmed: true },
    ];

    const result = computeSettlement(members, expenses);
    for (const m of result.perMember) {
      expect(Number.isInteger(m.due)).toBe(true);
      expect(Number.isInteger(m.net)).toBe(true);
    }
    expect(result.perMember.reduce((s, m) => s + m.due, 0)).toBe(77777 + 13);
    expect(result.perMember.reduce((s, m) => s + m.net, 0)).toBe(0);
  });

  test('due totals stay exact across several categories with different exclusion sets', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: ['식비'] },
      { id: 'c', name: 'C', weight: 2, excludedCategories: ['숙박'] },
    ];
    const expenses = [
      { category: '식비', amount: 100000, enteredBy: 'a', confirmed: true },
      { category: '숙박', amount: 100000, enteredBy: 'b', confirmed: true },
      { category: '교통비', amount: 99999, enteredBy: 'c', confirmed: true },
      { category: '장보기', amount: 1, enteredBy: 'a', confirmed: false },
    ];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.reduce((s, m) => s + m.due, 0)).toBe(result.totalConfirmed);
    expect(result.perMember.reduce((s, m) => s + m.net, 0)).toBe(0);
    // The unconfirmed 장보기 expense stays out of every total.
    expect(result.totalConfirmed).toBe(299999);
    expect(result.categoryTotals['장보기']).toBeUndefined();
  });
});

describe('allocateInteger', () => {
  test('distributes an exactly divisible total with no remainder handling', () => {
    expect(allocateInteger(300, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }]))
      .toEqual([{ id: 'a', amount: 150 }, { id: 'b', amount: 150 }]);
  });

  test('gives the leftover units to the largest remainders first', () => {
    // 10 across weights 1/1/1: exact 3.33 each, so one member is bumped to 4.
    const result = allocateInteger(10, [
      { id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 },
    ]);
    expect(result.reduce((s, r) => s + r.amount, 0)).toBe(10);
    expect(result.map((r) => r.amount).sort()).toEqual([3, 3, 4]);
  });

  test('distributes two leftover units to two different members', () => {
    // 100 across weights 1/1/1/1/1/1/1: 14.28 each -> 7*14 = 98, 2 left over.
    const weights = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, weight: 1 }));
    const result = allocateInteger(100, weights);

    expect(result.reduce((s, r) => s + r.amount, 0)).toBe(100);
    expect(result.filter((r) => r.amount === 15)).toHaveLength(2);
    expect(result.filter((r) => r.amount === 14)).toHaveLength(5);
  });

  test('respects unequal weights', () => {
    const result = allocateInteger(90000, [{ id: 'a', weight: 2 }, { id: 'b', weight: 1 }]);
    expect(result).toEqual([{ id: 'a', amount: 60000 }, { id: 'b', amount: 30000 }]);
  });

  test('allocates zero to everyone when the weight sum is zero', () => {
    expect(allocateInteger(100000, [{ id: 'a', weight: 0 }, { id: 'b', weight: 0 }]))
      .toEqual([{ id: 'a', amount: 0 }, { id: 'b', amount: 0 }]);
  });

  test('returns an empty allocation when nobody is eligible', () => {
    expect(allocateInteger(100000, [])).toEqual([]);
  });

  test('a zero total allocates nothing to anyone', () => {
    expect(allocateInteger(0, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }]))
      .toEqual([{ id: 'a', amount: 0 }, { id: 'b', amount: 0 }]);
  });
});
