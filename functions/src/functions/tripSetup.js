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

  // A missing patch is treated as an empty patch: the save succeeds and
  // changes no fields (it still counts as the first save for the status flip).
  const patch = data.patch || {};

  const update = {};
  if ('period' in patch) update.period = patch.period;
  if ('location' in patch) update.location = patch.location;
  if ('lodging' in patch) update.lodging = patch.lodging;

  if (snap.data().status === 'setup') update.status = 'active';

  await ref.update(update);
  return { ok: true };
}

module.exports = { getTripSetup, updateTripSetup };
