# Per-Expense Exclusion + Report Completion Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 10 (E2E) and 11 (production deploy/smoke) are controller-run — do NOT dispatch them to a subagent.

**Goal:** Replace per-member category exclusion with precise per-expense member exclusion (rewriting the settlement engine), and complete the report page (조건 summary, receipt-click modal, account + 입금완료 tracking, gallery) while re-homing the report as an in-frame admin tab.

**Architecture:** Backend stays Firebase Cloud Functions v2 (CommonJS) + Firestore + Storage. The settlement engine moves from category-level to expense-level allocation. Three new callables (`setExpenseExclusions`, `setMemberSettled`, `listReceiptUrls`). Frontend stays the no-build vanilla-JS SPA; `report.js` is refactored to render in-frame inside the admin console tab.

**Tech Stack:** firebase-functions v2, firebase-admin, Jest (backend); vanilla ES modules + node:test (frontend).

**Spec:** `docs/superpowers/specs/2026-07-27-expense-exclusion-and-report-design.md`

## Global Constraints

- Exclusion is per-expense: each expense document carries `excludedMembers: string[]` (member doc IDs). Members no longer carry `excludedCategories` (stop reading/writing it; leftover fields on old docs are ignored).
- Settlement: for each **confirmed** expense, split `amount` among members NOT in that expense's `excludedMembers` **and** with `weight > 0`, proportional to weight, using largest-remainder integer rounding so shares sum exactly to `amount`. Empty included set → that expense allocates 0 to everyone.
- `setExpenseExclusions(tripId, expenseIds, excludedMemberIds)` **sets** (overwrites) each listed expense's `excludedMembers` to `excludedMemberIds`. Admin only.
- `setMemberSettled(tripId, memberId, settled)` toggles a member's `settled` boolean. Admin only.
- `listReceiptUrls(tripId)` returns `[{ expenseId, url }]` (15-min signed URLs) for confirmed expenses that have a `photoPath`. Admin + member.
- Member bank account is stored in `member.account` (already allowlisted in `updateMember`; `addMember` already writes `account: null`). Member `settled` defaults to `false`.
- Authorization: 제외설정 and 입금완료 toggle are **admin only**; members see them read-only.
- Region/project unchanged (asia-northeast3, sfayw-10d11). No framework/build step. Category list stays `['숙박','식비','장보기','교통비']`.
- Backend tests: `cd functions && npm test` (Jest). Frontend tests: `npm test` at repo root (node:test). Both green at every commit.
- Production has only throwaway smoke data → no data migration needed.

## File Structure

```
functions/src/lib/settlement.js              # MODIFY Task 1 — per-expense allocation
functions/test/lib/settlement.test.js        # MODIFY Task 1
functions/src/functions/expenses.js          # MODIFY Task 2 — excludedMembers + setExpenseExclusions
functions/test/functions/expenses.test.js    # MODIFY Task 2
functions/src/functions/members.js           # MODIFY Task 3 — drop excludedCategories, add settled + setMemberSettled
functions/test/functions/members.test.js     # MODIFY Task 3
functions/src/functions/report.js            # MODIFY Task 4 — new averages, return fields, listReceiptUrls
functions/test/functions/report.test.js      # MODIFY Task 4
functions/index.js                           # MODIFY Tasks 2,3,4 — wire new callables
public/views/report.js                       # MODIFY Tasks 5,6 — renderReportInto + content
public/views/admin.js                        # MODIFY Tasks 5,7,8 — report tab, member modal, 제외설정
public/views/member.js                       # MODIFY Tasks 5,9 — in-frame report, exclusion labels
public/app.js                                # MODIFY Task 5 (only if route wiring needs it)
public/style.css                             # MODIFY Task 5 — .tabs scrollbar
```

---

### Task 1: Per-expense settlement engine

**Files:**
- Modify: `functions/src/lib/settlement.js`
- Test: `functions/test/lib/settlement.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `computeSettlement(members, expenses)` unchanged signature/return shape (`{ categoryTotals, totalConfirmed, perMember }`, `perMember` = `[{id,name,due,paid,net}]`), but `due` now comes from per-expense allocation using `expense.excludedMembers`. `allocateInteger(total, weights)` is unchanged and still exported.

- [ ] **Step 1: Replace the settlement tests' exclusion model**

In `functions/test/lib/settlement.test.js`, the existing tests build members with `excludedCategories` and expect category-level exclusion. Rewrite the exclusion-related tests to the per-expense model. Keep the `allocateInteger` tests as-is. Add/replace with these cases (adapt to the file's existing member/expense factory style; members are `{id,name,weight}` — no excludedCategories; expenses are `{category,amount,enteredBy,confirmed,excludedMembers}`):

```js
test('splits a confirmed expense among non-excluded members by weight', () => {
  const members = [
    { id: 'a', name: 'A', weight: 1 },
    { id: 'b', name: 'B', weight: 1 },
    { id: 'c', name: 'C', weight: 1 },
  ];
  const expenses = [
    { category: '식비', amount: 30000, enteredBy: 'a', confirmed: true, excludedMembers: [] },
    { category: '식비', amount: 10000, enteredBy: 'b', confirmed: true, excludedMembers: ['c'] },
  ];
  const { perMember } = computeSettlement(members, expenses);
  const due = Object.fromEntries(perMember.map((m) => [m.id, m.due]));
  // 30000 split 3 ways = 10000 each; 10000 split between a,b = 5000 each; c excluded from the second
  expect(due).toEqual({ a: 15000, b: 15000, c: 10000 });
  const paid = Object.fromEntries(perMember.map((m) => [m.id, m.paid]));
  expect(paid).toEqual({ a: 30000, b: 10000, c: 0 });
  const net = Object.fromEntries(perMember.map((m) => [m.id, m.net]));
  expect(net).toEqual({ a: 15000, b: -5000, c: -10000 });
});

