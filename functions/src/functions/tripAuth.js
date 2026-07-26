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

/**
 * Public endpoint: the member names a visitor can pick from before logging in.
 * Deliberately returns ONLY {id, name} — no weight, excludedCategories or
 * account data may leak to an unauthenticated caller.
 */
async function listMembersForLogin(db, data) {
  const { slug } = data;
  if (!slug) throw new Error('MISSING_FIELDS');

  await checkLoginThrottle(db, `roster:${slug}`, 20, 15 * 60 * 1000);

  const trip = await findTripBySlug(db, slug);
  const membersSnap = await db.collection('trips').doc(trip.id).collection('members').get();
  return membersSnap.docs.map((d) => ({ id: d.id, name: d.data().name }));
}

module.exports = {
  verifyAdminPin, verifyMemberPin, findTripBySlug, listMembersForLogin,
};
