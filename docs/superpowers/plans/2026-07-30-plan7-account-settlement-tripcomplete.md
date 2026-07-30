# Plan 7 Implementation Plan: Classify Indicator + Member Account + Settlement Breakdown + Trip Complete

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 7 (E2E + deploy) is controller-run.

**Goal:** Add a receipt-classification progress indicator with a manual-entry skip, member self-service bank-account entry, a per-member settlement calculation breakdown, and a reversible "trip complete" state that unlocks cross-trip comparison.

**Architecture:** Three backend changes (one new callable `setMyAccount`; a `breakdown` field on `computeSettlement`; a trip-status transition `setTripStatus` plus a `requireTripEditable` edit-lock guard wired into mutating callables) followed by three frontend changes (classify indicator/skip in both expense-entry modals; report settlement summary + card-click detail modal with own-card account editor; admin trip-complete toggle + completed-state banners). The comparison logic already exists server-side and only needs completed trips to have data.

**Tech Stack:** Firebase Cloud Functions v2 (CommonJS, Node 20, region asia-northeast3), Firestore; Jest (backend); no-build vanilla-JS ES-module SPA in `public/`; node:test (frontend).

## Global Constraints
- Backend error contract: throw `new Error('DOMAIN_CODE')`; `toHttpsError` maps it. Frontend `errorMessageFor(code)` translates the domain code. Add new codes to `public/errorMessages.js`.
- `requireSession(db, token, allowedRoles, expectedTripId)` returns the session `{ role, tripId, memberId, ... }`. Always call it first in every callable.
- Members and admins are distinct principals: an admin session has `memberId === null`; only `member` sessions map to a settlement card.
- Field-name allowlists on writes: never persist client-supplied fields outside an explicit allowlist.
- Frontend view changes have no unit-test harness; they are verified by `npm test` staying green (helpers) + Task 7 E2E. Pure helpers get a node:test.
- Do NOT trigger native `confirm()`/`alert()` (blocks the app + browser automation). Use in-place actions or `openModal`.
- Commit after each task. Backend tests: `cd functions && npm test`. Frontend tests: `npm test` (repo root).

---

## Task 1: Backend — `setMyAccount` callable (member self-account) [#6]

**Files:**
- Modify: `functions/src/functions/members.js` (add `setMyAccount`, export it)
- Modify: `functions/index.js:74` (register `exports.setMyAccount`)
- Test: `functions/test/functions/members.test.js` (append tests)

**Interfaces:**
- Produces: `setMyAccount(db, data)` where `data = { sessionToken, tripId, account }` → `{ ok: true }`. Updates ONLY the caller's own member doc (`session.memberId`); `account` is trimmed, empty → `null`. Member role only.

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/functions/members.test.js` (inside the `describe('members', …)` block):

```js
  test('setMyAccount updates only the caller\'s own member account', async () => {
    const db = new FakeFirestore();
    const { token: adminTok } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: adminTok, tripId: 't1', name: '슬기' });
    const { token: memberTok } = await createSession(db, { role: 'member', tripId: 't1', memberId });

    const res = await setMyAccount(db, { sessionToken: memberTok, tripId: 't1', account: '  우리 1002-33  ' });
    expect(res).toEqual({ ok: true });
    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().account).toBe('우리 1002-33'); // trimmed
  });

  test('setMyAccount stores an empty account as null', async () => {
    const db = new FakeFirestore();
    const { token: adminTok } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: adminTok, tripId: 't1', name: '슬기', account: 'x' });
    const { token: memberTok } = await createSession(db, { role: 'member', tripId: 't1', memberId });

    await setMyAccount(db, { sessionToken: memberTok, tripId: 't1', account: '   ' });
    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().account).toBeNull();
  });

  test('setMyAccount rejects an admin session (no own card)', async () => {
    const db = new FakeFirestore();
    const { token: adminTok } = await createSession(db, { role: 'admin', tripId: 't1' });
    await expect(setMyAccount(db, { sessionToken: adminTok, tripId: 't1', account: 'x' }))
      .rejects.toThrow('FORBIDDEN');
  });
