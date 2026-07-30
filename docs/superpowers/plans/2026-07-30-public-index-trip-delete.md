# Public Trip Index + Superadmin Trip Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 4 (E2E + deploy) is controller-run.

**Goal:** Add a public, unauthenticated trip-index landing page at `/` listing every trip (name/period/location/group/status, newest-first), each card linking to `/t/{slug}`; and add a "삭제" (delete) button to the superadmin dashboard that wires the already-existing `archiveTrip` callable.

**Architecture:** One new backend callable (`listPublicTrips`, no session required, in a new `publicTrips.js`) followed by two frontend changes: a new root route (`/` → new `public/views/index.js`) and a delete button + confirmation modal added to the existing `public/views/superadmin.js` dashboard (no new backend needed there — `archiveTrip` already exists, is superadmin-gated, and already does a full recursive delete).

**Tech Stack:** Firebase Cloud Functions v2 (CommonJS, Node 20, region asia-northeast3), Firestore; Jest (backend); no-build vanilla-JS ES-module SPA in `public/`; node:test (frontend).

## Global Constraints
- Backend error contract: throw `new Error('DOMAIN_CODE')`; `toHttpsError` maps it. Frontend `errorMessageFor(code)` translates the domain code.
- `requireSession(db, token, allowedRoles, expectedTripId)` returns the session. `listPublicTrips` is the one exception in this plan — it must NOT call `requireSession` at all; it is fully public by design.
- Field-name allowlists on reads: `listPublicTrips` must return ONLY `{name, slug, group, period, location, status}` — never PIN hashes, never the Firestore doc `id`, never `createdAt` (sort is applied server-side).
- No `.orderBy()` on Firestore queries in this codebase (the test double `FakeFirestore` doesn't implement it) — sort arrays in JS after `.get()`, matching every other listing function (`tripPhotos.js`, etc.).
- Frontend view changes have no unit-test harness; verified by `npm test` staying green (helpers/router) + Task 4 E2E. `public/app.js`'s `matchRoute` DOES have a test harness (`public/test/router.test.js`) — its change follows TDD.
- Do NOT trigger native `confirm()`/`alert()` (blocks the app + browser automation). Use `openModal` for the delete confirmation.
- Commit after each task. Backend tests: `cd functions && npm test`. Frontend tests: `npm test` (repo root).

---

## Task 1: Backend — `listPublicTrips` callable

**Files:**
- Create: `functions/src/functions/publicTrips.js`
- Test: `functions/test/functions/publicTrips.test.js`
- Modify: `functions/index.js` (require + register)

**Interfaces:**
- Produces: `listPublicTrips(db)` → `[{name, slug, group, period, location, status}]`, sorted by the trip's `createdAt` descending (newest first). No session required, no PIN hashes, no `id`, no `createdAt` in the response.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/functions/publicTrips.test.js`:

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { listPublicTrips } = require('../../src/functions/publicTrips');

describe('listPublicTrips', () => {
  test('requires no session and returns only public-safe fields', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').add({
      name: 'SFA 2026',
      slug: 'sfa-2026',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-08-01', end: '2026-08-05' },
      location: '부산',
      adminPinHash: 'x',
      memberPinHash: 'y',
      createdAt: 100,
    });

    const result = await listPublicTrips(db, {});
    expect(result).toEqual([{
      name: 'SFA 2026',
      slug: 'sfa-2026',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-08-01', end: '2026-08-05' },
      location: '부산',
    }]);
  });

  test('includes setup-status trips (not just active/completed)', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').add({
      name: 'New Trip', slug: 'new-trip', group: 'G', status: 'setup', period: { start: null, end: null }, location: '', createdAt: 100,
    });

    const result = await listPublicTrips(db, {});
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('setup');
  });

  test('sorts newest-first by createdAt', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').add({
      name: 'Old', slug: 'old', group: 'G', status: 'active', period: {}, location: '', createdAt: 100,
    });
    await db.collection('trips').add({
      name: 'New', slug: 'new', group: 'G', status: 'active', period: {}, location: '', createdAt: 200,
    });

    const result = await listPublicTrips(db, {});
    expect(result.map((t) => t.slug)).toEqual(['new', 'old']);
  });

  test('returns an empty array when there are no trips', async () => {
    const db = new FakeFirestore();
    await expect(listPublicTrips(db, {})).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest publicTrips`
Expected: FAIL (cannot find module `../../src/functions/publicTrips`).

- [ ] **Step 3: Implement `listPublicTrips`**

Create `functions/src/functions/publicTrips.js`:

```js
async function listPublicTrips(db) {
  const snap = await db.collection('trips').get();
  const trips = snap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return trips.map(({
    name, slug, group, period, location, status,
  }) => ({
    name, slug, group, period, location, status,
  }));
}

module.exports = { listPublicTrips };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest publicTrips`
Expected: PASS (4/4).

- [ ] **Step 5: Register the callable**

In `functions/index.js`, add the require after line 22 (`const superadmin = require('./src/functions/superadmin');`):

```js
const superadmin = require('./src/functions/superadmin');
const publicTrips = require('./src/functions/publicTrips');
```

Add the export after line 62 (`exports.archiveTrip = onCall(wrap(superadmin.archiveTrip));`):

```js
exports.archiveTrip = onCall(wrap(superadmin.archiveTrip));

exports.listPublicTrips = onCall(wrap(publicTrips.listPublicTrips));
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/src/functions/publicTrips.js functions/test/functions/publicTrips.test.js functions/index.js
git commit -m "feat(functions): listPublicTrips callable (unauthenticated trip index)"
```

---

## Task 2: Frontend — `/` routes to a new public index view

**Files:**
- Modify: `public/app.js` (`matchRoute` + `mount`)
- Test: `public/test/router.test.js` (update one test)
- Create: `public/views/index.js`

**Interfaces:**
- Produces: `matchRoute('/')` → `{ view: 'index', params: {} }` (was `notfound`).
- Consumes: `listPublicTrips` (Task 1), `callFunction`, `escapeHtml`.

- [ ] **Step 1: Update the failing router test**

In `public/test/router.test.js`, replace the test at lines 30-32:

```js
  test('the bare root path routes to notfound', () => {
    assert.deepEqual(matchRoute('/'), { view: 'notfound', params: {} });
  });
```

with:

```js
  test('the bare root path routes to the public trip index', () => {
    assert.deepEqual(matchRoute('/'), { view: 'index', params: {} });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL (`matchRoute('/')` still returns `{ view: 'notfound', params: {} }`).

- [ ] **Step 3: Update `matchRoute`**

In `public/app.js`, add a check at the top of `matchRoute` (before the `parts[0] === 'sa'` check):

```js
function matchRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { view: 'index', params: {} };
  }

  if (parts[0] === 'sa' && parts[1]) {
```

- [ ] **Step 4: Wire the `index` view into `mount()`**

In `public/app.js`, add a branch in `mount()` right after the `notfound` block:

```js
  if (view === 'notfound') {
    root.innerHTML = '<div class="container center" style="padding:4rem 0"><h2>페이지를 찾을 수 없습니다</h2></div>';
    return;
  }

  if (view === 'index') {
    const mod = await import('./views/index.js');
    mod.mount(root);
    return;
  }
```

- [ ] **Step 5: Run the router test to verify it passes**

Run: `npm test`
Expected: PASS (49/49 — the router suite plus everything else; `index.js` doesn't exist yet so this only proves routing, not rendering).

- [ ] **Step 6: Create the public index view**

Create `public/views/index.js`:

```js
import { callFunction } from '../api.js';
import { escapeHtml } from '../ui.js';

const STATUS_BADGE = {
  setup: '<span class="badge badge-pending">설정중</span>',
  active: '<span class="badge">진행 중</span>',
  completed: '<span class="badge badge-locked">완료됨</span>',
};

async function mount(root) {
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <p class="label">TripSplit</p>
      <h1>여행 목록</h1>
      <div id="trip-index-list" style="margin-top:1.5rem"><p class="muted">불러오는 중...</p></div>
    </div>`;
  await loadTrips(root);
}

async function loadTrips(root) {
  const listEl = root.querySelector('#trip-index-list');
  let trips;
  try {
    trips = await callFunction('listPublicTrips', {});
  } catch (err) {
    listEl.innerHTML = `<p class="muted">여행 목록을 불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="trip-index-retry">다시 시도</button>`;
    listEl.querySelector('#trip-index-retry').addEventListener('click', () => loadTrips(root));
    return;
  }

  if (trips.length === 0) {
    listEl.innerHTML = '<p class="muted">아직 생성된 여행이 없습니다.</p>';
    return;
  }

  listEl.innerHTML = trips.map((t) => `
    <a href="/t/${encodeURIComponent(t.slug)}" class="card" style="display:block;margin-bottom:0.8rem;text-decoration:none;color:inherit">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
        <strong>${escapeHtml(t.name)}</strong>
        ${STATUS_BADGE[t.status] || ''}
      </div>
      <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(t.period?.start || '')} — ${escapeHtml(t.period?.end || '')} · ${escapeHtml(t.location || '')}</p>
      <span class="tag" style="margin-top:0.5rem;display:inline-block">${escapeHtml(t.group)}</span>
    </a>`).join('');
}

export { mount };
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npm test`
Expected: PASS (49/49 — `index.js` has no unit-test harness, consistent with every other file in `public/views/`; this run confirms nothing else broke).

- [ ] **Step 8: Commit**

```bash
git add public/app.js public/test/router.test.js public/views/index.js
git commit -m "feat(frontend): public trip index page at /"
```

---

## Task 3: Frontend — superadmin trip delete

**Files:**
- Modify: `public/views/superadmin.js`

**Interfaces:**
- Consumes: `archiveTrip` (already implemented and registered — no backend change).

- [ ] **Step 1: Add the delete button to each trip row**

In `public/views/superadmin.js`'s `loadTrips`, change the table row template (currently a single `<td>` with just the PIN-reissue button):

```js
            <td><button type="button" class="btn btn-secondary sa-reissue" data-trip-id="${t.id}">PIN 재발급</button></td>
```

to:

```js
            <td style="white-space:nowrap">
              <button type="button" class="btn btn-secondary sa-reissue" data-trip-id="${t.id}">PIN 재발급</button>
              <button type="button" class="btn btn-danger sa-delete" data-trip-id="${t.id}">삭제</button>
            </td>
```

- [ ] **Step 2: Wire the delete button, looking up the trip's name from the already-fetched list**

Right after the existing `.sa-reissue` wiring in `loadTrips` (`listEl.querySelectorAll('.sa-reissue').forEach(...)`), add:

```js
  listEl.querySelectorAll('.sa-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      const trip = trips.find((t) => t.id === btn.dataset.tripId);
      openDeleteTripModal(root, btn.dataset.tripId, trip?.name || '');
    });
  });
```

(`trips` is already in scope — it's the array `loadTrips` fetched via `listTrips` at the top of the function. This mirrors how `admin.js`'s `renderMembersList` looks up a member from `membersCache` instead of stuffing display text into a `data-*` attribute.)

- [ ] **Step 3: Add the confirmation modal + delete handler**

Add a new function after `openReissueModal`:

```js
function openDeleteTripModal(root, tripId, tripName) {
  openModal('여행 삭제', `
    <p>정말 <strong>${escapeHtml(tripName)}</strong> 여행을 삭제하시겠습니까?</p>
    <p class="muted" style="font-size:13px;margin-top:0.5rem">모든 경비, 구성원, 사진 데이터가 영구적으로 삭제되며 되돌릴 수 없습니다.</p>
    <button type="button" class="btn btn-danger btn-block" id="dt-confirm" style="margin-top:1rem">삭제</button>
    <p class="muted" id="dt-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  document.getElementById('dt-confirm').addEventListener('click', async () => {
    const btn = document.getElementById('dt-confirm');
    btn.disabled = true; btn.textContent = '삭제 중...';
    try {
      await callFunction('archiveTrip', { tripId });
      closeModal();
      showToast('여행이 삭제되었습니다', 'success');
      try {
        await loadTrips(root);
      } catch (err) {
        showToast(`목록을 새로고침하지 못했습니다: ${err.message}`, 'error');
      }
    } catch (err) {
      btn.disabled = false; btn.textContent = '삭제';
      document.getElementById('dt-error').textContent = err.message;
    }
  });
}
```

- [ ] **Step 4: Update the export**

At the bottom of the file, `openDeleteTripModal` does not need to be exported (it's only called internally, same as `openReissueModal`/`openCreateTripModal`) — leave `export { mount };` unchanged.

- [ ] **Step 5: Run the frontend suite**

Run: `npm test`
Expected: PASS (49/49).

- [ ] **Step 6: Commit**

```bash
git add public/views/superadmin.js
git commit -m "feat(frontend): superadmin trip delete (wires existing archiveTrip callable)"
```

---

## Task 4: E2E + deploy (controller-run)

**Files:** none.

- [ ] Backend suite green (`cd functions && npm test`).
- [ ] Frontend suite green (`npm test`).
- [ ] Emulator E2E at `http://127.0.0.1:5000`:
  1. Visit `/` with no session → trip index renders with cards for every existing trip (including any in `setup` status), sorted newest-first, each showing name/period/location/group tag/status badge.
  2. Click a card → navigates to `/t/{slug}` and shows the login screen (or admin console if a `setup`-status trip's admin is already logged in from a prior session).
  3. Visit `/` with zero trips in the emulator → "아직 생성된 여행이 없습니다" empty state.
  4. Log in as superadmin at `/sa/...` → each trip row now has a "삭제" button next to "PIN 재발급" → click it → confirmation modal shows the trip's name and a permanent-deletion warning → confirm → toast, row disappears, trip gone from `/` too.
- [ ] Stop emulator; ports free; no orphaned node/java.
- [ ] Push to `main`.
- [ ] Deploy backend: `firebase deploy --only functions` (owner-run if the controller lacks credentials — `listPublicTrips` is a new callable). Frontend auto-deploys via Vercel from `main`.
- [ ] Production smoke at https://tripsplit-opal.vercel.app: `/` shows the real trip list; a card click reaches `/t/{slug}`; superadmin delete works on a disposable test trip.

---

## Plan-Level Verification

```bash
cd functions && npm test    # backend, all green
cd .. && npm test           # frontend, all green
```

Plus Task 4 emulator E2E and production smoke.

## Self-Review Notes (coverage)
- Public index (#1) → Task 1 (backend) + Task 2 (routing + view).
- Superadmin delete (#2) → Task 3 (frontend only — `archiveTrip` already existed and needed no backend change).
- Type consistency: `listPublicTrips` returns `{name, slug, group, period, location, status}` (Task 1); `index.js`'s `loadTrips` consumes exactly those fields (Task 2) — no extra fields assumed, no `id` used (links are built from `slug`).
- `archiveTrip({tripId})` (pre-existing) is called with the same shape in Task 3 as every other superadmin action already in `superadmin.js` (`updateTrip({tripId, patch})` etc.).

## What This Plan Does Not Cover
- Any change to `archiveTrip`'s naming or behavior.
- Pagination, search, or filtering on the public index.
- Rate limiting on `listPublicTrips` (see the design doc's Backend Reality section for why).
