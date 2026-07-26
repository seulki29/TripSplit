const { hashSecret, verifySecret } = require('../lib/hashing');
const { createSession, requireSession, revokeTripSessions } = require('../lib/sessions');
const { checkLoginThrottle, resetLoginThrottle } = require('../lib/loginThrottle');

const SUPERADMIN_THROTTLE_KEY = 'superadmin';

async function verifySuperadminPassword(db, passwordHash, data) {
  await checkLoginThrottle(db, SUPERADMIN_THROTTLE_KEY);

  const ok = await verifySecret(data.password || '', passwordHash);
  if (!ok) throw new Error('INVALID_PASSWORD');

  await resetLoginThrottle(db, SUPERADMIN_THROTTLE_KEY);
  return createSession(db, { role: 'superadmin' });
}

async function createTrip(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);

  const {
    name, slug, group, adminPin, memberPin,
  } = data;
  if (!name || !slug || !group || !adminPin || !memberPin) throw new Error('MISSING_FIELDS');

  const existing = await db.collection('trips').where('slug', '==', slug).get();
  if (!existing.empty) throw new Error('SLUG_TAKEN');

  const adminPinHash = await hashSecret(adminPin);
  const memberPinHash = await hashSecret(memberPin);

  const ref = await db.collection('trips').add({
    name,
    slug,
    group,
    adminPinHash,
    memberPinHash,
    status: 'setup',
    period: { start: null, end: null },
    location: '',
    lodging: '',
    createdAt: Date.now(),
  });

  return { tripId: ref.id };
}

async function listTrips(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);
  const snap = await db.collection('trips').get();
  return snap.docs.map((d) => {
    const { adminPinHash, memberPinHash, ...rest } = d.data();
    return { id: d.id, ...rest };
  });
}

async function updateTrip(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);

  const { tripId } = data;
  const patch = data.patch || {};

  const ref = db.collection('trips').doc(tripId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');

  // Allowlist: slug, createdAt and the PIN hashes themselves are not settable
  // through this endpoint — only a plaintext PIN, which is hashed here.
  const update = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.group !== undefined) update.group = patch.group;
  if (patch.status !== undefined) {
    if (!['setup', 'active', 'completed'].includes(patch.status)) throw new Error('INVALID_STATUS');
    update.status = patch.status;
  }

  let pinsChanged = false;
  if (patch.adminPin !== undefined) {
    update.adminPinHash = await hashSecret(patch.adminPin);
    pinsChanged = true;
  }
  if (patch.memberPin !== undefined) {
    update.memberPinHash = await hashSecret(patch.memberPin);
    pinsChanged = true;
  }

  await ref.update(update);
  if (pinsChanged) await revokeTripSessions(db, tripId);
  return { ok: true };
}

async function archiveTrip(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);
  await db.recursiveDelete(db.collection('trips').doc(data.tripId));
  return { ok: true };
}

module.exports = {
  verifySuperadminPassword, createTrip, listTrips, updateTrip, archiveTrip,
};
