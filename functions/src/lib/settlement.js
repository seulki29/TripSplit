function computeSettlement(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);

  const categoryTotals = {};
  for (const e of confirmed) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }

  const dueByMember = {};
  for (const m of members) dueByMember[m.id] = 0;

  for (const category of Object.keys(categoryTotals)) {
    const weightSum = members.reduce((sum, m) => {
      if (m.excludedCategories.includes(category)) return sum;
      return sum + m.weight;
    }, 0);
    if (weightSum <= 0) continue;

    const perWeightUnit = categoryTotals[category] / weightSum;
    for (const m of members) {
      if (m.excludedCategories.includes(category)) continue;
      dueByMember[m.id] += perWeightUnit * m.weight;
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
    due: Math.round(dueByMember[m.id] || 0),
    paid: Math.round(paidByMember[m.id] || 0),
    net: Math.round((paidByMember[m.id] || 0) - (dueByMember[m.id] || 0)),
  }));

  return { categoryTotals, totalConfirmed, perMember };
}

module.exports = { computeSettlement };
