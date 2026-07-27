const { computeSettlement, allocateInteger } = require('../../src/lib/settlement');

describe('computeSettlement', () => {
  test('splits a category total evenly across members with weight 1', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(50000);
    expect(result.perMember.find((m) => m.id === 'b').due).toBe(50000);
  });

  test('a 0.5-weight member (e.g. a child) owes half as much', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'kid', name: "A's kid", weight: 0.5 },
    ];
    const expenses = [{ category: '숙박', amount: 150000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(100000);
    expect(result.perMember.find((m) => m.id === 'kid').due).toBe(50000);
  });

  test('unconfirmed expenses are excluded from every total', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: false, excludedMembers: [] }];

    const result = computeSettlement(members, expenses);
    expect(result.totalConfirmed).toBe(0);
    expect(result.perMember[0].due).toBe(0);
  });

  test('net is what was paid minus what was owed', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ];
    const expenses = [{ category: '교통비', amount: 100000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').net).toBe(50000);
    expect(result.perMember.find((m) => m.id === 'b').net).toBe(-50000);
  });

  test('due amounts sum exactly to the category total for a non-divisible split (no rounding drift)', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
      { id: 'c', name: 'C', weight: 1 },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];

    const result = computeSettlement(members, expenses);
    const sumDue = result.perMember.reduce((s, m) => s + m.due, 0);
    const sumNet = result.perMember.reduce((s, m) => s + m.net, 0);

    expect(sumDue).toBe(100000);
    expect(sumNet).toBe(0);
  });

  test('the leftover 원 lands on exactly one member, never split or duplicated', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
      { id: 'c', name: 'C', weight: 1 },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];

    const dues = computeSettlement(members, expenses).perMember.map((m) => m.due).sort();
    expect(dues).toEqual([33333, 33333, 33334]);
  });

  test('every due amount is a whole number of 원', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 0.5 },
      { id: 'c', name: 'C', weight: 1 },
    ];
    const expenses = [
      { category: '식비', amount: 77777, enteredBy: 'a', confirmed: true, excludedMembers: [] },
      { category: '숙박', amount: 13, enteredBy: 'b', confirmed: true, excludedMembers: [] },
    ];

    const result = computeSettlement(members, expenses);
    for (const m of result.perMember) {
      expect(Number.isInteger(m.due)).toBe(true);
      expect(Number.isInteger(m.net)).toBe(true);
    }
    expect(result.perMember.reduce((s, m) => s + m.due, 0)).toBe(77777 + 13);
    expect(result.perMember.reduce((s, m) => s + m.net, 0)).toBe(0);
  });

  test('due totals stay exact across several expenses with different exclusion sets', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
      { id: 'c', name: 'C', weight: 2 },
    ];
    const expenses = [
      { category: '식비', amount: 100000, enteredBy: 'a', confirmed: true, excludedMembers: ['b'] },
      { category: '숙박', amount: 100000, enteredBy: 'b', confirmed: true, excludedMembers: ['c'] },
      { category: '교통비', amount: 99999, enteredBy: 'c', confirmed: true, excludedMembers: [] },
      { category: '장보기', amount: 1, enteredBy: 'a', confirmed: false, excludedMembers: [] },
    ];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.reduce((s, m) => s + m.due, 0)).toBe(result.totalConfirmed);
    expect(result.perMember.reduce((s, m) => s + m.net, 0)).toBe(0);
    // The unconfirmed 장보기 expense stays out of every total.
    expect(result.totalConfirmed).toBe(299999);
    expect(result.categoryTotals['장보기']).toBeUndefined();
  });

  test('splits a confirmed expense among non-excluded members by weight', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
      { id: 'c', name: 'C', weight: 1 },
    ];
    const expenses = [
      { category: '식비', amount: 30000, enteredBy: 'a', confirmed: true, excludedMembers: [] },
      { category: '식비', amount: 10000, enteredBy: 'b', confirmed: true, excludedMembers: ['c'] },
    ];
    const { perMember } = computeSettlement(members, expenses);
    const due = Object.fromEntries(perMember.map((m) => [m.id, m.due]));
    // 30000 split 3 ways = 10000 each; 10000 split between a,b = 5000 each; c excluded from the second
    expect(due).toEqual({ a: 15000, b: 15000, c: 10000 });
    const paid = Object.fromEntries(perMember.map((m) => [m.id, m.paid]));
    expect(paid).toEqual({ a: 30000, b: 10000, c: 0 });
    const net = Object.fromEntries(perMember.map((m) => [m.id, m.net]));
    expect(net).toEqual({ a: 15000, b: -5000, c: -10000 });
  });

  test('ignores unconfirmed expenses', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }];
    const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: false, excludedMembers: [] }];
    const { perMember, totalConfirmed } = computeSettlement(members, expenses);
    expect(totalConfirmed).toBe(0);
    expect(perMember.every((m) => m.due === 0 && m.paid === 0)).toBe(true);
  });

  test('a member excluded from every expense owes nothing', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }];
    const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: true, excludedMembers: ['b'] }];
    const { perMember } = computeSettlement(members, expenses);
    expect(perMember.find((m) => m.id === 'b').due).toBe(0);
    expect(perMember.find((m) => m.id === 'a').due).toBe(10000);
  });

  test('an expense excluding everyone allocates nothing (no crash)', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }];
    const expenses = [{ category: '식비', amount: 5000, enteredBy: 'a', confirmed: true, excludedMembers: ['a'] }];
    const { perMember } = computeSettlement(members, expenses);
    expect(perMember.find((m) => m.id === 'a').due).toBe(0);
  });

  test('weight-zero members receive no share', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 0 }];
    const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];
    const { perMember } = computeSettlement(members, expenses);
    expect(perMember.find((m) => m.id === 'a').due).toBe(10000);
    expect(perMember.find((m) => m.id === 'b').due).toBe(0);
  });

  test('per-expense rounding still sums each expense exactly', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }, { id: 'c', name: 'C', weight: 1 }];
    const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];
    const { perMember } = computeSettlement(members, expenses);
    const totalDue = perMember.reduce((s, m) => s + m.due, 0);
    expect(totalDue).toBe(10000); // 3334 + 3333 + 3333
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