```

Also update the import at the top of the test file to include `setMyAccount`:

```js
const {
  addMember, updateMember, listMembers, setMemberSettled, setMyAccount,
} = require('../../src/functions/members');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest members -t setMyAccount`
Expected: FAIL (`setMyAccount is not a function`).

- [ ] **Step 3: Implement `setMyAccount`**

In `functions/src/functions/members.js`, add before `module.exports`:

```js
async function setMyAccount(db, data) {
  const { tripId, account } = data;
  // member-only: an admin has no own settlement card. requireSession with
  // ['member'] rejects admin/superadmin with FORBIDDEN.
  const session = await requireSession(db, data.sessionToken, ['member'], tripId);

  const memberRef = db.collection('trips').doc(tripId).collection('members').doc(session.memberId);
  const snap = await memberRef.get();
  if (!snap.exists) throw new Error('MEMBER_NOT_FOUND');

  const trimmed = typeof account === 'string' ? account.trim() : '';
  await memberRef.update({ account: trimmed || null });
  return { ok: true };
}
```

Update the export block:

```js
module.exports = {
  addMember, updateMember, listMembers, setMemberSettled, setMyAccount,
};
```

- [ ] **Step 4: Register the callable**

In `functions/index.js`, after line 74 (`exports.setMemberSettled = …`):

```js
exports.setMyAccount = onCall(wrap(members.setMyAccount));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npx jest members`
Expected: PASS (all members tests, including the 3 new ones).

- [ ] **Step 6: Commit**

```bash
git add functions/src/functions/members.js functions/index.js functions/test/functions/members.test.js
git commit -m "feat(functions): setMyAccount callable for member self-service account"
```

---

## Task 2: Backend — settlement `breakdown` per member [#7]

**Files:**
- Modify: `functions/src/lib/settlement.js` (`computeSettlement` — collect per-member breakdown)
- Test: `functions/test/lib/settlement.test.js` (append tests)

**Interfaces:**
- Produces: `computeSettlement(members, expenses)` now returns each `perMember` entry with `breakdown: [{ expenseId, category, merchant, share }]` — one entry per confirmed expense the member is NOT excluded from; `sum(share) === due`.

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/lib/settlement.test.js` (inside the `describe('computeSettlement', …)` block):

```js
  test('breakdown lists each included expense with the member\'s share, summing to due', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ];
    const expenses = [
      { id: 'e1', category: '숙박', merchant: '호텔', amount: 120000, enteredBy: 'a', confirmed: true, excludedMembers: [] },
      { id: 'e2', category: '식비', merchant: '식당', amount: 60000, enteredBy: 'b', confirmed: true, excludedMembers: [] },
    ];

    const result = computeSettlement(members, expenses);
    const a = result.perMember.find((m) => m.id === 'a');
    expect(a.breakdown).toEqual([
      { expenseId: 'e1', category: '숙박', merchant: '호텔', share: 60000 },
      { expenseId: 'e2', category: '식비', merchant: '식당', share: 30000 },
    ]);
    expect(a.breakdown.reduce((s, b) => s + b.share, 0)).toBe(a.due);
  });

  test('an expense that excludes a member is absent from that member\'s breakdown', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ];
    const expenses = [
      { id: 'e1', category: '교통비', merchant: '택시', amount: 100000, enteredBy: 'a', confirmed: true, excludedMembers: ['b'] },
    ];

    const result = computeSettlement(members, expenses);
    const b = result.perMember.find((m) => m.id === 'b');
    expect(b.breakdown).toEqual([]);
    expect(b.due).toBe(0);
    const a = result.perMember.find((m) => m.id === 'a');
    expect(a.breakdown).toEqual([{ expenseId: 'e1', category: '교통비', merchant: '택시', share: 100000 }]);
  });

  test('unconfirmed expenses never appear in a breakdown', () => {
    const members = [{ id: 'a', name: 'A', weight: 1 }];
    const expenses = [{ id: 'e1', category: '식비', merchant: '', amount: 100000, enteredBy: 'a', confirmed: false, excludedMembers: [] }];
    const result = computeSettlement(members, expenses);
    expect(result.perMember[0].breakdown).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest settlement -t breakdown`
Expected: FAIL (`breakdown` is undefined).

- [ ] **Step 3: Implement the breakdown collection**

In `functions/src/lib/settlement.js`, in `computeSettlement`, add a breakdown accumulator next to `dueByMember` and populate it in the allocation loop, then include it in `perMember`. Concretely:

After the `dueByMember` init:

```js
  const dueByMember = {};
  const breakdownByMember = {};
  for (const m of members) { dueByMember[m.id] = 0; breakdownByMember[m.id] = []; }
```

In the allocation loop, replace the inner `for (const a of allocation)` body:

```js
  for (const e of confirmed) {
    const excluded = new Set(e.excludedMembers || []);
    const eligible = members.filter((m) => !excluded.has(m.id));
    const weights = eligible.map((m) => ({ id: m.id, weight: m.weight }));
    const allocation = allocateInteger(e.amount, weights);
    for (const a of allocation) {
      dueByMember[a.id] += a.amount;
      breakdownByMember[a.id].push({
        expenseId: e.id,
        category: e.category,
        merchant: e.merchant || '',
        share: a.amount,
      });
    }
  }
```

Update the `perMember` map to include `breakdown`:

```js
  const perMember = members.map((m) => ({
    id: m.id,
    name: m.name,
    due: dueByMember[m.id] || 0,
    paid: paidByMember[m.id] || 0,
    net: (paidByMember[m.id] || 0) - (dueByMember[m.id] || 0),
    breakdown: breakdownByMember[m.id] || [],
  }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest settlement`