test('ignores unconfirmed expenses', () => {
  const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }];
  const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: false, excludedMembers: [] }];
  const { perMember, totalConfirmed } = computeSettlement(members, expenses);
  expect(totalConfirmed).toBe(0);
  expect(perMember.every((m) => m.due === 0 && m.paid === 0)).toBe(true);
});

test('a member excluded from every expense owes nothing', () => {
  const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }];
  const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: true, excludedMembers: ['b'] }];
  const { perMember } = computeSettlement(members, expenses);
  expect(perMember.find((m) => m.id === 'b').due).toBe(0);
  expect(perMember.find((m) => m.id === 'a').due).toBe(10000);
});

test('an expense excluding everyone allocates nothing (no crash)', () => {
  const members = [{ id: 'a', name: 'A', weight: 1 }];
  const expenses = [{ category: '식비', amount: 5000, enteredBy: 'a', confirmed: true, excludedMembers: ['a'] }];
  const { perMember } = computeSettlement(members, expenses);
  expect(perMember.find((m) => m.id === 'a').due).toBe(0);
});

test('weight-zero members receive no share', () => {
  const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 0 }];
  const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];
  const { perMember } = computeSettlement(members, expenses);
  expect(perMember.find((m) => m.id === 'a').due).toBe(10000);
  expect(perMember.find((m) => m.id === 'b').due).toBe(0);
});

test('per-expense rounding still sums each expense exactly', () => {
  const members = [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 1 }, { id: 'c', name: 'C', weight: 1 }];
  const expenses = [{ category: '식비', amount: 10000, enteredBy: 'a', confirmed: true, excludedMembers: [] }];
  const { perMember } = computeSettlement(members, expenses);
  const totalDue = perMember.reduce((s, m) => s + m.due, 0);
  expect(totalDue).toBe(10000); // 3334 + 3333 + 3333
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && npx jest test/lib/settlement.test.js`
Expected: FAIL — current `computeSettlement` reads `m.excludedCategories.includes(...)` and allocates per category, so the new per-expense expectations (and the members without `excludedCategories`) fail or throw.

- [ ] **Step 3: Rewrite `computeSettlement` in `functions/src/lib/settlement.js`**

Keep `allocateInteger` exactly as-is. Replace `computeSettlement` with:

```js
function computeSettlement(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);

  const categoryTotals = {};
  for (const e of confirmed) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }

  const dueByMember = {};
  for (const m of members) dueByMember[m.id] = 0;

  for (const e of confirmed) {
    const excluded = new Set(e.excludedMembers || []);
    const eligible = members.filter((m) => !excluded.has(m.id));
    const weights = eligible.map((m) => ({ id: m.id, weight: m.weight }));
    const allocation = allocateInteger(e.amount, weights);
    for (const a of allocation) {
      dueByMember[a.id] += a.amount;
    }
  }

  const paidByMember = {};
  for (const m of members) paidByMember[m.id] = 0;
  for (const e of confirmed) {
    paidByMember[e.enteredBy] = (paidByMember[e.enteredBy] || 0) + e.amount;
  }

  const totalConfirmed = confirmed.reduce((sum, e) => sum + e.amount, 0);

  const perMember = members.map((m) => ({
    id: m.id,
    name: m.name,
    due: dueByMember[m.id] || 0,
    paid: paidByMember[m.id] || 0,
    net: (paidByMember[m.id] || 0) - (dueByMember[m.id] || 0),
  }));

  return { categoryTotals, totalConfirmed, perMember };
}
```

(`allocateInteger` already returns 0 for all when the eligible weight sum is 0, covering the all-excluded and all-zero-weight edges.)

- [ ] **Step 4: Run settlement tests, then the full backend suite**

Run: `cd functions && npx jest test/lib/settlement.test.js` → PASS.
Run: `cd functions && npm test` → EXPECTED failures only in `test/functions/report.test.js` (its `perPersonCategoryAverage` still references `excludedCategories`) and possibly `expenses`/`members` tests that seed `excludedCategories`; those are Tasks 2-4. Every other suite must pass. If anything unexpected fails, fix before committing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/settlement.js functions/test/lib/settlement.test.js
git commit -m "feat(functions): allocate settlement per-expense with member exclusion"
```

---

### Task 2: Expense `excludedMembers` + `setExpenseExclusions`

**Files:**
- Modify: `functions/src/functions/expenses.js`
- Modify: `functions/index.js`
- Test: `functions/test/functions/expenses.test.js`

**Interfaces:**
- Consumes: `requireSession`.
- Produces: `addExpense` writes `excludedMembers: []` (or the validated provided array); `updateExpense` allowlist accepts `excludedMembers`; new `setExpenseExclusions(db, data)` with `data = { sessionToken, tripId, expenseIds, excludedMemberIds }` (admin) that validates all ids belong to the trip and sets each expense's `excludedMembers` to `excludedMemberIds`. Errors: `EXPENSE_NOT_FOUND`, `INVALID_EXCLUDED_MEMBERS`. Exported and wired as `exports.setExpenseExclusions`.

