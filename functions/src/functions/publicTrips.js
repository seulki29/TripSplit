async function listPublicTrips(db) {
  const snap = await db.collection('trips').get();
  const trips = snap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return trips.map(({
    name, slug, group, period, location, status,
  }) => ({
    name, slug, group, period, location, status,
  }));
}

module.exports = { listPublicTrips };