Expected: PASS (existing + 3 new; the existing tests don't assert `breakdown` so remain green).

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/settlement.js functions/test/lib/settlement.test.js
git commit -m "feat(functions): per-member settlement breakdown (share per included expense)"
```

---

## Task 3: Backend — trip status transition + edit-lock [#11]

**Files:**
- Create: `functions/src/lib/tripStatus.js` (`requireTripEditable`)
- Create: `functions/test/lib/tripStatus.test.js`
- Modify: `functions/src/functions/tripSetup.js` (add `setTripStatus`; guard `updateTripSetup`)
- Modify: `functions/src/functions/expenses.js` (guard add/update/delete/confirm/setExpenseExclusions)
- Modify: `functions/src/functions/members.js` (guard addMember/updateMember)
- Modify: `functions/index.js` (register `setTripStatus`)
- Test: `functions/test/functions/tripSetup.test.js` (append `setTripStatus` + lock tests)

**Interfaces:**
- Produces: `requireTripEditable(db, tripId)` → resolves when the trip is editable (status not `completed`, OR the trip doc is absent — existing callables do their own TRIP_NOT_FOUND handling and many unit tests never create a trip doc); throws `TRIP_COMPLETED` only when the doc exists and `status === 'completed'`.
- Produces: `setTripStatus(db, data)` where `data = { sessionToken, tripId, status }`, `status ∈ {active, completed}`, admin only → `{ ok: true }`.
- Consumes: `requireSession` (all), `requireTripEditable` (guarded callables).

- [ ] **Step 1: Write the failing test for `requireTripEditable`**

Create `functions/test/lib/tripStatus.test.js`:

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { requireTripEditable } = require('../../src/lib/tripStatus');

describe('requireTripEditable', () => {
  test('passes when the trip is active', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'active' });
    await expect(requireTripEditable(db, 't1')).resolves.toBeUndefined();
  });

  test('passes when the trip is in setup', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'setup' });
    await expect(requireTripEditable(db, 't1')).resolves.toBeUndefined();
  });

  test('throws TRIP_COMPLETED when the trip is completed', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'completed' });
    await expect(requireTripEditable(db, 't1')).rejects.toThrow('TRIP_COMPLETED');
  });

  test('treats a missing trip doc as editable (callers do their own TRIP_NOT_FOUND check)', async () => {
    const db = new FakeFirestore();
    await expect(requireTripEditable(db, 'nope')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd functions && npx jest tripStatus`
Expected: FAIL (cannot find module `tripStatus`).

- [ ] **Step 3: Implement `requireTripEditable`**

Create `functions/src/lib/tripStatus.js`:

```js
async function requireTripEditable(db, tripId) {
  const snap = await db.collection('trips').doc(tripId).get();
  // A missing trip doc is treated as editable: each callable already does its
  // own TRIP_NOT_FOUND handling where relevant, and many unit tests exercise
  // the callables without seeding a trip doc. Only an explicitly completed
  // trip locks edits.
  if (snap.exists && snap.data().status === 'completed') throw new Error('TRIP_COMPLETED');
}

module.exports = { requireTripEditable };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd functions && npx jest tripStatus`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `setTripStatus` + edit-lock**

Append to `functions/test/functions/tripSetup.test.js`. First ensure the import includes `setTripStatus` and that `addExpense`/`addMember` are importable for the lock tests:

```js
const { getTripSetup, updateTripSetup, setTripStatus } = require('../../src/functions/tripSetup');
const { addMember } = require('../../src/functions/members');
const { addExpense } = require('../../src/functions/expenses');
```

Then add (inside the tripSetup describe block, or a new `describe('setTripStatus + edit-lock', …)`):

```js
  test('setTripStatus requires an admin session', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'active' });
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await expect(setTripStatus(db, { sessionToken: token, tripId: 't1', status: 'completed' }))
      .rejects.toThrow('FORBIDDEN');
  });

  test('setTripStatus flips active <-> completed', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'active' });
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await setTripStatus(db, { sessionToken: token, tripId: 't1', status: 'completed' });
    expect((await db.collection('trips').doc('t1').get()).data().status).toBe('completed');

    await setTripStatus(db, { sessionToken: token, tripId: 't1', status: 'active' });
    expect((await db.collection('trips').doc('t1').get()).data().status).toBe('active');
  });

  test('setTripStatus rejects an invalid status', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'active' });
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await expect(setTripStatus(db, { sessionToken: token, tripId: 't1', status: 'setup' }))
      .rejects.toThrow('INVALID_STATUS');
  });

  test('a completed trip blocks addExpense and addMember', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ status: 'completed' });
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await expect(addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' }))
      .rejects.toThrow('TRIP_COMPLETED');
    await expect(addExpense(db, {
      sessionToken: token, tripId: 't1', enteredBy: 'm1', category: '식비', amount: 1000,
    })).rejects.toThrow('TRIP_COMPLETED');
  });
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd functions && npx jest tripSetup`
Expected: FAIL (`setTripStatus is not a function`; addExpense/addMember not yet guarded).

- [ ] **Step 7: Implement `setTripStatus` + guard `updateTripSetup`**

In `functions/src/functions/tripSetup.js`, add the import at the top:

```js
const { requireTripEditable } = require('../lib/tripStatus');
```

Add `setTripStatus` and guard `updateTripSetup` (add the guard right after its `requireSession`):

```js
async function updateTripSetup(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);
  await requireTripEditable(db, data.tripId);
  // …rest unchanged…
}

async function setTripStatus(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);
  const { tripId, status } = data;
  if (status !== 'active' && status !== 'completed') throw new Error('INVALID_STATUS');
  const ref = db.collection('trips').doc(tripId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');
  await ref.update({ status });
  return { ok: true };
}

module.exports = { getTripSetup, updateTripSetup, setTripStatus };
```

- [ ] **Step 8: Guard the expense + member mutating callables**

In `functions/src/functions/expenses.js`, add the import:

```js
const { requireTripEditable } = require('../lib/tripStatus');
```

Add `await requireTripEditable(db, tripId);` immediately after the `requireSession` line in each of: `addExpense`, `updateExpense`, `deleteExpense`, `confirmExpense`, `setExpenseExclusions`. (In `deleteExpense`/`addExpense`/`updateExpense` the trip id variable is `tripId`; in `confirmExpense`/`setExpenseExclusions` it is also `tripId` from the destructure.)

Example (addExpense):

```js
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);
```

In `functions/src/functions/members.js`, add the import:

```js
const { requireTripEditable } = require('../lib/tripStatus');
```

Add `await requireTripEditable(db, data.tripId);` after `requireSession` in `addMember` and `updateMember` ONLY. Do NOT guard `setMemberSettled`, `setMyAccount`, or `listMembers`.

- [ ] **Step 9: Register `setTripStatus`**

In `functions/index.js`, after line 69 (`exports.updateTripSetup = …`):

```js
exports.setTripStatus = onCall(wrap(tripSetup.setTripStatus));
```

- [ ] **Step 10: Run the full backend suite**

Run: `cd functions && npm test`
Expected: PASS. Pre-existing `members.test.js`/`expenses.test.js` never seed a trip doc; `requireTripEditable` treats an absent doc (and any non-`completed` status) as editable, so they stay green. Only a doc with `status: 'completed'` blocks.

- [ ] **Step 11: Commit**

```bash
git add functions/src/lib/tripStatus.js functions/test/lib/tripStatus.test.js functions/src/functions/tripSetup.js functions/src/functions/expenses.js functions/src/functions/members.js functions/index.js functions/test/functions/tripSetup.test.js
git commit -m "feat(functions): setTripStatus + requireTripEditable edit-lock on completed trips"
```

---

## Task 4: Frontend — classify indicator + skip in both expense modals [#2]

**Files:**
- Modify: `public/views/member.js` (`openExpenseModal` — photo change handler + submit)
- Modify: `public/views/admin.js` (`openAdminExpenseModal` — photo change handler + submit)

**Interfaces:**
- Consumes: existing `classifyReceipt` callable (unchanged) returning `{ photoPath, classified, ...fields }`.

- [ ] **Step 1: member.js — background classify + skip button**

In `public/views/member.js` `openExpenseModal`, add two state vars next to `let photoPath = null;`:

```js
  let classifyPromise = null;
  let skipped = false;
```

Replace the entire `document.getElementById('me-photo').addEventListener('change', …)` handler with:

```js
  document.getElementById('me-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    skipped = false;
    const mimeType = file.type;
    const b64 = await fileToBase64(file);
    document.getElementById('me-photo-preview').innerHTML =
      `<img src="data:${mimeType};base64,${b64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`
      + `<div id="me-classify-status" class="muted" style="font-size:13px;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">🔍 문자 추출 중…<button type="button" class="btn btn-secondary" id="me-classify-skip">건너뛰고 직접 입력</button></div>`;

    document.getElementById('me-classify-skip').addEventListener('click', () => {
      skipped = true;
      const s = document.getElementById('me-classify-status');
      if (s) s.remove();
    });

    const session = getSession();
    classifyPromise = callFunction('classifyReceipt', { tripId: session.tripId, photoBase64: b64, mimeType })
      .then((classification) => {
        photoPath = classification.photoPath || null;
        const s = document.getElementById('me-classify-status');
        if (s) s.remove();
        if (!skipped) {
          if (classification.classified === false) {
            showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
          } else {
            if (classification.category) { category = classification.category; rerenderCategoryChips(); }
            if (classification.date) document.getElementById('me-date').value = classification.date;
            if (classification.amount) document.getElementById('me-amount').value = classification.amount;
            if (classification.merchant) document.getElementById('me-merchant').value = classification.merchant;
            if (classification.detail) document.getElementById('me-detail').value = classification.detail;
          }
        }
        return photoPath;
      })
      .catch(() => {
        const s = document.getElementById('me-classify-status');
        if (s) s.remove();
        showToast('사진 업로드 실패 — 사진 없이 저장됩니다', 'error');
        return null;
      });
  });