- [ ] **Step 1: Add tests** to `functions/test/functions/expenses.test.js` (use the file's existing seeding helpers; a trip with members m1,m2 and an admin session):

```js
describe('excludedMembers on expenses', () => {
  test('addExpense defaults excludedMembers to []', async () => {
    const { db, memberToken, tripId, memberId } = await seed(); // member session
    const { expenseId } = await addExpense(db, { sessionToken: memberToken, tripId, category: '식비', amount: 1000, date: '2026-08-01' });
    const snap = await db.collection('trips').doc(tripId).collection('expenses').doc(expenseId).get();
    expect(snap.data().excludedMembers).toEqual([]);
  });

  test('addExpense accepts a valid excludedMembers array', async () => {
    const { db, memberToken, tripId, otherMemberId } = await seed();
    const { expenseId } = await addExpense(db, { sessionToken: memberToken, tripId, category: '식비', amount: 1000, date: '2026-08-01', excludedMembers: [otherMemberId] });
    const snap = await db.collection('trips').doc(tripId).collection('expenses').doc(expenseId).get();
    expect(snap.data().excludedMembers).toEqual([otherMemberId]);
  });

  test('addExpense rejects an excludedMembers id not in the trip', async () => {
    const { db, memberToken, tripId } = await seed();
    await expect(addExpense(db, { sessionToken: memberToken, tripId, category: '식비', amount: 1000, date: '2026-08-01', excludedMembers: ['ghost'] }))
      .rejects.toThrow('INVALID_EXCLUDED_MEMBERS');
  });
});

describe('setExpenseExclusions', () => {
  test('overwrites excludedMembers on all listed expenses (admin)', async () => {
    const { db, adminToken, memberToken, tripId, memberId, otherMemberId } = await seed();
    const a = (await addExpense(db, { sessionToken: memberToken, tripId, category: '식비', amount: 1000, date: '2026-08-01' })).expenseId;
    const b = (await addExpense(db, { sessionToken: memberToken, tripId, category: '식비', amount: 2000, date: '2026-08-01' })).expenseId;
    await setExpenseExclusions(db, { sessionToken: adminToken, tripId, expenseIds: [a, b], excludedMemberIds: [otherMemberId] });
    for (const id of [a, b]) {
      const snap = await db.collection('trips').doc(tripId).collection('expenses').doc(id).get();
      expect(snap.data().excludedMembers).toEqual([otherMemberId]);
    }
  });

  test('clears exclusions when excludedMemberIds is empty', async () => {
    const { db, adminToken, memberToken, tripId, otherMemberId } = await seed();
    const a = (await addExpense(db, { sessionToken: memberToken, tripId, category: '식비', amount: 1000, date: '2026-08-01', excludedMembers: [otherMemberId] })).expenseId;
    await setExpenseExclusions(db, { sessionToken: adminToken, tripId, expenseIds: [a], excludedMemberIds: [] });
    const snap = await db.collection('trips').doc(tripId).collection('expenses').doc(a).get();
    expect(snap.data().excludedMembers).toEqual([]);
  });

  test('rejects EXPENSE_NOT_FOUND if any id is missing', async () => {
    const { db, adminToken, tripId } = await seed();
    await expect(setExpenseExclusions(db, { sessionToken: adminToken, tripId, expenseIds: ['nope'], excludedMemberIds: [] }))
      .rejects.toThrow('EXPENSE_NOT_FOUND');
  });

  test('rejects INVALID_EXCLUDED_MEMBERS for an unknown member id', async () => {
    const { db, adminToken, memberToken, tripId } = await seed();
    const a = (await addExpense(db, { sessionToken: memberToken, tripId, category: '식비', amount: 1000, date: '2026-08-01' })).expenseId;
    await expect(setExpenseExclusions(db, { sessionToken: adminToken, tripId, expenseIds: [a], excludedMemberIds: ['ghost'] }))
      .rejects.toThrow('INVALID_EXCLUDED_MEMBERS');
  });

  test('rejects a non-admin session', async () => {
    const { db, memberToken, tripId } = await seed();
    await expect(setExpenseExclusions(db, { sessionToken: memberToken, tripId, expenseIds: [], excludedMemberIds: [] }))
      .rejects.toThrow();
  });
});
```

Import `setExpenseExclusions` alongside the other expense functions. Adapt the seed helper's returned ids to the file's actual conventions.

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/functions/expenses.test.js`
Expected: FAIL — `setExpenseExclusions` undefined; `excludedMembers` not written.

- [ ] **Step 3: Implement in `functions/src/functions/expenses.js`**

Add a helper and wire it into `addExpense`/`updateExpense`, and add `setExpenseExclusions`:

```js
async function validateMemberIds(db, tripId, ids) {
  if (!Array.isArray(ids)) throw new Error('INVALID_EXCLUDED_MEMBERS');
  if (ids.length === 0) return;
  const membersRef = db.collection('trips').doc(tripId).collection('members');
  const snaps = await Promise.all(ids.map((id) => membersRef.doc(id).get()));
  if (snaps.some((s) => !s.exists)) throw new Error('INVALID_EXCLUDED_MEMBERS');
}
```

In `addExpense`, after the existing validation and before the `.add(...)`, add:

```js
  const excludedMembers = data.excludedMembers || [];
  await validateMemberIds(db, tripId, excludedMembers);
```

and include `excludedMembers,` in the added document object.

In `updateExpense`'s allowlist, add:

```js
  if ('excludedMembers' in patch) {
    await validateMemberIds(db, tripId, patch.excludedMembers);
    update.excludedMembers = patch.excludedMembers;
  }
```

Add the new function:

```js
async function setExpenseExclusions(db, data) {
  const {
    sessionToken, tripId, expenseIds, excludedMemberIds,
  } = data;
  await requireSession(db, sessionToken, ['admin'], tripId);

  if (!Array.isArray(expenseIds)) throw new Error('EXPENSE_NOT_FOUND');
  await validateMemberIds(db, tripId, excludedMemberIds);

  const expensesRef = db.collection('trips').doc(tripId).collection('expenses');
  const snaps = await Promise.all(expenseIds.map((id) => expensesRef.doc(id).get()));
  if (snaps.some((s) => !s.exists)) throw new Error('EXPENSE_NOT_FOUND');

  await Promise.all(expenseIds.map((id) => expensesRef.doc(id).update({
    excludedMembers: excludedMemberIds, updatedAt: Date.now(),
  })));
  return { ok: true };
}
```

Add `setExpenseExclusions` to `module.exports`.

- [ ] **Step 4: Wire in `functions/index.js`**

```js
exports.setExpenseExclusions = onCall(wrap(expenses.setExpenseExclusions));
```

- [ ] **Step 5: Run the full backend suite; commit**

Run: `cd functions && npm test` → expenses tests pass (report/members tasks may still be red — that's Tasks 3-4).

```bash
git add functions/src/functions/expenses.js functions/test/functions/expenses.test.js functions/index.js
git commit -m "feat(functions): per-expense excludedMembers and setExpenseExclusions"
```

---

### Task 3: Members — drop `excludedCategories`, add `settled` + `setMemberSettled`

**Files:**
- Modify: `functions/src/functions/members.js`
- Modify: `functions/index.js`
- Test: `functions/test/functions/members.test.js`

**Interfaces:**
- Produces: `addMember` writes `{ name, weight, account: null, settled: false }` (no `excludedCategories`); `updateMember` allowlist keeps `name`/`weight`/`account`, drops `excludedCategories`; new `setMemberSettled(db, data)` with `data = { sessionToken, tripId, memberId, settled }` (admin) sets `member.settled = !!settled`. Error: `MEMBER_NOT_FOUND`. Exported and wired.

- [ ] **Step 1: Update tests** in `functions/test/functions/members.test.js`:
- Remove/replace tests asserting `excludedCategories` handling. Update the addMember shape assertion to expect `settled: false` and no `excludedCategories`.
- Add:

```js
describe('setMemberSettled', () => {
  test('marks a member settled and unsettled (admin)', async () => {
    const { db, adminToken, tripId, memberId } = await seed();
    await setMemberSettled(db, { sessionToken: adminToken, tripId, memberId, settled: true });
    let snap = await db.collection('trips').doc(tripId).collection('members').doc(memberId).get();
    expect(snap.data().settled).toBe(true);
    await setMemberSettled(db, { sessionToken: adminToken, tripId, memberId, settled: false });
    snap = await db.collection('trips').doc(tripId).collection('members').doc(memberId).get();
    expect(snap.data().settled).toBe(false);
  });

  test('rejects MEMBER_NOT_FOUND', async () => {
    const { db, adminToken, tripId } = await seed();
    await expect(setMemberSettled(db, { sessionToken: adminToken, tripId, memberId: 'nope', settled: true }))
      .rejects.toThrow('MEMBER_NOT_FOUND');
  });

  test('rejects a non-admin session', async () => {
    const { db, memberToken, tripId, memberId } = await seed();
    await expect(setMemberSettled(db, { sessionToken: memberToken, tripId, memberId, settled: true }))
      .rejects.toThrow();
  });
});
```

Import `setMemberSettled`. Adapt to seeding conventions.

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/functions/members.test.js` → FAIL (`setMemberSettled` undefined; addMember still writes `excludedCategories`).

- [ ] **Step 3: Implement in `functions/src/functions/members.js`**

In `addMember`: delete the `excludedCategories` validation block (lines building/validating `excludedCategories`) and change the `.add(...)` object to:

```js
  const ref = await membersRef.add({
    name,
    weight,
    account: null,
    settled: false,
  });
```

In `updateMember`: delete the `excludedCategories` allowlist block (the `if (patch.excludedCategories !== undefined) {...}`). Keep name/weight/account.

Add:

```js
async function setMemberSettled(db, data) {
  const { tripId, memberId, settled } = data;
  await requireSession(db, data.sessionToken, ['admin'], tripId);

  const memberRef = db.collection('trips').doc(tripId).collection('members').doc(memberId);
  const snap = await memberRef.get();
  if (!snap.exists) throw new Error('MEMBER_NOT_FOUND');

  await memberRef.update({ settled: !!settled });
  return { ok: true };
}
```

Add `setMemberSettled` to `module.exports`.

- [ ] **Step 4: Wire in `functions/index.js`**

```js
exports.setMemberSettled = onCall(wrap(members.setMemberSettled));
```

- [ ] **Step 5: Run the full backend suite; commit**

Run: `cd functions && npm test` (report test still red until Task 4).

```bash
git add functions/src/functions/members.js functions/test/functions/members.test.js functions/index.js
git commit -m "feat(functions): drop excludedCategories, add member settled + setMemberSettled"
```

---

### Task 4: Report backend — new averages, extra fields, `listReceiptUrls`

**Files:**
- Modify: `functions/src/functions/report.js`
- Modify: `functions/index.js`
- Test: `functions/test/functions/report.test.js`

**Interfaces:**
- Consumes: `getReceiptReadUrl` from `../lib/storage`.
- Produces: `perPersonCategoryAverage(members, expenses)` recomputed from the per-expense split (no `excludedCategories`); `getReportData` returns `expenses` each including `id`, `photoPath`, `excludedMembers`, and `perMember` entries include `account` and `settled`; new `listReceiptUrls(db, bucket, data)` returning `{ urls: [{ expenseId, url }] }`. Wired as `exports.listReceiptUrls` (uses `wrapWithBucket`).

- [ ] **Step 1: Update `functions/test/functions/report.test.js`**
- Replace the `perPersonCategoryAverage`/`excludedCategories` assertions with the per-expense model. Add an assertion that `getReportData` returns `perMember[i].account` and `.settled`, and that each returned expense has `excludedMembers`.
- Add a `listReceiptUrls` describe (use fake bucket + fake db):

```js
describe('listReceiptUrls', () => {
  test('returns signed URLs for confirmed expenses with a photo', async () => {
    const { db, bucket, memberToken, tripId } = await seed();
    await db.collection('trips').doc(tripId).collection('expenses').doc('e1').set({ confirmed: true, photoPath: 'receipts/t/a.jpg' });
    await db.collection('trips').doc(tripId).collection('expenses').doc('e2').set({ confirmed: false, photoPath: 'receipts/t/b.jpg' });
    await db.collection('trips').doc(tripId).collection('expenses').doc('e3').set({ confirmed: true, photoPath: null });
    const { urls } = await listReceiptUrls(db, bucket, { sessionToken: memberToken, tripId });
    expect(urls.map((u) => u.expenseId)).toEqual(['e1']);
    expect(urls[0].url).toMatch(/^https:\/\/storage\.fake\/receipts\/t\/a\.jpg/);
  });

  test('rejects an unauthenticated session', async () => {
    const { db, bucket, tripId } = await seed();
    await expect(listReceiptUrls(db, bucket, { sessionToken: 'bogus', tripId })).rejects.toThrow('UNAUTHENTICATED');
  });
});
```

Define the redefined-average expectation to match the implementation in Step 3 (per-member category due ÷ members-with-due count). Keep it a focused assertion (e.g., a two-member no-exclusion trip yields `averages[category] === categoryTotal / 2`).

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/functions/report.test.js` → FAIL (`listReceiptUrls` undefined; averages reference removed field; missing return fields).

- [ ] **Step 3: Rewrite `functions/src/functions/report.js`**

Replace `perPersonCategoryAverage` with a per-expense version, add `listReceiptUrls`, and extend `getReportData`'s return:

```js
const { requireSession } = require('../lib/sessions');
const { computeSettlement, allocateInteger } = require('../lib/settlement');
const { getReceiptReadUrl } = require('../lib/storage');

async function loadTripBundle(db, tripId) {
  const membersSnap = await db.collection('trips').doc(tripId).collection('members').get();
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const expensesSnap = await db.collection('trips').doc(tripId).collection('expenses').get();
  const expenses = expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { members, expenses };
}

// Per-person category spend under the per-expense exclusion model: each
// confirmed expense's amount is split by weight among non-excluded members,
// bucketed by the expense's category; the average divides each category's
// total due by the number of members who owe anything in the trip.
function perPersonCategoryAverage(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);
  const categoryDue = {};
  const memberHasDue = new Set();

  for (const e of confirmed) {
    const excluded = new Set(e.excludedMembers || []);
    const eligible = members.filter((m) => !excluded.has(m.id));
    const allocation = allocateInteger(e.amount, eligible.map((m) => ({ id: m.id, weight: m.weight })));
    for (const a of allocation) {
      if (a.amount > 0) memberHasDue.add(a.id);
      categoryDue[e.category] = (categoryDue[e.category] || 0) + a.amount;
    }
  }

  const headcount = memberHasDue.size;
  const averages = {};
  if (headcount > 0) {
    for (const category of Object.keys(categoryDue)) {
      averages[category] = categoryDue[category] / headcount;
    }
  }
  return { averages };
}
```

Keep the `getReportData` body largely the same, but change the returned `expenses`/`perMember` to carry the extra fields. Since `loadTripBundle` already spreads all doc fields, `expenses` already include `photoPath`/`excludedMembers`/`id`; ensure they are returned (they are, via `expenses`). For `perMember`, merge account/settled from members:

```js
  const settlement = computeSettlement(members, expenses);
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  settlement.perMember = settlement.perMember.map((pm) => ({
    ...pm,
    account: byId[pm.id]?.account ?? null,
    settled: byId[pm.id]?.settled ?? false,
  }));
