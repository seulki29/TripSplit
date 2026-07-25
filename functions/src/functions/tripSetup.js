const { requireSession } = require('../lib/sessions');

async function getTripSetup(db, data) {
  await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
  const snap = await db.collection('trips').doc(data.tripId).get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');
  const { adminPinHash, memberPinHash, ...rest } = snap.data();
  return rest;
}

async function updateTripSetup(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);

  const ref = db.collection('trips').doc(data.tripId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');

  const update = {};
  if ('period' in data.patch) update.period = data.patch.period;
  if ('location' in data.patch) update.location = data.patch.location;
  if ('lodging' in data.patch) update.lodging = data.patch.lodging;

  if (snap.data().status === 'setup') update.status = 'active';

  await ref.update(update);
  return { ok: true };
}

module.exports = { getTripSetup, updateTripSetup };