```

In the `me-submit` click handler, await the pending classify before `addExpense`. Change the start of the `try` block:

```js
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      if (classifyPromise) {
        btn.textContent = '사진 저장 중...';
        await classifyPromise;
        btn.textContent = '저장 중...';
      }
      await callFunction('addExpense', {
        // …unchanged; still passes photoPath…
```

(The `addExpense` call already sends `photoPath` — leave it.)

- [ ] **Step 2: admin.js — same pattern in `openAdminExpenseModal`**

In `public/views/admin.js` `openAdminExpenseModal`, add near `let category = CATEGORIES[1];`:

```js
  let photoPath = null;
  let classifyPromise = null;
  let skipped = false;
```

Replace the `document.getElementById('ae-photo').addEventListener('change', …)` handler with:

```js
  document.getElementById('ae-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    skipped = false;
    const mimeType = file.type;
    const b64 = await fileToBase64(file);
    document.getElementById('ae-photo-preview').innerHTML =
      `<img src="data:${mimeType};base64,${b64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`
      + `<div id="ae-classify-status" class="muted" style="font-size:13px;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">🔍 문자 추출 중…<button type="button" class="btn btn-secondary" id="ae-classify-skip">건너뛰고 직접 입력</button></div>`;

    document.getElementById('ae-classify-skip').addEventListener('click', () => {
      skipped = true;
      const s = document.getElementById('ae-classify-status');
      if (s) s.remove();
    });

    const session = getSession();
    classifyPromise = callFunction('classifyReceipt', { tripId: session.tripId, photoBase64: b64, mimeType })
      .then((classification) => {
        photoPath = classification.photoPath || null;
        const s = document.getElementById('ae-classify-status');
        if (s) s.remove();
        if (!skipped) {
          if (classification.classified === false) {
            showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
          } else {
            if (classification.category) { category = classification.category; rerenderCategoryChips(); }
            if (classification.date) document.getElementById('ae-date').value = classification.date;
            if (classification.amount) document.getElementById('ae-amount').value = classification.amount;
            if (classification.merchant) document.getElementById('ae-merchant').value = classification.merchant;
            if (classification.detail) document.getElementById('ae-detail').value = classification.detail;
          }
        }
        return photoPath;
      })
      .catch(() => {
        const s = document.getElementById('ae-classify-status');
        if (s) s.remove();
        showToast('사진 업로드 실패 — 사진 없이 저장됩니다', 'error');
        return null;
      });
  });
```

In the `ae-submit` handler, await the pending classify and use the `photoPath` closure var instead of `dataset.photoPath`:

```js
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      if (classifyPromise) {
        btn.textContent = '사진 저장 중...';
        await classifyPromise;
        btn.textContent = '저장 중...';
      }
      await callFunction('addExpense', {
        tripId: session.tripId,
        enteredBy: document.getElementById('ae-member').value,
        category,
        date: document.getElementById('ae-date').value,
        amount: Number(document.getElementById('ae-amount').value),
        merchant: document.getElementById('ae-merchant').value,
        detail: document.getElementById('ae-detail').value,
        photoPath,
      });
```

Also remove the now-unused `let photoBase64 = null;` / `let mimeType = null;` at the top of `openAdminExpenseModal` (they are now local `const` inside the handler).

- [ ] **Step 3: Run the frontend suite**

Run: `npm test`
Expected: PASS (45/45 — no helper behavior changed).

- [ ] **Step 4: Commit**

```bash
git add public/views/member.js public/views/admin.js
git commit -m "feat(frontend): classify progress indicator + skip-to-manual in expense modals"
```

---

## Task 5: Frontend — settlement summary + card-click breakdown + own-card account [#7, #6]

**Files:**
- Modify: `public/views/report.js` (import `closeModal`; add 정산 요약 section; make settlement cards clickable → detail modal; own-card account editor via `setMyAccount`; `stopPropagation` on settle-toggle)

**Interfaces:**
- Consumes: `settlement.perMember[].breakdown` (Task 2), `setMyAccount` (Task 1), `session.memberId`.

- [ ] **Step 1: Import `closeModal`**

In `public/views/report.js` line 3, add `closeModal`:

```js
import { openModal, closeModal, showToast, escapeHtml } from '../ui.js';
```

- [ ] **Step 2: Add the 정산 요약 section**

In `renderReportInto`, in the `container.innerHTML` template, insert a new section between the `결제자별 지출` section and the `최종 정산` section:

```js
    <div class="section"><h2>결제자별 지출</h2>${renderPayerSummary(settlement.perMember)}</div>
    <div class="section"><h2>정산 요약</h2>
      <p>총 확정 지출 <strong class="mono">${settlement.totalConfirmed.toLocaleString()}원</strong></p>
      <p class="muted" style="font-size:13px">확정 지출을 제외되지 않은 구성원끼리 가중치 비율로 나눠 각자 '내야 할 금액'을 구하고, 실제 결제액과 비교해 차액(받을 돈/낼 돈)을 계산합니다. 아래 최종 정산에서 구성원 카드를 누르면 계산 내역을 볼 수 있습니다.</p>
    </div>
    <div class="section"><h2>최종 정산</h2>${renderSettlement(settlement.perMember, session.role === 'admin')}</div>
```

- [ ] **Step 3: Make settlement cards clickable in `renderSettlement`**

In `renderSettlement`, add the `settle-card` class + pointer cursor to each card (keep `data-member-id`):

```js
        <div class="card settle-card" style="background:var(--paper);padding:1rem;cursor:pointer" data-member-id="${m.id}">
```

- [ ] **Step 4: Add `stopPropagation` to the settle-toggle handler**

In the `.settle-toggle` click handler inside `renderReportInto`, add `ev` and stop propagation first so the toggle doesn't open the detail modal:

```js
  container.querySelectorAll('.settle-toggle').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const next = btn.dataset.settled !== 'true';
      // …rest unchanged…
```

- [ ] **Step 5: Add the detail-modal helper + card click handler**

Add a module-scope helper near the other `render*` helpers in `report.js`:

```js
function renderSettlementDetail(m, isOwn) {
  const rows = (m.breakdown || []).map((b) => `
    <tr style="border-top:1px solid var(--rule)">
      <td style="padding:0.4rem"><span class="tag">${b.category}</span></td>
      <td>${escapeHtml(b.merchant || '')}</td>
      <td style="text-align:right" class="mono">${b.share.toLocaleString()}원</td>
    </tr>`).join('');
  return `
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)"><th style="padding:0.4rem">카테고리</th><th>상호</th><th style="text-align:right">내 분담액</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="muted" style="padding:0.6rem">포함된 확정 지출이 없습니다.</td></tr>'}</tbody>
    </table></div>
    <p style="margin-top:0.8rem">내야 할 금액 <strong class="mono">${m.due.toLocaleString()}원</strong> · 실제 결제 <span class="mono">${m.paid.toLocaleString()}원</span></p>
    <p class="mono" style="font-weight:700;color:var(--${m.net >= 0 ? 'receive' : 'pay'})">차액 ${m.net >= 0 ? '+' : ''}${m.net.toLocaleString()}원</p>
    ${m.account ? `<p class="muted" style="font-size:12px">계좌 ${escapeHtml(m.account)}</p>` : ''}
    ${isOwn ? `
      <div class="field" style="margin-top:0.8rem"><label class="label">내 계좌 입력/수정</label>
        <input class="input" id="sd-account" value="${escapeHtml(m.account || '')}" placeholder="예: 우리 1002-123-456789"></div>
      <button type="button" class="btn btn-primary btn-block" id="sd-account-save">계좌 저장</button>
      <p class="muted" id="sd-account-error" style="margin-top:0.5rem;font-size:13px"></p>` : ''}`;
}
```

In `renderReportInto`, after the settle-toggle handler block, add the card-click handler (uses `settlement.perMember` + `session` in scope):

```js
  container.querySelectorAll('.settle-card').forEach((card) => {
    card.addEventListener('click', () => {
      const m = settlement.perMember.find((x) => x.id === card.dataset.memberId);
      if (!m) return;
      const isOwn = session.memberId === m.id;
      openModal(`${m.name} 정산 상세`, renderSettlementDetail(m, isOwn));
      if (!isOwn) return;
      const saveBtn = document.getElementById('sd-account-save');
      const input = document.getElementById('sd-account');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
        try {
          const account = input.value;
          await callFunction('setMyAccount', { tripId: session.tripId, account });
          m.account = account.trim() || null;
          const line = card.querySelector('.settle-account');
          if (m.account && line) line.textContent = `계좌 ${m.account}`;
          closeModal();
          showToast('계좌가 저장되었습니다', 'success');
        } catch (err) {
          saveBtn.disabled = false; saveBtn.textContent = '계좌 저장';
          document.getElementById('sd-account-error').textContent = err.message;
        }
      });
    });
  });
