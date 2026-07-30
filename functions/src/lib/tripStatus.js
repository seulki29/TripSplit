async function requireTripEditable(db, tripId) {
  const snap = await db.collection('trips').doc(tripId).get();
  // A missing trip doc is treated as editable: each callable already does its
  // own TRIP_NOT_FOUND handling where relevant, and many unit tests exercise
  // the callables without seeding a trip doc. Only an explicitly completed
  // trip locks edits.
  if (snap.exists && snap.data().status === 'completed') throw new Error('TRIP_COMPLETED');
}

module.exports = { requireTripEditable };
