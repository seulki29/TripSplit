const { hashSecret, verifySecret } = require('../lib/hashing');
const { createSession, requireSession } = require('../lib/sessions');
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
  const { tripId, patch } = data;
  const update = { ...patch };

  if (update.adminPin !== undefined) {
    update.adminPinHash = await hashSecret(update.adminPin);
    delete update.adminPin;
  }
  if (update.memberPin !== undefined) {
    update.memberPinHash = await hashSecret(update.memberPin);
    delete update.memberPin;
  }

  await db.collection('trips').doc(tripId).update(update);
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
