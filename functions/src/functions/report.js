const { requireSession } = require('../lib/sessions');
const { computeSettlement, allocateInteger } = require('../lib/settlement');

async function loadTripBundle(db, tripId) {
  const membersSnap = await db.collection('trips').doc(tripId).collection('members').get();
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const expensesSnap = await db.collection('trips').doc(tripId).collection('expenses').get();
  const expenses = expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { members, expenses };
}

// Per-person category spend under the per-expense exclusion model: each
// confirmed expense's amount is split by weight among non-excluded members,
// bucketed by the expense's category; the average divides each category's
// total due by the number of members who owe anything in the trip.
function perPersonCategoryAverage(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);
  const categoryDue = {};
  const memberHasDue = new Set();

  for (const e of confirmed) {
    const excluded = new Set(e.excludedMembers || []);
    const eligible = members.filter((m) => !excluded.has(m.id));
    const allocation = allocateInteger(e.amount, eligible.map((m) => ({ id: m.id, weight: m.weight })));
    for (const a of allocation) {
      if (a.amount > 0) memberHasDue.add(a.id);
      categoryDue[e.category] = (categoryDue[e.category] || 0) + a.amount;
    }
  }

  const headcount = memberHasDue.size;
  const averages = {};
  if (headcount > 0) {
    for (const category of Object.keys(categoryDue)) {
      averages[category] = categoryDue[category] / headcount;
    }
  }
  return { averages };
}

async function getReportData(db, data) {
  const { sessionToken, tripId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const tripSnap = await db.collection('trips').doc(tripId).get();
  if (!tripSnap.exists) throw new Error('TRIP_NOT_FOUND');
  const trip = tripSnap.data();

  const { members, expenses } = await loadTripBundle(db, tripId);
  const settlement = computeSettlement(members, expenses);
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  settlement.perMember = settlement.perMember.map((pm) => ({
    ...pm,
    account: byId[pm.id]?.account ?? null,
    settled: byId[pm.id]?.settled ?? false,
  }));
  const { averages: currentCategoryAverages } = perPersonCategoryAverage(members, expenses);

  const otherTripsSnap = await db.collection('trips')
    .where('group', '==', trip.group)
    .where('status', '==', 'completed')
    .get();
  const otherTrips = otherTripsSnap.docs.filter((d) => d.id !== tripId);

  const perCategorySums = {};
  const perCategoryCounts = {};
  for (const tripDoc of otherTrips) {
    const bundle = await loadTripBundle(db, tripDoc.id);
    const { averages } = perPersonCategoryAverage(bundle.members, bundle.expenses);
    for (const category of Object.keys(averages)) {
      perCategorySums[category] = (perCategorySums[category] || 0) + averages[category];
      perCategoryCounts[category] = (perCategoryCounts[category] || 0) + 1;
    }
  }

  const groupCategoryAverages = {};
  for (const category of Object.keys(perCategorySums)) {
    groupCategoryAverages[category] = perCategorySums[category] / perCategoryCounts[category];
  }

  return {
    trip: {
      name: trip.name, period: trip.period, location: trip.location, lodging: trip.lodging,
    },
    members,
    expenses,
    settlement,
    currentCategoryAverages,
    groupCategoryAverages,
    tripsInComparison: otherTrips.length,
  };
}

module.exports = { getReportData, perPersonCategoryAverage };