```

(Place this right after `computeSettlement(...)` and before building averages. The rest of `getReportData` — group averages, return object — is unchanged; it already returns `members`, `expenses`, `settlement`, the averages, and `tripsInComparison`.)

Add the new callable:

```js
async function listReceiptUrls(db, bucket, data) {
  const { sessionToken, tripId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const snap = await db.collection('trips').doc(tripId).collection('expenses').get();
  const withPhotos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.confirmed && e.photoPath);

  const urls = await Promise.all(withPhotos.map(async (e) => ({
    expenseId: e.id,
    url: await getReceiptReadUrl(bucket, e.photoPath),
  })));
  return { urls };
}

module.exports = { getReportData, perPersonCategoryAverage, listReceiptUrls };
```

- [ ] **Step 4: Wire in `functions/index.js`**

```js
exports.listReceiptUrls = onCall(wrapWithBucket(report.listReceiptUrls));
```

- [ ] **Step 5: Run the full backend suite; commit**

Run: `cd functions && npm test` → ALL suites pass now (Tasks 1-4 complete the backend). Also `grep -rn "excludedCategories" functions/src` → no matches.

```bash
git add functions/src/functions/report.js functions/test/functions/report.test.js functions/index.js
git commit -m "feat(functions): report averages per-expense, return account/settled, listReceiptUrls"
```

---

### Task 5: Report as in-frame admin tab + tab-bar scrollbar

**Files:**
- Modify: `public/views/report.js`
- Modify: `public/views/admin.js`
- Modify: `public/views/member.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: existing `getReportData`, `getSession`, `openModal`, `escapeHtml`.
- Produces: `report.js` exports `mount` (route) AND `renderReportInto(container, slug)` (embeddable, no page chrome / no 돌아가기). `admin.js` renders the 리포트 tab in-frame via `renderReportInto`. `member.js` toggles the report in-frame. This task moves the EXISTING report content into `renderReportInto` unchanged; Task 6 adds new sections.

