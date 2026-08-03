const { requireSession } = require('../lib/sessions');
const { requireTripEditable } = require('../lib/tripStatus');
const { CATEGORIES } = require('../lib/categories');
const { assertMemberIdsExist } = require('../lib/memberIds');

const DEFAULT_PLAN_ID = 'default';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 100;
const MAX_DETAIL = 500;
const MAX_PLACE = 200;
const MAX_MIN = 1440;

function schedulesRef(db, tripId) {
  return db.collection('trips').doc(tripId).collection('schedules');
}

function plansRef(db, tripId) {
  return db.collection('trips').doc(tripId).collection('plans');
}

/**
 * Reads the default plan and creates it only when absent.
 *
 * Why not set(..., { merge: true }): merge preserves only the fields you
 * don't pass and overwrites the ones you do. Since listSchedules is called
 * on every tab open, that would refresh createdAt every time and revert a
 * renamed plan back to '1안'.
 *
 * The remaining race (two calls both observing !exists at once) is harmless:
 * the doc id is fixed, so no duplicate document is created — only createdAt
 * may differ by a few milliseconds.
 *
 * Runs regardless of trip status: this is an internal container, not
 * user-authored content.
 */
async function ensureDefaultPlan(db, tripId, session) {
  const ref = plansRef(db, tripId).doc(DEFAULT_PLAN_ID);
  const snap = await ref.get();
  if (snap.exists) return;

  const now = Date.now();
  await ref.set({
    name: '1안',
    isActive: true,
    createdBy: session.memberId || null,
    createdByRole: session.role,
    createdAt: now,
    updatedAt: now,
  });
}

function validateText(value, max) {
  const s = String(value ?? '');
  if (s.length > max) throw new Error('SCHEDULE_TEXT_TOO_LONG');
  return s;
}

function validateTitle(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > MAX_TITLE) throw new Error('TITLE_REQUIRED');
  return s;
}

function validateDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw new Error('INVALID_SCHEDULE_DATE');
  return value;
}

/**
 * startMin/endMin must both be null or both be valid minute values.
 * A time without a date is rejected — there's no way to know which day's
 * 11am it refers to.
 */
function validateTimes(date, startMin, endMin) {
  const bothNull = (startMin === null || startMin === undefined)
    && (endMin === null || endMin === undefined);
  if (bothNull) return { startMin: null, endMin: null };

  if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) {
    throw new Error('INVALID_SCHEDULE_TIME');
  }
  if (startMin < 0 || endMin > MAX_MIN || endMin <= startMin) {
    throw new Error('INVALID_SCHEDULE_TIME');
  }
  if (!date) throw new Error('INVALID_SCHEDULE_TIME');

  return { startMin, endMin };
}

function validateCategory(value) {
  if (!CATEGORIES.includes(value)) throw new Error('INVALID_CATEGORY');
  return value;
}

async function validateParticipants(db, tripId, participants) {
  if (!Array.isArray(participants)) throw new Error('INVALID_PARTICIPANTS');
  const unique = [...new Set(participants)];
  await assertMemberIdsExist(db, tripId, unique, 'INVALID_PARTICIPANTS');
  return unique;
}

async function assertPlanExists(db, tripId, planId) {
  const snap = await plansRef(db, tripId).doc(planId).get();
  if (!snap.exists) throw new Error('PLAN_NOT_FOUND');
}

async function listSchedules(db, data) {
  const session = await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
  await ensureDefaultPlan(db, data.tripId, session);

  const [planSnap, scheduleSnap] = await Promise.all([
    plansRef(db, data.tripId).get(),
    schedulesRef(db, data.tripId).get(),
  ]);

  return {
    plans: planSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    schedules: scheduleSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

async function addSchedule(db, data) {
  const { sessionToken, tripId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const planId = data.planId || DEFAULT_PLAN_ID;
  await assertPlanExists(db, tripId, planId);

  const title = validateTitle(data.title);
  const detail = validateText(data.detail, MAX_DETAIL);
  const placeName = validateText(data.placeName, MAX_PLACE);
  const category = validateCategory(data.category);
  const date = validateDate(data.date);
  const { startMin, endMin } = validateTimes(date, data.startMin, data.endMin);
  const participants = await validateParticipants(db, tripId, data.participants || []);

  const now = Date.now();
  const ref = await schedulesRef(db, tripId).add({
    planId,
    title,
    detail,
    category,
    placeName,
    date,
    startMin,
    endMin,
    participants,
    createdBy: session.memberId || null,
    createdByRole: session.role,
    updatedBy: session.memberId || null,
    updatedByRole: session.role,
    createdAt: now,
    updatedAt: now,
  });

  return { scheduleId: ref.id };
}

async function updateSchedule(db, data) {
  const { sessionToken, tripId, scheduleId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const ref = schedulesRef(db, tripId).doc(scheduleId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('SCHEDULE_NOT_FOUND');
  const current = snap.data();

  // Unlike expenses, there is no ownership restriction — schedules are a
  // shared planning document.
  const patch = data.patch || {};
  const update = {};

  if ('title' in patch) update.title = validateTitle(patch.title);
  if ('detail' in patch) update.detail = validateText(patch.detail, MAX_DETAIL);
  if ('placeName' in patch) update.placeName = validateText(patch.placeName, MAX_PLACE);
  if ('category' in patch) update.category = validateCategory(patch.category);

  // Date and time are entangled, so any side missing from the patch is
  // pulled from the stored value and validated together. This prevents,
  // e.g., moving only endMin earlier than the stored startMin.
  const nextDate = 'date' in patch ? validateDate(patch.date) : (current.date ?? null);
  const nextStart = 'startMin' in patch ? patch.startMin : (current.startMin ?? null);
  const nextEnd = 'endMin' in patch ? patch.endMin : (current.endMin ?? null);
  const touchesTime = 'date' in patch || 'startMin' in patch || 'endMin' in patch;

  if (touchesTime) {
    const times = validateTimes(nextDate, nextStart, nextEnd);
    update.date = nextDate;
    update.startMin = times.startMin;
    update.endMin = times.endMin;
  }

  if ('participants' in patch) {
    update.participants = await validateParticipants(db, tripId, patch.participants);
  }

  update.updatedBy = session.memberId || null;
  update.updatedByRole = session.role;
  update.updatedAt = Date.now();

  await ref.update(update);
  return { ok: true };
}

async function deleteSchedule(db, data) {
  const { sessionToken, tripId, scheduleId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const ref = schedulesRef(db, tripId).doc(scheduleId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('SCHEDULE_NOT_FOUND');

  await ref.delete();
  return { ok: true };
}

module.exports = {
  listSchedules, addSchedule, updateSchedule, deleteSchedule, DEFAULT_PLAN_ID,
};
