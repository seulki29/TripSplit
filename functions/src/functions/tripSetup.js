const { requireSession } = require('../lib/sessions');
const { requireTripEditable } = require('../lib/tripStatus');

async function getTripSetup(db, data) {
  await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
  const snap = await db.collection('trips').doc(data.tripId).get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');
  const { adminPinHash, memberPinHash, ...rest } = snap.data();
  return rest;
}

async function updateTripSetup(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);
  await requireTripEditable(db, data.tripId);

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

  // Firestore rejects an empty update map ("At least one field must be
  // updated."), so a no-op patch on an already-active trip short-circuits.
  if (Object.keys(update).length === 0) return { ok: true };

  await ref.update(update);
  return { ok: true };
}

async function setTripStatus(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);
  const { tripId, status } = data;
  if (status !== 'active' && status !== 'completed') throw new Error('INVALID_STATUS');
  const ref = db.collection('trips').doc(tripId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');
  await ref.update({ status });
  return { ok: true };
}

module.exports = { getTripSetup, updateTripSetup, setTripStatus };
