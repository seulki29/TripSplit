const crypto = require('crypto');

const SESSION_TTL_MS = {
  superadmin: 12 * 60 * 60 * 1000,
  admin: 30 * 24 * 60 * 60 * 1000,
  member: 30 * 24 * 60 * 60 * 1000,
};

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function createSession(db, { role, tripId = null, memberId = null }) {
  const token = generateToken();
  const expiresAt = Date.now() + SESSION_TTL_MS[role];
  await db.collection('sessions').doc(token).set({ role, tripId, memberId, expiresAt });
  return { token, expiresAt };
}

async function requireSession(db, token, allowedRoles, expectedTripId = null) {
  if (!token) throw new Error('UNAUTHENTICATED');

  const snap = await db.collection('sessions').doc(token).get();
  if (!snap.exists) throw new Error('UNAUTHENTICATED');

  const session = snap.data();
  if (session.expiresAt < Date.now()) throw new Error('SESSION_EXPIRED');
  if (!allowedRoles.includes(session.role)) throw new Error('FORBIDDEN');
  if (expectedTripId && session.role !== 'superadmin' && session.tripId !== expectedTripId) {
    throw new Error('FORBIDDEN');
  }

  return session;
}

module.exports = { generateToken, createSession, requireSession, SESSION_TTL_MS };