- [ ] **Step 1: Refactor `public/views/report.js` to expose `renderReportInto`**

Change the module so the section-building lives in `renderReportInto(container, slug)`, and `mount(root, {slug})` calls it inside a page wrapper. Replace the top of the file:

```js
async function renderReportInto(container, slug) {
  const session = getSession();
  container.innerHTML = '<p class="muted">불러오는 중...</p>';

  const data = await callFunction('getReportData', { tripId: session.tripId });
  const { trip, members, expenses, settlement, currentCategoryAverages, groupCategoryAverages, tripsInComparison } = data;
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const confirmedExpenses = expenses.filter((e) => e.confirmed);

  container.innerHTML = `
    <p class="label">Travel Expense Report</p>
    <h1>${escapeHtml(trip.name)}</h1>
    <p class="muted">${escapeHtml(trip.period?.start || '')} — ${escapeHtml(trip.period?.end || '')} · ${escapeHtml(trip.location || '')} · ${escapeHtml(trip.lodging || '')}</p>

    <div class="section"><h2>전체 지출 내역</h2>${renderExpenseTable(confirmedExpenses, nameById)}</div>
    <div class="section"><h2>카테고리 분석</h2>
      ${renderDonutChart(settlement.categoryTotals)}
      ${tripsInComparison > 0 ? renderComparisonBars(currentCategoryAverages, groupCategoryAverages) : '<p class="muted">비교할 과거 여행이 아직 없습니다.</p>'}
    </div>
    <div class="section"><h2>결제자별 지출</h2>${renderPayerSummary(settlement.perMember)}</div>
    <div class="section"><h2>최종 정산</h2>${renderSettlement(settlement.perMember)}</div>`;
}

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) { location.href = `/t/${slug}`; return; }
  const backHref = session.role === 'admin' ? `/t/${slug}/admin` : `/t/${slug}`;
  root.innerHTML = `<div class="container" style="padding-top:2rem"><p class="center"><a href="${backHref}">← 돌아가기</a></p><div id="report-body"></div></div>`;
  renderReportInto(document.getElementById('report-body'), slug);
}
```

