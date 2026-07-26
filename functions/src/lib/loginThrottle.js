/**
 * Throttle keys embed caller-supplied values (a trip slug, a member name), and
 * a Firestore document id may not contain '/'. Percent-encode just '/' (and
 * '%' itself, to keep the encoding reversible and collision-free) so the id
 * stays legal without becoming unreadable in the console.
 */
function throttleDocId(key) {
  return key.replace(/%/g, '%25').replace(/\//g, '%2F');
}

async function checkLoginThrottle(db, key, limit = 10, windowMs = 15 * 60 * 1000) {
  const ref = db.collection('loginAttempts').doc(throttleDocId(key));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const data = snap.exists ? snap.data() : { count: 0, windowStart: now };
    const windowExpired = now - data.windowStart > windowMs;
    const count = windowExpired ? 0 : data.count;

    if (count >= limit) {
      throw new Error('TOO_MANY_ATTEMPTS');
    }

    tx.set(ref, { count: count + 1, windowStart: windowExpired ? now : data.windowStart });
  });
}

async function resetLoginThrottle(db, key) {
  await db.collection('loginAttempts').doc(throttleDocId(key)).delete();
}

module.exports = { checkLoginThrottle, resetLoginThrottle, throttleDocId };