```

To let the in-place account line update, wrap the account line in `renderSettlement` with a class (change the existing account `<p>`):

```js
          ${m.account ? `<p class="muted settle-account" style="font-size:12px">계좌 ${escapeHtml(m.account)}</p>` : '<p class="muted settle-account" style="font-size:12px;display:none"></p>'}
```

- [ ] **Step 6: Run the frontend suite**

Run: `npm test`
Expected: PASS (45/45).

- [ ] **Step 7: Commit**

```bash
git add public/views/report.js
git commit -m "feat(frontend): settlement summary + card-click breakdown detail + own-card account entry"
```

---

## Task 6: Frontend — trip-complete toggle + completed-state locks [#11]

**Files:**
- Modify: `public/errorMessages.js` (add `TRIP_COMPLETED`)
- Modify: `public/views/admin.js` (`renderSetupTab` status badge + toggle; `renderExpensesTab` + `renderMembersTab` completed banner + hide edit controls)

**Interfaces:**
- Consumes: `setTripStatus` (Task 3), `getTripSetup` (returns `status`), `TRIP_COMPLETED` message.

- [ ] **Step 1: Add the error message**

In `public/errorMessages.js`, add inside `MESSAGES` (e.g. after `EXPENSE_LOCKED`):

```js
  TRIP_COMPLETED: '완료된 여행이라 수정할 수 없습니다. 여행 완료를 해제한 뒤 다시 시도해주세요.',
