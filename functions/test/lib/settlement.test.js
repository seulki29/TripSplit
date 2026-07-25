const { computeSettlement } = require('../../src/lib/settlement');

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
});