Keep all the `renderExpenseTable`/`renderDonutChart`/`renderComparisonBars`/`renderPayerSummary`/`renderSettlement` helpers as they are. Change the export line to:

```js
export { mount, renderReportInto };
```

- [ ] **Step 2: Render the report inside the admin 리포트 tab (`public/views/admin.js`)**

Add the import at top:

```js
import { renderReportInto } from './report.js';
```

In `render()`'s tab click handler, the `report` tab currently does `location.href`. Change the tabs so `report` is a normal `currentTab` value. Replace the report branch: remove the `if (tab.dataset.tab === 'report') { location.href = ...; return; }` line so clicking 리포트 sets `currentTab = 'report'` and re-renders. In the tab-body dispatch at the bottom of `render()`, add:

```js
  else if (currentTab === 'report') renderReportInto(body, slug);
```

(The `.tab` for report already exists in the markup; give it `class="tab ${currentTab === 'report' ? 'active' : ''}"` like the others so it highlights.)

- [ ] **Step 3: Member in-frame report (`public/views/member.js`)**

Add `import { renderReportInto } from './report.js';`. Replace the "리포트 보기 →" link behaviour so it swaps the member screen content in place: clicking it renders the report into the member container with a "← 경비 목록" link that restores the expense list. (Keep the `/t/<slug>/report` route working via report.js `mount` for direct access.) Implement a small toggle:

```js
// in the member view render, the report link becomes a button:
//   <button type="button" class="btn btn-secondary" id="me-report">리포트 보기 →</button>
// handler:
document.getElementById('me-report').addEventListener('click', async () => {
  root.innerHTML = `<div class="container" style="padding-top:2rem"><p><a href="#" id="me-back">← 경비 목록</a></p><div id="me-report-body"></div></div>`;
  document.getElementById('me-back').addEventListener('click', (ev) => { ev.preventDefault(); loadExpenses(root, slug); });
  await renderReportInto(document.getElementById('me-report-body'), slug);
});
```

