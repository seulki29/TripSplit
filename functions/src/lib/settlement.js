/**
 * Splits `total` into whole-KRW shares proportional to `weights` using the
 * largest-remainder method, so the shares always add back up to `total`
 * exactly — no leftover 원 and no overshoot.
 *
 * A weight sum of zero (every eligible member excluded from the category)
 * allocates nothing, matching the documented all-excluded edge case.
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

function computeSettlement(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);

  const categoryTotals = {};
  for (const e of confirmed) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }

  const dueByMember = {};
  for (const m of members) dueByMember[m.id] = 0;

  for (const e of confirmed) {
    const excluded = new Set(e.excludedMembers || []);
    const eligible = members.filter((m) => !excluded.has(m.id));
    const weights = eligible.map((m) => ({ id: m.id, weight: m.weight }));
    const allocation = allocateInteger(e.amount, weights);
    for (const a of allocation) {
      dueByMember[a.id] += a.amount;
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
  }));

  return { categoryTotals, totalConfirmed, perMember };
}

module.exports = { computeSettlement, allocateInteger };
