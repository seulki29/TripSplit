const { requireSession } = require('../lib/sessions');
const { requireTripEditable } = require('../lib/tripStatus');
const { CATEGORIES } = require('../lib/categories');
const { assertMemberIdsExist } = require('../lib/memberIds');

const PHOTO_PATH_SUFFIX_RE = /^[0-9a-f]{32}\.(jpg|png)$/;

/**
 * A photoPath is only ever trustworthy if it was minted by our own upload
 * (see lib/storage.js#uploadReceiptImage). Clients can supply photoPath
 * directly (e.g. after classifyReceipt), so re-derive the expected shape
 * here rather than trusting it: it must live under this trip's receipts
 * namespace and end in a random 32-hex-char name with an allowed extension.
 */
function isValidPhotoPath(tripId, photoPath) {
  if (typeof photoPath !== 'string') return false;
  const prefix = `receipts/${tripId}/`;
  if (!photoPath.startsWith(prefix)) return false;
  return PHOTO_PATH_SUFFIX_RE.test(photoPath.slice(prefix.length));
}

/**
 * A linked schedule must belong to this same trip. Accepting another trip's id
 * would let one trip's expense inherit a participant list made of people who
 * are not members here.
 */
async function assertScheduleExists(db, tripId, scheduleId) {
  if (scheduleId === null || scheduleId === undefined) return;
  // Reject before the value reaches doc(). Firestore's validateResourcePath
  // throws a plain "not a valid resource path" Error for a non-string or empty
  // id; that message matches no rule in toHttpsError, so it would reach the
  // client as a 500 INTERNAL_ERROR plus a console.error. A value that is not a
  // document id names no schedule, which is exactly what SCHEDULE_NOT_FOUND
  // already means.
  //
  // A slash is rejected too. doc() reads its argument as a path, not an id, so
  // 'a/b' throws the same unclassified Error ("even number of components") and
  // 'a/b/c' quietly addresses a subcollection document instead. Schedule ids
  // are opaque auto-ids, so a slash never appears in a legitimate one.
  if (typeof scheduleId !== 'string' || scheduleId === '' || scheduleId.includes('/')) {
    throw new Error('SCHEDULE_NOT_FOUND');
  }
  const snap = await db.collection('trips').doc(tripId)
    .collection('schedules').doc(scheduleId)
    .get();
  if (!snap.exists) throw new Error('SCHEDULE_NOT_FOUND');
}

