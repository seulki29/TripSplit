const { requireSession } = require('../lib/sessions');

async function addMember(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);

  const { tripId, name } = data;
  if (!name || !name.trim()) throw new Error('NAME_REQUIRED');

  // Same validation as updateMember: a member created with a non-numeric weight
  // turns every settlement figure into NaN.
  const weight = data.weight != null ? data.weight : 1;
  if (typeof weight !== 'number' || weight < 0) throw new Error('INVALID_WEIGHT');

  const membersRef = db.collection('trips').doc(tripId).collection('members');
  const existing = await membersRef.where('name', '==', name).get();
  if (!existing.empty) throw new Error('NAME_TAKEN');

  const ref = await membersRef.add({
    name,
    weight,
    account: null,
    settled: false,
  });

  return { memberId: ref.id };
}

async function updateMember(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);

  const { tripId, memberId } = data;
  const patch = data.patch || {};
  const membersRef = db.collection('trips').doc(tripId).collection('members');

  const memberSnap = await membersRef.doc(memberId).get();
  if (!memberSnap.exists) throw new Error('MEMBER_NOT_FOUND');

  if (patch.name !== undefined) {
    if (!patch.name || !patch.name.trim()) throw new Error('NAME_REQUIRED');
    const existing = await membersRef.where('name', '==', patch.name).get();
    const clashesWithAnother = existing.docs.some((d) => d.id !== memberId);
    if (clashesWithAnother) throw new Error('NAME_TAKEN');
  }

  // Allowlist: anything not named here (role, id, arbitrary attacker fields)
  // is silently dropped rather than written straight to the document.
  const update = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.weight !== undefined) {
    if (typeof patch.weight !== 'number' || patch.weight < 0) throw new Error('INVALID_WEIGHT');
    update.weight = patch.weight;
  }
  if (patch.account !== undefined) update.account = patch.account;

  // Firestore rejects an empty update map ("At least one field must be
  // updated."), so a no-op patch has to short-circuit rather than write.
  if (Object.keys(update).length === 0) return { ok: true };

  await membersRef.doc(memberId).update(update);
  return { ok: true };
}

async function listMembers(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);
  const membersRef = db.collection('trips').doc(data.tripId).collection('members');
  const snap = await membersRef.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function setMemberSettled(db, data) {
  const { tripId, memberId, settled } = data;
  await requireSession(db, data.sessionToken, ['admin'], tripId);

  const memberRef = db.collection('trips').doc(tripId).collection('members').doc(memberId);
  const snap = await memberRef.get();
  if (!snap.exists) throw new Error('MEMBER_NOT_FOUND');

  await memberRef.update({ settled: !!settled });
  return { ok: true };
}

module.exports = {
  addMember, updateMember, listMembers, setMemberSettled,
};