```

- [ ] **Step 2: `renderSetupTab` — status badge + complete/uncomplete toggle**

In `public/views/admin.js` `renderSetupTab`, after `if (myToken !== renderToken) return;`, compute status and render it. Replace the `body.innerHTML = …` and add the toggle handler:

```js
  const isCompleted = trip.status === 'completed';
  body.innerHTML = `
    <div class="card" style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem">
      <div>상태: ${isCompleted
        ? '<span class="badge badge-locked">완료됨 (편집 잠김)</span>'
        : '<span class="badge">진행 중</span>'}</div>
      <button type="button" class="btn ${isCompleted ? 'btn-secondary' : 'btn-primary'}" id="trip-status-toggle">${isCompleted ? '여행 완료 해제' : '여행 완료 처리'}</button>
    </div>
    <div class="field"><label class="label">기간 시작</label><input type="date" class="input" id="setup-start" value="${escapeHtml(trip.period?.start || '')}" ${isCompleted ? 'disabled' : ''}></div>
    <div class="field"><label class="label">기간 종료</label><input type="date" class="input" id="setup-end" value="${escapeHtml(trip.period?.end || '')}" ${isCompleted ? 'disabled' : ''}></div>
    <div class="field"><label class="label">장소</label><input class="input" id="setup-location" value="${escapeHtml(trip.location || '')}" ${isCompleted ? 'disabled' : ''}></div>
    <div class="field"><label class="label">숙박지</label><input class="input" id="setup-lodging" value="${escapeHtml(trip.lodging || '')}" ${isCompleted ? 'disabled' : ''}></div>
    ${isCompleted ? '<p class="muted" style="font-size:13px">완료된 여행입니다. 편집하려면 완료를 해제하세요.</p>' : '<button type="button" class="btn btn-primary" id="setup-save">저장</button>'}`;

  document.getElementById('trip-status-toggle').addEventListener('click', async () => {
    const tbtn = document.getElementById('trip-status-toggle');
    tbtn.disabled = true;
    try {
      await callFunction('setTripStatus', { tripId: session.tripId, status: isCompleted ? 'active' : 'completed' });
      renderSetupTab(body, slug, renderToken);
    } catch (err) {
      tbtn.disabled = false;
      showToast(err.message, 'error');
    }
  });

  const saveBtn = document.getElementById('setup-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      // …existing save handler body, unchanged…
    });
  }
