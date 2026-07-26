const { verifySecret } = require('../lib/hashing');
const { createSession } = require('../lib/sessions');
const { checkLoginThrottle, resetLoginThrottle } = require('../lib/loginThrottle');

async function findTripBySlug(db, slug) {
  if (!slug) throw new Error('MISSING_FIELDS');
  const snap = await db.collection('trips').where('slug', '==', slug).get();
  if (snap.empty) throw new Error('TRIP_NOT_FOUND');
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function verifyAdminPin(db, data) {
  if (!data.slug) throw new Error('MISSING_FIELDS');

  const throttleKey = `admin:${data.slug}`;
  await checkLoginThrottle(db, throttleKey);

  const trip = await findTripBySlug(db, data.slug);
  const ok = await verifySecret(data.pin || '', trip.adminPinHash);
  if (!ok) throw new Error('INVALID_PIN');

  await resetLoginThrottle(db, throttleKey);
  return createSession(db, { role: 'admin', tripId: trip.id });
}

async function verifyMemberPin(db, data) {
  if (!data.slug || !data.name) throw new Error('MISSING_FIELDS');

  const throttleKey = `member:${data.slug}:${data.name}`;
  await checkLoginThrottle(db, throttleKey);

  const trip = await findTripBySlug(db, data.slug);
  const ok = await verifySecret(data.pin || '', trip.memberPinHash);
  if (!ok) throw new Error('INVALID_PIN');

  const membersSnap = await db.collection('trips').doc(trip.id).collection('members')
    .where('name', '==', data.name).get();
  if (membersSnap.empty) throw new Error('MEMBER_NOT_FOUND');
  const member = membersSnap.docs[0];

  await resetLoginThrottle(db, throttleKey);
  return createSession(db, { role: 'member', tripId: trip.id, memberId: member.id });
}

module.exports = { verifyAdminPin, verifyMemberPin, findTripBySlug };
