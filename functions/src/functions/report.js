const { requireSession } = require('../lib/sessions');
const { computeSettlement } = require('../lib/settlement');

async function loadTripBundle(db, tripId) {
  const membersSnap = await db.collection('trips').doc(tripId).collection('members').get();
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const expensesSnap = await db.collection('trips').doc(tripId).collection('expenses').get();
  const expenses = expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { members, expenses };
}

function perPersonCategoryAverage(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);
  const categoryTotals = {};
  for (const e of confirmed) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }

  const averages = {};
  for (const category of Object.keys(categoryTotals)) {
    const headcount = members.filter((m) => !(m.excludedCategories || []).includes(category)).length;
    if (headcount > 0) averages[category] = categoryTotals[category] / headcount;
  }

  return { categoryTotals, averages };
}

async function getReportData(db, data) {
  const { sessionToken, tripId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const tripSnap = await db.collection('trips').doc(tripId).get();
  if (!tripSnap.exists) throw new Error('TRIP_NOT_FOUND');
  const trip = tripSnap.data();

  const { members, expenses } = await loadTripBundle(db, tripId);
  const settlement = computeSettlement(members, expenses);
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
