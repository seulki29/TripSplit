const { requireSession } = require('../lib/sessions');
const { CATEGORIES } = require('../lib/categories');

async function listExpenses(db, data) {
  await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
  const snap = await db.collection('trips').doc(data.tripId).collection('expenses').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function addExpense(db, data) {
  const {
    sessionToken, tripId, date, category, amount, merchant, detail, photoUrl,
  } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  if (!CATEGORIES.includes(category)) throw new Error('INVALID_CATEGORY');
  if (!(Number(amount) > 0)) throw new Error('INVALID_AMOUNT');

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
    photoUrl: photoUrl || null,
    confirmed: false,
    confirmedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { expenseId: ref.id };
}

async function updateExpense(db, data) {
  const {
    sessionToken, tripId, expenseId, patch,
  } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);

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
  if ('photoUrl' in patch) update.photoUrl = patch.photoUrl;

  update.updatedAt = Date.now();
  await ref.update(update);
  return { ok: true };
}

async function deleteExpense(db, data) {
  const { sessionToken, tripId, expenseId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const ref = db.collection('trips').doc(tripId).collection('expenses').doc(expenseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');
  const expense = snap.data();

  if (session.role === 'member') {
    if (expense.enteredBy !== session.memberId) throw new Error('FORBIDDEN');
    if (expense.confirmed) throw new Error('EXPENSE_LOCKED');
  }

  await ref.delete();
  return { ok: true };
}

async function confirmExpense(db, data) {
  const {
    sessionToken, tripId, expenseId, confirmed,
  } = data;
  await requireSession(db, sessionToken, ['admin'], tripId);

  const ref = db.collection('trips').doc(tripId).collection('expenses').doc(expenseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');

  await ref.update({ confirmed: !!confirmed, confirmedAt: confirmed ? Date.now() : null });
  return { ok: true };
}

module.exports = {
  listExpenses, addExpense, updateExpense, deleteExpense, confirmExpense,
};