```

(Move the existing `setup-save` handler inside the `if (saveBtn)` guard so it isn't attached when the button is absent.)

- [ ] **Step 3: `renderExpensesTab` — fetch status, banner + hide edit controls when completed**

In `renderExpensesTab`, add `getTripSetup` to the parallel fetch:

```js
    const [expenses, members, trip] = await Promise.all([
      callFunction('listExpenses', { tripId: session.tripId }),
      callFunction('listMembersForLogin', { slug }),
      callFunction('getTripSetup', { tripId: session.tripId }),
    ]);
```

(Adjust the destructure `let expenses, members;` → `let expenses, members, trip;`.)

Add `const locked = trip.status === 'completed';` before building `body.innerHTML`. Then:
- Prepend a banner when locked, and render the top action buttons only when NOT locked:

```js
  body.innerHTML = `
    ${locked ? '<div class="card" style="margin-bottom:1rem;background:var(--rule)"><strong>완료된 여행</strong> — 편집이 잠겨 있습니다. 여행정보 탭에서 완료를 해제하세요.</div>' : `
    <div style="margin-bottom:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
      <button type="button" class="btn btn-primary" id="expense-add">경비 입력</button>
      <button type="button" class="btn btn-secondary" id="expense-exclusion-toggle">${exclusionMode ? '제외설정 취소' : '제외설정'}</button>
    </div>
    ${exclusionMode ? `
      <div class="card" style="margin-bottom:1rem;display:flex;gap:0.5rem;align-items:center">
        <button type="button" class="btn btn-primary" id="expense-exclusion-apply">제외 구성원 지정</button>
        <button type="button" class="btn btn-secondary" id="expense-exclusion-cancel">취소</button>
      </div>` : ''}`}
    <div id="expenses-list"></div>`;
```

- In the expense card template, render the `.card-actions` block only when NOT locked (keep the card itself + receipt click working):

```js
        ${locked ? '' : `<div class="card-actions">
          <button type="button" class="btn btn-secondary expense-confirm" data-id="${e.id}" data-confirmed="${e.confirmed}">${e.confirmed ? '확정 해제' : '확정'}</button>
          <button type="button" class="btn btn-secondary expense-edit" data-id="${e.id}">수정</button>
          <button type="button" class="btn btn-danger expense-delete" data-id="${e.id}">삭제</button>
        </div>`}
```

- Guard the top-level control wiring so it doesn't run when the buttons are absent. Wrap the `document.getElementById('expense-add')…` and the two exclusion-toggle listeners in `if (!locked) { … }`. The `.expense-confirm`/`.expense-edit`/`.expense-delete`/`.excl-check` querySelectorAll loops are safe to leave (they no-op on an empty NodeList), but the direct `document.getElementById('expense-add').addEventListener` MUST be guarded (it throws on null).

- [ ] **Step 4: `renderMembersTab` — banner + hide add/edit when completed**

In `renderMembersTab`, fetch status alongside members:

```js
    const [membersRes, trip] = await Promise.all([
      callFunction('listMembers', { tripId: session.tripId }),
      callFunction('getTripSetup', { tripId: session.tripId }),
    ]);
    membersCache = membersRes;
