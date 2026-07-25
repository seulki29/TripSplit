const { requireSession } = require('../lib/sessions');

async function addMember(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);

  const { tripId, name } = data;
  if (!name || !name.trim()) throw new Error('NAME_REQUIRED');

  const membersRef = db.collection('trips').doc(tripId).collection('members');
  const existing = await membersRef.where('name', '==', name).get();
  if (!existing.empty) throw new Error('NAME_TAKEN');

  const ref = await membersRef.add({
    name,
    weight: data.weight != null ? data.weight : 1,
    excludedCategories: data.excludedCategories || [],
    account: null,
  });

  return { memberId: ref.id };
}

async function updateMember(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);

  const { tripId, memberId, patch } = data;
  const membersRef = db.collection('trips').doc(tripId).collection('members');

  if (patch.name !== undefined) {
    if (!patch.name || !patch.name.trim()) throw new Error('NAME_REQUIRED');
    const existing = await membersRef.where('name', '==', patch.name).get();
    const clashesWithAnother = existing.docs.some((d) => d.id !== memberId);
    if (clashesWithAnother) throw new Error('NAME_TAKEN');
  }

  await membersRef.doc(memberId).update(patch);
  return { ok: true };
}

module.exports = { addMember, updateMember };