async function listExpenses(db, data) {
  await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
  const snap = await db.collection('trips').doc(data.tripId).collection('expenses').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function addExpense(db, data) {
  const {
    sessionToken, tripId, date, category, amount, merchant, detail, photoPath,
  } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  if (!CATEGORIES.includes(category)) throw new Error('INVALID_CATEGORY');
  if (!(Number(amount) > 0)) throw new Error('INVALID_AMOUNT');
  if (photoPath && !isValidPhotoPath(tripId, photoPath)) throw new Error('INVALID_PHOTO_PATH');

  const excludedMembers = data.excludedMembers || [];
  await assertMemberIdsExist(db, tripId, excludedMembers, 'INVALID_EXCLUDED_MEMBERS');

  const scheduleId = data.scheduleId ?? null;
  await assertScheduleExists(db, tripId, scheduleId);

  let enteredBy;
  if (session.role === 'member') {
    enteredBy = session.memberId;
  } else {
    enteredBy = data.enteredBy;
    if (!enteredBy) throw new Error('ENTERED_BY_REQUIRED');
    const memberSnap = await db.collection('trips').doc(tripId).collection('members').doc(enteredBy).get();
    if (!memberSnap.exists) throw new Error('MEMBER_NOT_FOUND');
  }

  const ref = await db.collection('trips').doc(tripId).collection('expenses').add({
    date,
    category,
    amount: Number(amount),
    merchant: merchant || '',
    detail: detail || '',
    enteredBy,
    recordedBy: session.role,
    photoPath: photoPath || null,
    excludedMembers,
    scheduleId,
    confirmed: false,
    confirmedAt: null,
    isWaypoint: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { expenseId: ref.id };
}

async function updateExpense(db, data) {
  const { sessionToken, tripId, expenseId } = data;
  const patch = data.patch || {};
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const ref = db.collection('trips').doc(tripId).collection('expenses').doc(expenseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');
  const expense = snap.data();

  if (session.role === 'member') {
    if (expense.enteredBy !== session.memberId) throw new Error('FORBIDDEN');
    if (expense.confirmed) throw new Error('EXPENSE_LOCKED');
  }

  const update = {};
  if ('date' in patch) update.date = patch.date;
  if ('category' in patch) {
    if (!CATEGORIES.includes(patch.category)) throw new Error('INVALID_CATEGORY');
    update.category = patch.category;
  }
  if ('amount' in patch) {
    if (!(Number(patch.amount) > 0)) throw new Error('INVALID_AMOUNT');
    update.amount = Number(patch.amount);
  }
  if ('merchant' in patch) update.merchant = patch.merchant;
  if ('detail' in patch) update.detail = patch.detail;
  if ('photoPath' in patch) {
    if (patch.photoPath !== null && !isValidPhotoPath(tripId, patch.photoPath)) {
      throw new Error('INVALID_PHOTO_PATH');
    }
    update.photoPath = patch.photoPath;
  }
  if ('excludedMembers' in patch) {
    await assertMemberIdsExist(db, tripId, patch.excludedMembers, 'INVALID_EXCLUDED_MEMBERS');
    update.excludedMembers = patch.excludedMembers;
  }
  if ('scheduleId' in patch) {
    const next = patch.scheduleId ?? null;
    await assertScheduleExists(db, tripId, next);
    update.scheduleId = next;
  }

  update.updatedAt = Date.now();
  await ref.update(update);
  return { ok: true };
}

async function deleteExpense(db, bucket, data) {
  const { sessionToken, tripId, expenseId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const ref = db.collection('trips').doc(tripId).collection('expenses').doc(expenseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');
  const expense = snap.data();

  if (session.role === 'member') {
    if (expense.enteredBy !== session.memberId) throw new Error('FORBIDDEN');
    if (expense.confirmed) throw new Error('EXPENSE_LOCKED');
  }

  // Best-effort: a storage failure must never block the expense delete.
  if (expense.photoPath) {
    await bucket.file(expense.photoPath).delete().catch(() => {});
  }

  await ref.delete();
  return { ok: true };
}

async function confirmExpense(db, data) {
  const {
    sessionToken, tripId, expenseId, confirmed,
  } = data;
  await requireSession(db, sessionToken, ['admin'], tripId);
  await requireTripEditable(db, tripId);

  const ref = db.collection('trips').doc(tripId).collection('expenses').doc(expenseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');

  await ref.update({ confirmed: !!confirmed, confirmedAt: confirmed ? Date.now() : null });
  return { ok: true };
}

async function setExpenseExclusions(db, data) {
  const {
    sessionToken, tripId, expenseIds, excludedMemberIds,
  } = data;
  await requireSession(db, sessionToken, ['admin'], tripId);
  await requireTripEditable(db, tripId);

  if (!Array.isArray(expenseIds)) throw new Error('EXPENSE_NOT_FOUND');
  await assertMemberIdsExist(db, tripId, excludedMemberIds, 'INVALID_EXCLUDED_MEMBERS');

  const expensesRef = db.collection('trips').doc(tripId).collection('expenses');
  const snaps = await Promise.all(expenseIds.map((id) => expensesRef.doc(id).get()));
  if (snaps.some((s) => !s.exists)) throw new Error('EXPENSE_NOT_FOUND');

  await Promise.all(expenseIds.map((id) => expensesRef.doc(id).update({
    excludedMembers: excludedMemberIds, updatedAt: Date.now(),
  })));
  return { ok: true };
}

/**
 * Flags an expense as a stop on the trip's route map.
 *
 * Deliberately looser than updateExpense, which limits members to their own
 * unconfirmed entries. The route map is assembled after the trip, when every
 * expense is confirmed and the trip may be marked complete -- inheriting those
 * rules would make the feature unusable exactly when it is wanted. It changes
 * one boolean and touches no money, which is why setMemberSettled and
 * setMyAccount skip requireTripEditable for the same reason.
 */
async function setExpenseWaypoint(db, data) {
  const { sessionToken, tripId, expenseId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const ref = db.collection('trips').doc(tripId).collection('expenses').doc(expenseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');

  await ref.update({ isWaypoint: !!data.isWaypoint, updatedAt: Date.now() });
  return { ok: true };
}

module.exports = {
  listExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  confirmExpense,
  setExpenseExclusions,
  setExpenseWaypoint,
};
