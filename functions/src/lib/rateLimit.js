async function checkRateLimit(db, token, action, limit, windowMs) {
  const ref = db.collection('sessions').doc(token);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('UNAUTHENTICATED');

  const session = snap.data();
  const now = Date.now();
  const key = `rateLimit_${action}`;
  const recent = (session[key] || []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) throw new Error('RATE_LIMITED');

  recent.push(now);
  await ref.update({ [key]: recent });
}

module.exports = { checkRateLimit };