(Adapt to `member.js`'s actual render/loadExpenses function names.)

- [ ] **Step 4: Tab-bar scrollbar (`public/style.css`)**

Update `.tabs` to hide the scrollbar chrome while keeping horizontal scroll:

```css
.tabs { display: flex; border-bottom: 2px solid var(--rule); margin-bottom: 1.5rem; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
```

(If the report tab now renders wide tables inside the tab body, confirm the report table's own horizontal overflow is contained in a scroll wrapper so it doesn't force the whole page to scroll — the report table already sits in the tab body; wrap it in `overflow-x:auto` if needed.)

- [ ] **Step 5: Run frontend tests, then commit**

Run: `npm test` (root) → 38/38 (these are logic tests; view changes shouldn't break them — if `router.test.js` asserts the report route, keep the route working).

```bash
git add public/views/report.js public/views/admin.js public/views/member.js public/style.css
git commit -m "feat(frontend): render report in-frame as admin tab, hide tab scrollbar"
```

---

### Task 6: Report content — 조건, receipt modal, account + 입금완료, 갤러리

**Files:**
- Modify: `public/views/report.js`

**Interfaces:**
- Consumes: `getReportData` (now returns expense `id`/`photoPath`/`excludedMembers`, perMember `account`/`settled`), `getReceiptUrl`, `listReceiptUrls`, `setMemberSettled`, `getSession`, `openModal`, `showToast`, `escapeHtml`.
- Produces: report renders the four completed sections. No new exports.

- [ ] **Step 1: Add the 조건 section** — insert before 전체 지출 내역 in `renderReportInto`'s template:

```js
    <div class="section"><h2>정산 조건</h2>
      <p class="muted" style="font-size:13px">확정된 지출만 집계합니다. 각 지출은 제외되지 않은 구성원끼리 가중치 비율로 분담하고, 실제 결제액과 비교해 받을 돈/낼 돈을 계산합니다.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:0.6rem">
        <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)"><th style="padding:0.4rem">구성원</th><th style="text-align:right">가중치</th></tr></thead>
        <tbody>${members.map((m) => `<tr style="border-top:1px solid var(--rule)"><td style="padding:0.4rem">${escapeHtml(m.name)}</td><td style="text-align:right" class="mono">${m.weight}</td></tr>`).join('')}</tbody>
      </table>
    </div>`
```

- [ ] **Step 2: Excluded-member labels + receipt click in the expense table** — update `renderExpenseTable` to accept `nameById` and render, per row: an "제외: …" note when `e.excludedMembers?.length`, and a clickable 영수증 when `e.photoPath`. Add a delegated click handler after `container.innerHTML = ...` that, for `.report-receipt` buttons, calls `getReceiptUrl({tripId, expenseId})` and opens the image in `openModal` (mirror admin.js). Full code:

```js
function renderExpenseTable(expenses, nameById) {
  return `
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)">
        <th style="padding:0.5rem">날짜</th><th>카테고리</th><th>내용</th><th>결제자</th><th style="text-align:right">금액</th>
      </tr></thead>
      <tbody>
        ${expenses.map((e) => `
          <tr style="border-top:1px solid var(--rule)">
            <td style="padding:0.6rem 0.5rem">${escapeHtml(e.date)}</td>
            <td><span class="tag">${e.category}</span></td>
            <td>${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}
              ${e.excludedMembers && e.excludedMembers.length ? `<span class="muted" style="font-size:11px">· 제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</span>` : ''}
              ${e.photoPath ? `<button type="button" class="report-receipt" data-id="${e.id}" style="font-size:11px;background:none;border:none;color:var(--accent);cursor:pointer">영수증</button>` : ''}
            </td>
            <td>${escapeHtml(nameById[e.enteredBy] || '?')}</td>
            <td style="text-align:right" class="mono">${Number(e.amount).toLocaleString()}원</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
```

After `container.innerHTML = ...` in `renderReportInto`, add:

```js
  const session2 = getSession();
  container.querySelectorAll('.report-receipt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session2.tripId, expenseId: btn.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증">`);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
```

(Import `showToast` from `../ui.js`.)

- [ ] **Step 3: Account + 입금완료 in the settlement card** — rewrite `renderSettlement` to show account and a settle control, and wire the toggle. `renderSettlement(perMember, isAdmin)`:

```js
function renderSettlement(perMember, isAdmin) {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)">
      ${perMember.map((m) => `
        <div style="background:var(--paper);padding:1rem">
          <p style="font-family:var(--f-kr);font-weight:500">${escapeHtml(m.name)}
            ${m.settled ? '<span class="badge badge-locked" style="margin-left:0.4rem">입금완료</span>' : ''}</p>
          <p class="muted" style="font-size:12px">내야 할 금액 ${m.due.toLocaleString()}원 · 실제 지출 ${m.paid.toLocaleString()}원</p>
          <p class="mono" style="font-family:var(--f-display);font-weight:700;color:var(--${m.net >= 0 ? 'receive' : 'pay'})">${m.net >= 0 ? '+' : ''}${m.net.toLocaleString()}원</p>
          ${m.account ? `<p class="muted" style="font-size:12px">계좌 ${escapeHtml(m.account)}</p>` : ''}
          ${isAdmin ? `<button type="button" class="btn btn-secondary settle-toggle" data-id="${m.id}" data-settled="${m.settled}" style="margin-top:0.4rem">${m.settled ? '입금완료 해제' : '입금완료 표시'}</button>` : ''}
        </div>`).join('')}
    </div>`;
}
```

Pass `session.role === 'admin'` when calling it in the template, and after render add the toggle handler (re-render the report after toggling):

```js
  container.querySelectorAll('.settle-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await callFunction('setMemberSettled', { tripId: session2.tripId, memberId: btn.dataset.id, settled: btn.dataset.settled !== 'true' });
        await renderReportInto(container, slug);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
```

- [ ] **Step 4: 갤러리 section** — append after 최종 정산, then load thumbnails:

```js
    <div class="section"><h2>영수증 갤러리</h2><div id="report-gallery"><p class="muted">불러오는 중...</p></div></div>
```

After render:

```js
  try {
    const { urls } = await callFunction('listReceiptUrls', { tripId: session2.tripId });
    const gal = container.querySelector('#report-gallery');
    gal.innerHTML = urls.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px">${urls.map((u) => `<img src="${escapeHtml(u.url)}" data-id="${u.expenseId}" class="gallery-thumb" style="width:100%;height:90px;object-fit:cover;border-radius:4px;cursor:pointer" alt="영수증">`).join('')}</div>`
      : '<p class="muted">영수증 사진이 없습니다.</p>';
    gal.querySelectorAll('.gallery-thumb').forEach((img) => img.addEventListener('click', () => openModal('영수증', `<img src="${escapeHtml(img.src)}" style="width:100%;border-radius:4px" alt="영수증">`)));
  } catch (err) {
    const gal = container.querySelector('#report-gallery');
    if (gal) gal.innerHTML = '<p class="muted">갤러리를 불러오지 못했습니다.</p>';
  }
```

- [ ] **Step 5: Verify no `photoUrl`/stale refs; run frontend tests; commit**

Run: `npm test` (root) → 38/38.

```bash
git add public/views/report.js
git commit -m "feat(frontend): report 조건, receipt modal, account+settled, gallery"
```

---

### Task 7: Admin 구성원 modal — drop excluded-category, add 계좌

**Files:**
- Modify: `public/views/admin.js`

**Interfaces:**
- Produces: the add/edit member modal has a 계좌 input (→ `account`) and no excluded-category chips. `addMember`/`updateMember` payloads carry `account` and drop `excludedCategories`.

- [ ] **Step 1:** In `openMemberModal`, remove the 제외 카테고리 label/`#mm-excluded` block and the `renderChipGroup`/`excluded` logic. Add a 계좌 input:

```js
    <div class="field"><label class="label">계좌 (선택)</label><input class="input" id="mm-account" value="${escapeHtml(member?.account || '')}"></div>
```

- [ ] **Step 2:** In the submit handler, drop `excludedCategories` from both payloads and add `account`:

```js
  const account = document.getElementById('mm-account').value.trim();
  // addMember: { tripId, name, weight, account }
  // updateMember: { tripId, memberId, patch: { name, weight, account } }
```

- [ ] **Step 3:** Update the member list rendering (`renderMembersList`) to drop the `제외: ...(excludedCategories)` span (it no longer exists). Optionally show account.

- [ ] **Step 4: Run frontend tests; commit**

Run: `npm test` (root) → 38/38. `grep -rn "excludedCategories" public/` → no matches.

```bash
git add public/views/admin.js
git commit -m "feat(frontend): member modal uses account, drops excluded-category"
```

---

### Task 8: Admin 경비확인 — 제외설정 mode + excluded labels

**Files:**
- Modify: `public/views/admin.js`

**Interfaces:**
- Consumes: `setExpenseExclusions`, `listMembers`/`listMembersForLogin` (member names), `openModal`, `showToast`.
- Produces: 경비확인 tab has a "제외설정" toggle enabling per-row checkboxes and a member-picker modal that calls `setExpenseExclusions`; expense cards show "제외: 이름들".

- [ ] **Step 1:** In `renderExpensesTab`, add state `let exclusionMode = false;` (module scope near other state) and a "제외설정" button that toggles it and re-renders the tab. When `exclusionMode`, each expense card shows a checkbox (`<input type="checkbox" class="excl-check" data-id="${e.id}">`) and a bottom bar with "제외 구성원 지정" + "취소".

- [ ] **Step 2:** Each expense card shows excluded names when present:

```js
  ${e.excludedMembers && e.excludedMembers.length ? `<p class="muted" style="font-size:12px">제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</p>` : ''}
```

- [ ] **Step 3:** "제외 구성원 지정" collects checked expense ids; if none, `showToast('경비를 선택해주세요','error')`. Open a modal listing members as checkboxes; pre-check from the single selected expense's `excludedMembers` when exactly one is selected, else start empty. On 적용:

```js
  await callFunction('setExpenseExclusions', { tripId: session.tripId, expenseIds: checkedIds, excludedMemberIds: pickedMemberIds });
  closeModal();
  exclusionMode = false;
  await renderExpensesTab(body, slug, renderToken);
```

- [ ] **Step 4: Run frontend tests; commit**

Run: `npm test` (root) → 38/38.

```bash
git add public/views/admin.js
git commit -m "feat(frontend): 경비확인 제외설정 mode with bulk member exclusion"
```

---

### Task 9: Member 경비목록 — excluded labels

**Files:**
- Modify: `public/views/member.js`

**Interfaces:**
- Produces: member expense cards show "제외: 이름들" when the expense has excludedMembers. Members need the name map — `loadExpenses` already has expenses; fetch member names via `listMembersForLogin({slug})` (public) to resolve ids.

- [ ] **Step 1:** In `member.js`'s expense-list render, fetch member names (via `listMembersForLogin`) and add to each card:

```js
  ${e.excludedMembers && e.excludedMembers.length ? `<span class="muted" style="font-size:11px">· 제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</span>` : ''}
```

- [ ] **Step 2: Run frontend tests; commit**

Run: `npm test` (root) → 38/38.

```bash
git add public/views/member.js
git commit -m "feat(frontend): member expense cards show excluded members"
```

---

### Task 10: Emulator E2E (controller-run)

**Files:** none.

- [ ] Both suites green (`npm test`, `cd functions && npm test`).
- [ ] Start emulators (Java at `C:\Users\user\java-portable\jdk-17.0.19+10-jre\bin`; `functions/.secret.local` present):
  `export PATH="/c/Users/user/java-portable/jdk-17.0.19+10-jre/bin:$PATH" && npx -y firebase-tools@14 emulators:start --only functions,firestore,storage,hosting --project demo-sfayw`
- [ ] Golden path at `http://127.0.0.1:5000`, verifying the new behavior:
  1. Create trip, admin login, add 3 members (with 가중치 and 계좌).
  2. Members add several expenses (some with photos).
  3. Admin 경비확인 → 제외설정 → select 2 expenses → exclude one member → 적용 → cards show "제외: 이름"; the same member's report `due` drops accordingly.
  4. Report as an **in-frame tab** (no separate page), tab bar has **no scrollbar**: 정산 조건 table, 전체 지출 내역 with 제외 labels + 영수증 click modal, 카테고리 분석, 결제자별, 최종 정산 with 계좌 + 입금완료 toggle (admin), 영수증 갤러리 grid + click modal.
  5. Toggle 입금완료 → badge appears/persists; member view sees it read-only.
- [ ] Fix anything broken (normal fix-commit flow, re-test).
- [ ] Stop emulators; confirm no orphaned node/java; ports 4000/5000/5001/8080/9199 free.

---

### Task 11: Production deploy + smoke (controller-run)

**Files:** none.

- [ ] Deploy changed functions: `npx firebase-tools@14 deploy --only functions --project sfayw-10d11` (settlement/expenses/members/report changed; new callables added — a full functions deploy is simplest).
- [ ] Vercel picks up frontend from GitHub `main` automatically on push; confirm the production deploy updated (or `vercel deploy --prod`).
- [ ] Production smoke on `https://tripsplit-opal.vercel.app` (new trip): 제외설정 changes settlement; report in-frame tab renders all sections; 입금완료 toggle persists; gallery + receipt modals load (real signed URLs).
- [ ] Archive the smoke-test trip via superadmin (optional cleanup).

---

## Plan-Level Verification

```bash
npm test                    # frontend 38/38
cd functions && npm test    # backend all green
grep -rn "excludedCategories" functions/src public   # no matches
```

Plus Task 10 emulator golden path and Task 11 production smoke.

## What This Plan Does Not Cover (Plan 5)

Korean error-message map, initial-load failure handling, submit in-flight/disabled states, Enter-key form submission, modal accessibility, '컴펌'→'확정' rename, PIN `type="password"`.