```

Add `const locked = trip.status === 'completed';`. Render:

```js
  body.innerHTML = `
    ${locked
      ? '<div class="card" style="margin-bottom:1rem;background:var(--rule)"><strong>완료된 여행</strong> — 구성원 편집이 잠겨 있습니다.</div>'
      : '<button type="button" class="btn btn-primary" id="members-add" style="margin-bottom:1rem">구성원 추가</button>'}
    <div id="members-list"></div>`;

  if (!locked) document.getElementById('members-add').addEventListener('click', () => openMemberModal(body, slug, null));
  renderMembersList(body, slug, locked);
```

Update `renderMembersList(body, slug, locked)` to accept `locked` and render the 수정 button only when not locked:

```js
function renderMembersList(body, slug, locked) {
  body.querySelector('#members-list').innerHTML = membersCache.map((m) => `
    <div class="card" style="margin-bottom:0.6rem;display:flex;justify-content:space-between;align-items:center">
      <div>
        <strong>${escapeHtml(m.name)}</strong>
        <span class="muted" style="font-size:12px;margin-left:0.5rem">가중치 ${m.weight}${m.account ? ' · 계좌 ' + escapeHtml(m.account) : ''}</span>
      </div>
      ${locked ? '' : `<button type="button" class="btn btn-secondary member-edit" data-id="${m.id}">수정</button>`}
    </div>`).join('');

  if (!locked) {
    body.querySelectorAll('.member-edit').forEach((btn) => {
      btn.addEventListener('click', () => openMemberModal(body, slug, membersCache.find((m) => m.id === btn.dataset.id)));
    });
  }
}
```

(Note: `renderMembersList` is also called from `openMemberModal`'s success path — that call site passes no `locked`, which is `undefined` → falsy → not locked. That path only runs after a successful add/edit, which the backend allows only when not completed, so `undefined` is correct there.)

- [ ] **Step 5: Run the frontend suite**

Run: `npm test`
Expected: PASS (45/45).

- [ ] **Step 6: Commit**

```bash
git add public/errorMessages.js public/views/admin.js
git commit -m "feat(frontend): trip-complete toggle + completed-state edit locks and banners"
```

---

## Task 7: E2E + deploy (controller-run)

**Files:** none.

- [ ] Backend suite green (`cd functions && npm test`).
- [ ] Frontend suite green (`npm test`).
- [ ] Emulator E2E at `http://127.0.0.1:5000` (login as admin + as a member of the same trip):
  1. **#2**: 경비 입력 → 사진 선택 → "🔍 문자 추출 중…" + [건너뛰고 직접 입력] appears; click skip → indicator gone, type fields; submit → shows "사진 저장 중…" briefly, saves WITH the photo attached (card shows 📷).
  2. **#2 no-skip**: pick a photo, wait → fields auto-fill (or "자동 인식 실패" toast in the dummy-key emulator), indicator gone.
  3. **#7 summary**: report shows 정산 요약 (총 확정 지출) between 결제자별 지출 and 최종 정산.
  4. **#7 detail**: click a settlement card → modal lists per-expense shares summing to 내야 할 금액; 결제/차액 shown. Admin 입금완료 button does NOT open the modal.
  5. **#6**: as a member, click your OWN card → modal has 내 계좌 입력; save → toast, and the card's 계좌 line updates.
  6. **#11 complete**: admin 여행정보 → [여행 완료 처리] → status 완료됨; 경비확인 + 구성원 tabs show the locked banner and hide add/확정/수정/삭제; attempting an edit path is blocked (buttons absent; backend returns TRIP_COMPLETED if forced).
  7. **#11 uncomplete**: [여행 완료 해제] → controls return.
  8. **#11 comparison**: with a second trip in the same group marked completed, the report 카테고리 분석 shows comparison bars (no longer "비교할 과거 여행이 아직 없습니다").
- [ ] Stop emulator; ports free; no orphaned node/java.
- [ ] Merge `plan-7-account-settlement-tripcomplete` → `main` (fast-forward if possible); push.
- [ ] Deploy backend: `firebase deploy --only functions` (owner-run if the controller lacks credentials — there ARE backend changes this plan). Frontend auto-deploys via Vercel from `main`.
- [ ] Production smoke at https://tripsplit-opal.vercel.app: settlement card detail opens; member sets own account; trip-complete toggles + locks; comparison shows once ≥1 other trip in the group is completed.

---

## Plan-Level Verification

```bash
cd functions && npm test    # backend, all green
cd .. && npm test           # frontend, all green
```

Plus Task 7 emulator E2E and production smoke.

## Self-Review Notes (coverage)
- #2 → Task 4 (both modals). #6 → Task 1 (callable) + Task 5 (own-card UI). #7 → Task 2 (breakdown) + Task 5 (summary + detail). #11 → Task 3 (status + lock) + Task 6 (toggle + banners). errorMessages `TRIP_COMPLETED` → Task 6; `INVALID_STATUS` already present.
- Type consistency: `breakdown: [{expenseId, category, merchant, share}]` produced in Task 2, consumed in Task 5. `setMyAccount({tripId, account})` produced in Task 1, consumed in Task 5. `setTripStatus({tripId, status})` produced in Task 3, consumed in Task 6. `requireTripEditable(db, tripId)` produced/consumed within Task 3.

## What This Plan Does Not Cover
- Plan 8: #8 (trip-photo gallery + lightbox, remove receipt gallery), #9 (member tabbed view).
