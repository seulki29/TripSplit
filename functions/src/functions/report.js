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

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

// Inclusive day count. Parsed as UTC so a DST boundary inside the range cannot
// shift the result by a day. null means "cannot be compared on a per-day basis".
function tripDays(period) {
  if (!period) return null;
  const start = parseIsoDate(period.start);
  const end = parseIsoDate(period.end);
  if (start === null || end === null || end < start) return null;
  return Math.round((end - start) / 86400000) + 1;
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
  const days = tripDays(trip.period);
  const { averages: currentTotals } = perPersonCategoryAverage(members, expenses);
  const currentCategoryPerDay = {};
  if (days) {
    for (const category of Object.keys(currentTotals)) {
      currentCategoryPerDay[category] = currentTotals[category] / days;
    }
  }

  const otherTripsSnap = await db.collection('trips')
    .where('group', '==', trip.group)
    .where('status', '==', 'completed')
    .get();
  const otherTrips = otherTripsSnap.docs.filter((d) => d.id !== tripId);

  const perCategorySums = {};
  const perCategoryCounts = {};
  let comparableTrips = 0;
  for (const tripDoc of otherTrips) {
    // A trip with no usable period cannot be put on a per-day axis, so it is
    // excluded from the average and from the count the UI shows.
    const pastDays = tripDays(tripDoc.data().period);
    if (!pastDays) continue;
    comparableTrips += 1;
    const bundle = await loadTripBundle(db, tripDoc.id);
    const { averages } = perPersonCategoryAverage(bundle.members, bundle.expenses);
    for (const category of Object.keys(averages)) {
      perCategorySums[category] = (perCategorySums[category] || 0) + averages[category] / pastDays;
      perCategoryCounts[category] = (perCategoryCounts[category] || 0) + 1;
    }
  }

  const groupCategoryPerDayAverages = {};
  for (const category of Object.keys(perCategorySums)) {
    groupCategoryPerDayAverages[category] = perCategorySums[category] / perCategoryCounts[category];
  }

  return {
    trip: {
      name: trip.name, period: trip.period, location: trip.location, lodging: trip.lodging,
    },
    members,
    expenses,
    settlement,
    tripDays: days,
    currentCategoryPerDay,
    groupCategoryPerDayAverages,
    tripsInComparison: days ? comparableTrips : 0,
  };
}

module.exports = { getReportData, perPersonCategoryAverage, tripDays };
