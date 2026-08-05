/**
 * Splits `total` into whole-KRW shares proportional to `weights` using the
 * largest-remainder method, so the shares always add back up to `total`
 * exactly — no leftover 원 and no overshoot.
 *
 * A weight sum of zero allocates nothing. Callers must not reach this with an
 * expense that has to be paid for -- see sharersOf, which resolves "nobody can
 * carry this" to the payer before allocation.
 */
function allocateInteger(total, weights) {
  const weightSum = weights.reduce((sum, w) => sum + w.weight, 0);
  if (weightSum <= 0) return weights.map((w) => ({ id: w.id, amount: 0 }));

  const raw = weights.map((w) => {
    const exact = (total * w.weight) / weightSum;
    return { id: w.id, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  const allocated = raw.reduce((sum, r) => sum + r.floor, 0);
  const remaining = total - allocated;

  const sortedByRemainder = [...raw].sort((a, b) => b.remainder - a.remainder);
  const bumped = new Set(sortedByRemainder.slice(0, remaining).map((r) => r.id));

  return raw.map((r) => ({ id: r.id, amount: r.floor + (bumped.has(r.id) ? 1 : 0) }));
}

/**
 * Who actually shares an expense.
 *
 * Normally that is everyone not in `excludedMembers`. When nobody is left who
 * can carry the cost, the payer bears it alone rather than nobody bearing it:
 * an expense with no sharers still counts as paid, so leaving it unallocated
 * makes the report stop balancing -- the sum of every member's net must be 0
 * for a settlement to be settleable, and an unshared amount pushes it off by
 * exactly that amount. "Nobody else is splitting this" is a real intent (a
 * personal purchase entered for the record), and this is what it means.
 *
 * "Nobody who can carry it" is a zero total weight, not an empty list. The
 * exclusion list covering everyone is the common way to get there, but a trip
 * whose only non-excluded members all have weight 0 lands in the same place --
 * `allocateInteger` hands out nothing when the weights sum to zero.
 *
 * The payer is charged at weight 1, not their own weight. A member's weight
 * says how they split costs *with other people*; with no one to split against,
 * the whole amount is theirs, and a weight-0 payer would otherwise be handed
 * nothing and reopen the very imbalance this closes.
 *
 * If the payer is no longer a member of the trip there is nobody left to charge
 * and the amount stays unallocated -- the same gap a deleted payer already
 * leaves in `paidByMember`, and not something this function can close.
 */
function sharersOf(members, expense) {
  const excluded = new Set(expense.excludedMembers || []);
  const eligible = members.filter((m) => !excluded.has(m.id));
  if (eligible.reduce((sum, m) => sum + (m.weight || 0), 0) > 0) return eligible;
  return members
    .filter((m) => m.id === expense.enteredBy)
    .map((m) => ({ ...m, weight: 1 }));
}

function computeSettlement(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);

  const categoryTotals = {};
  for (const e of confirmed) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }

  const dueByMember = {};
  const breakdownByMember = {};
  for (const m of members) { dueByMember[m.id] = 0; breakdownByMember[m.id] = []; }

  for (const e of confirmed) {
    const eligible = sharersOf(members, e);
    const weights = eligible.map((m) => ({ id: m.id, weight: m.weight }));
    const allocation = allocateInteger(e.amount, weights);
    for (const a of allocation) {
      dueByMember[a.id] += a.amount;
      breakdownByMember[a.id].push({
        expenseId: e.id,
        category: e.category,
        merchant: e.merchant || '',
        share: a.amount,
      });
    }
  }

  const paidByMember = {};
  for (const m of members) paidByMember[m.id] = 0;
  for (const e of confirmed) {
    paidByMember[e.enteredBy] = (paidByMember[e.enteredBy] || 0) + e.amount;
  }

  const totalConfirmed = confirmed.reduce((sum, e) => sum + e.amount, 0);

  const perMember = members.map((m) => ({
    id: m.id,
    name: m.name,
    due: dueByMember[m.id] || 0,
    paid: paidByMember[m.id] || 0,
    net: (paidByMember[m.id] || 0) - (dueByMember[m.id] || 0),
    breakdown: breakdownByMember[m.id] || [],
  }));

  return { categoryTotals, totalConfirmed, perMember };
}

module.exports = { computeSettlement, allocateInteger, sharersOf };
