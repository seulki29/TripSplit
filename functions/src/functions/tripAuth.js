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

  // Two buckets, because two different things need bounding.
  //
  // The secret actually being guessed is trip.memberPinHash — ONE hash shared by
  // every member of the trip. A per-name bucket alone is therefore no limit at
  // all: an attacker sends a fresh random name on every request, lands in a
  // brand-new bucket each time, and gets unlimited PIN guesses. The trip-wide
  // bucket bounds the total guess budget against that shared PIN no matter how
  // many names are tried; its limit is higher (30) because it must absorb the
  // normal login traffic of every legitimate member.
  //
  // The per-name bucket stays at the default 10 — a separate concern: it bounds
  // a targeted lockout attempt against one specific member's name.
  const tripThrottleKey = `member:${data.slug}`;
  const nameThrottleKey = `member:${data.slug}:${data.name}`;
  await checkLoginThrottle(db, tripThrottleKey, 30, 15 * 60 * 1000);
  await checkLoginThrottle(db, nameThrottleKey, 10, 15 * 60 * 1000);

  const trip = await findTripBySlug(db, data.slug);
  const ok = await verifySecret(data.pin || '', trip.memberPinHash);
  if (!ok) throw new Error('INVALID_PIN');

  const membersSnap = await db.collection('trips').doc(trip.id).collection('members')
    .where('name', '==', data.name).get();
  if (membersSnap.empty) throw new Error('MEMBER_NOT_FOUND');
  const member = membersSnap.docs[0];

  // Only a fully successful login (right PIN *and* a real member name) resets
  // the counters — a correct PIN with a made-up name must not buy more guesses.
  await resetLoginThrottle(db, tripThrottleKey);
  await resetLoginThrottle(db, nameThrottleKey);
  return createSession(db, { role: 'member', tripId: trip.id, memberId: member.id });
}

/**
 * Public endpoint: the member names a visitor can pick from before logging in.
 * Deliberately returns ONLY {id, name} — no weight, account, or settled
 * data may leak to an unauthenticated caller.
 */
async function listMembersForLogin(db, data) {
  const { slug } = data;
  if (!slug) throw new Error('MISSING_FIELDS');

  // Every member MUST fetch this roster to pick their name before they can even
  // attempt a PIN, and there is no "success" here to reset the counter on — so a
  // tight shared limit locks the whole group out of logging in, not just an
  // attacker. 100 per 15 minutes leaves normal group traffic untouched while
  // still making bulk scraping awkward; the payload is only {id, name} pairs, so
  // over-fetching it is low-impact.
  await checkLoginThrottle(db, `roster:${slug}`, 100, 15 * 60 * 1000);

  const trip = await findTripBySlug(db, slug);
  const membersSnap = await db.collection('trips').doc(trip.id).collection('members').get();
  return membersSnap.docs.map((d) => ({ id: d.id, name: d.data().name }));
}

/**
 * Public endpoint. No requireSession call: logging out with an already-invalid
 * or missing token is a harmless no-op, not an error.
 */
async function logout(db, data) {
  if (data.sessionToken) {
    await db.collection('sessions').doc(data.sessionToken).delete();
  }
  return { ok: true };
}

module.exports = {
  verifyAdminPin, verifyMemberPin, findTripBySlug, listMembersForLogin, logout,
};
