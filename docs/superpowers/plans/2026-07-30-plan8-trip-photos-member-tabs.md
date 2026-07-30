# Plan 8 Implementation Plan: Trip Photo Gallery + Member Tabbed View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 8 (E2E + deploy) is controller-run.

**Goal:** Replace the report's receipt-photo gallery with a standalone "여행사진" (trip photo) gallery that anyone on the trip can add to and browse with a prev/next lightbox, and give the member view the same tab-bar structure the admin view already has (경비목록 / 구성원 read-only / 리포트) instead of a flat list + button-swap.

**Architecture:** Three backend changes (a new `tripPhotos.js` with `addTripPhoto`/`listTripPhotos`/`deleteTripPhoto` backed by a new `trips/{tripId}/photos` subcollection and a generalized Storage upload helper; relaxing `listMembers` to allow `member` sessions; removing the now-unused `listReceiptUrls`) followed by three frontend changes (a small `ui.js` addition — an `onKeydown` option on `openModal` plus a shared `fileToBase64` — then the `report.js` gallery/lightbox UI, then a full tab-bar restructure of `member.js`).

**Tech Stack:** Firebase Cloud Functions v2 (CommonJS, Node 20, region asia-northeast3), Firestore; Jest (backend); no-build vanilla-JS ES-module SPA in `public/`; node:test (frontend).

## Global Constraints
- Backend error contract: throw `new Error('DOMAIN_CODE')`; `toHttpsError` maps it. Frontend `errorMessageFor(code)` translates the domain code. Add new codes to `public/errorMessages.js`.
- `requireSession(db, token, allowedRoles, expectedTripId)` returns the session `{ role, tripId, memberId, ... }`. Always call it first in every callable.
- Members and admins are distinct principals: an admin session has `memberId === null`; only `member` sessions map to a settlement card / trip-photo uploader identity.
- Field-name allowlists on writes: never persist client-supplied fields outside an explicit allowlist.
- Trip photos are **exempt** from `requireTripEditable` — do not call it in `tripPhotos.js`. This is intentional (owner-confirmed): photos are memories, often added after a trip is marked complete.
- Frontend view changes have no unit-test harness; they are verified by `npm test` staying green (helpers) + Task 8 E2E. Pure helpers get a node:test.
- Do NOT trigger native `confirm()`/`alert()` (blocks the app + browser automation). Use in-place actions or `openModal`.
- Commit after each task. Backend tests: `cd functions && npm test`. Frontend tests: `npm test` (repo root).

---

## Task 1: Backend — `tripPhotos.js` (addTripPhoto/listTripPhotos/deleteTripPhoto) [#8]

**Files:**
- Modify: `functions/src/lib/storage.js` (add `uploadTripPhotoImage`)
- Test: `functions/test/lib/storage.test.js` (append tests)
- Create: `functions/src/functions/tripPhotos.js`
- Test: `functions/test/functions/tripPhotos.test.js`
- Modify: `functions/index.js` (register the three callables, bucket-wrapped)

**Interfaces:**
- Produces: `uploadTripPhotoImage(bucket, tripId, base64, mimeType)` → Storage path `tripPhotos/{tripId}/{random}.{ext}` (mirrors `uploadReceiptImage`).
- Produces: `addTripPhoto(db, bucket, data)` where `data = {sessionToken, tripId, photoBase64, mimeType}` → `{id, photoPath}`. `requireSession(['admin','member'])`. No `requireTripEditable` call.
- Produces: `listTripPhotos(db, bucket, data)` where `data = {sessionToken, tripId}` → `{photos: [{id, url, uploadedBy, createdAt}]}` ordered oldest-first.
- Produces: `deleteTripPhoto(db, bucket, data)` where `data = {sessionToken, tripId, photoId}` → `{ok: true}`. Uploader or admin only.
- Consumes: `requireSession` (`../lib/sessions`), `getReceiptReadUrl` (`../lib/storage` — generic despite the name, signs any path), `ALLOWED_MIME_TYPES` (`./receipts`).

- [ ] **Step 1: Write the failing test for `uploadTripPhotoImage`**

Append to `functions/test/lib/storage.test.js`:

```js
const { uploadTripPhotoImage } = require('../../src/lib/storage');

describe('uploadTripPhotoImage', () => {
  test('saves the image under tripPhotos/{tripId} and returns the object path', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadTripPhotoImage(bucket, 'trip1', Buffer.from('fake-image').toString('base64'), 'image/jpeg');

    expect(path).toMatch(/^tripPhotos\/trip1\/[0-9a-f]{32}\.jpg$/);
    expect(bucket.saved).toHaveLength(1);
    expect(bucket.saved[0].opts.metadata.contentType).toBe('image/jpeg');
  });

  test('uses a .png extension for png images', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadTripPhotoImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/png');
    expect(path).toMatch(/\.png$/);
  });
});
```

(Add this `require` alongside the existing `uploadReceiptImage, getReceiptReadUrl, READ_URL_TTL_MS` import at the top of the file, or add a second `require` line — either works since both come from the same module.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd functions && npx jest storage -t uploadTripPhotoImage`
Expected: FAIL (`uploadTripPhotoImage is not a function`).

- [ ] **Step 3: Implement `uploadTripPhotoImage`**

In `functions/src/lib/storage.js`, add after `uploadReceiptImage` (before `getReceiptReadUrl`):

```js
/**
 * Same shape as uploadReceiptImage but under a separate tripPhotos/ prefix —
 * trip photos are a distinct feature from expense receipts and must never
 * mix in the same Storage folder.
 */
async function uploadTripPhotoImage(bucket, tripId, base64, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const filePath = `tripPhotos/${tripId}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(base64ToBuffer(base64), { metadata: { contentType: mimeType } });
  return filePath;
}
```

Update the export line:

```js
module.exports = {
  uploadReceiptImage, uploadTripPhotoImage, getReceiptReadUrl, base64ToBuffer, READ_URL_TTL_MS,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd functions && npx jest storage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/storage.js functions/test/lib/storage.test.js
git commit -m "feat(functions): uploadTripPhotoImage storage helper"
```

- [ ] **Step 6: Write the failing tests for `tripPhotos.js`**

Create `functions/test/functions/tripPhotos.test.js`:

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { createSession } = require('../../src/lib/sessions');
const { addTripPhoto, listTripPhotos, deleteTripPhoto } = require('../../src/functions/tripPhotos');

async function seed() {
  const db = new FakeFirestore();
  const bucket = makeFakeBucket();
  const { token: adminToken } = await createSession(db, { role: 'admin', tripId: 't1' });
  const { token: memberToken } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
  const { token: otherMemberToken } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm2' });
  return {
    db, bucket, adminToken, memberToken, otherMemberToken,
  };
}

describe('addTripPhoto', () => {
  test('admin upload creates a photo doc with uploadedBy "admin"', async () => {
    const { db, bucket, adminToken } = await seed();
    const { id, photoPath } = await addTripPhoto(db, bucket, {
      sessionToken: adminToken, tripId: 't1', photoBase64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg',
    });

    expect(photoPath).toMatch(/^tripPhotos\/t1\/[0-9a-f]{32}\.jpg$/);
    const snap = await db.collection('trips').doc('t1').collection('photos').doc(id).get();
    expect(snap.data().uploadedBy).toBe('admin');
    expect(snap.data().photoPath).toBe(photoPath);
    expect(typeof snap.data().createdAt).toBe('number');
  });

  test('member upload creates a photo doc with uploadedBy = the member\'s id', async () => {
    const { db, bucket, memberToken } = await seed();
    const { id } = await addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't1', photoBase64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg',
    });

    const snap = await db.collection('trips').doc('t1').collection('photos').doc(id).get();
    expect(snap.data().uploadedBy).toBe('m1');
  });

  test('rejects a mimeType outside the allowlist before uploading anything', async () => {
    const { db, bucket, memberToken } = await seed();
    await expect(addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/heic',
    })).rejects.toThrow('INVALID_MIME_TYPE');
    expect(bucket.saved).toHaveLength(0);
  });

  test('rejects a missing photo or mimeType with MISSING_FIELDS', async () => {
    const { db, bucket, memberToken } = await seed();
    await expect(addTripPhoto(db, bucket, { sessionToken: memberToken, tripId: 't1', mimeType: 'image/jpeg' }))
      .rejects.toThrow('MISSING_FIELDS');
  });

  test('succeeds even when the trip is completed (photos are exempt from the edit lock)', async () => {
    const { db, bucket, memberToken } = await seed();
    await db.collection('trips').doc('t1').set({ status: 'completed' });

    await expect(addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).resolves.toBeDefined();
  });

  test('rejects a session scoped to a different trip', async () => {
    const { db, bucket, memberToken } = await seed();
    await expect(addTripPhoto(db, bucket, {
      sessionToken: memberToken, tripId: 't2', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).rejects.toThrow('FORBIDDEN');
  });
});

describe('listTripPhotos', () => {
  test('returns photos oldest-first with signed URLs', async () => {
    const { db, bucket, memberToken } = await seed();
    const photosRef = db.collection('trips').doc('t1').collection('photos');
    await photosRef.doc('p2').set({ photoPath: 'tripPhotos/t1/b.jpg', uploadedBy: 'm1', createdAt: 200 });
    await photosRef.doc('p1').set({ photoPath: 'tripPhotos/t1/a.jpg', uploadedBy: 'admin', createdAt: 100 });

    const { photos } = await listTripPhotos(db, bucket, { sessionToken: memberToken, tripId: 't1' });
    expect(photos.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(photos[0].url).toMatch(/^https:\/\/storage\.fake\/tripPhotos\/t1\/a\.jpg/);
    expect(photos[0].uploadedBy).toBe('admin');
  });

  test('returns an empty array when there are no photos', async () => {
    const { db, bucket, memberToken } = await seed();
    const { photos } = await listTripPhotos(db, bucket, { sessionToken: memberToken, tripId: 't1' });
    expect(photos).toEqual([]);
  });
});

describe('deleteTripPhoto', () => {
  async function seedPhoto(db, uploadedBy) {
    const ref = db.collection('trips').doc('t1').collection('photos').doc();
    await ref.set({ photoPath: `tripPhotos/t1/${ref.id}.jpg`, uploadedBy, createdAt: 1 });
    return ref.id;
  }

  test('the uploader can delete their own photo', async () => {
    const { db, bucket, memberToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');

    await expect(deleteTripPhoto(db, bucket, { sessionToken: memberToken, tripId: 't1', photoId })).resolves.toEqual({ ok: true });
    expect((await db.collection('trips').doc('t1').collection('photos').doc(photoId).get()).exists).toBe(false);
  });

  test('an admin can delete any photo', async () => {
    const { db, bucket, adminToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');

    await expect(deleteTripPhoto(db, bucket, { sessionToken: adminToken, tripId: 't1', photoId })).resolves.toEqual({ ok: true });
  });

  test('a different member cannot delete someone else\'s photo', async () => {
    const { db, bucket, otherMemberToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');

    await expect(deleteTripPhoto(db, bucket, { sessionToken: otherMemberToken, tripId: 't1', photoId })).rejects.toThrow('FORBIDDEN');
  });

  test('throws PHOTO_NOT_FOUND for a missing id', async () => {
    const { db, bucket, adminToken } = await seed();
    await expect(deleteTripPhoto(db, bucket, { sessionToken: adminToken, tripId: 't1', photoId: 'nope' }))
      .rejects.toThrow('PHOTO_NOT_FOUND');
  });

  test('succeeds even when the trip is completed', async () => {
    const { db, bucket, memberToken } = await seed();
    const photoId = await seedPhoto(db, 'm1');
    await db.collection('trips').doc('t1').set({ status: 'completed' });

    await expect(deleteTripPhoto(db, bucket, { sessionToken: memberToken, tripId: 't1', photoId })).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd functions && npx jest tripPhotos`
Expected: FAIL (cannot find module `../../src/functions/tripPhotos`).

- [ ] **Step 8: Implement `tripPhotos.js`**

Create `functions/src/functions/tripPhotos.js`:

```js
const { requireSession } = require('../lib/sessions');
const { uploadTripPhotoImage, getReceiptReadUrl } = require('../lib/storage');
const { ALLOWED_MIME_TYPES } = require('./receipts');

async function addTripPhoto(db, bucket, data) {
  const {
    sessionToken, tripId, photoBase64, mimeType,
  } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  if (!photoBase64 || !mimeType) throw new Error('MISSING_FIELDS');
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error('INVALID_MIME_TYPE');

  const photoPath = await uploadTripPhotoImage(bucket, tripId, photoBase64, mimeType);
  const ref = await db.collection('trips').doc(tripId).collection('photos').add({
    photoPath,
    uploadedBy: session.memberId ?? 'admin',
    createdAt: Date.now(),
  });
  return { id: ref.id, photoPath };
}

async function listTripPhotos(db, bucket, data) {
  const { sessionToken, tripId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const snap = await db.collection('trips').doc(tripId).collection('photos').get();
  const photos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.createdAt - b.createdAt);

  const withUrls = await Promise.all(photos.map(async (p) => ({
    id: p.id,
    uploadedBy: p.uploadedBy,
    createdAt: p.createdAt,
    url: await getReceiptReadUrl(bucket, p.photoPath),
  })));
  return { photos: withUrls };
}

async function deleteTripPhoto(db, bucket, data) {
  const { sessionToken, tripId, photoId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const ref = db.collection('trips').doc(tripId).collection('photos').doc(photoId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('PHOTO_NOT_FOUND');
  const photo = snap.data();

  if (session.role === 'member' && photo.uploadedBy !== session.memberId) throw new Error('FORBIDDEN');

  // Best-effort: a storage failure must never block the doc delete.
  if (photo.photoPath) {
    await bucket.file(photo.photoPath).delete().catch(() => {});
  }
  await ref.delete();
  return { ok: true };
}

module.exports = { addTripPhoto, listTripPhotos, deleteTripPhoto };
```

- [ ] **Step 9: Run it to verify it passes**

Run: `cd functions && npx jest tripPhotos`
Expected: PASS (all 13 new tests).

- [ ] **Step 10: Register the callables**

In `functions/index.js`, change lines 27-28 from:

```js
const receipts = require('./src/functions/receipts');
const report = require('./src/functions/report');
```

to:

```js
const receipts = require('./src/functions/receipts');
const tripPhotos = require('./src/functions/tripPhotos');
const report = require('./src/functions/report');
```

Add after the `getReceiptUrl` export (after line 93, before the `report` exports):

```js
exports.addTripPhoto = onCall(wrapWithBucket(tripPhotos.addTripPhoto));
exports.listTripPhotos = onCall(wrapWithBucket(tripPhotos.listTripPhotos));
exports.deleteTripPhoto = onCall(wrapWithBucket(tripPhotos.deleteTripPhoto));
```

- [ ] **Step 11: Add the `PHOTO_NOT_FOUND` frontend error message**

In `public/errorMessages.js`, add after `TRIP_NOT_FOUND`:

```js
  PHOTO_NOT_FOUND: '사진을 찾을 수 없습니다.',
```

- [ ] **Step 12: Run the full backend suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add functions/src/functions/tripPhotos.js functions/test/functions/tripPhotos.test.js functions/index.js public/errorMessages.js
git commit -m "feat(functions): addTripPhoto/listTripPhotos/deleteTripPhoto callables"
```

---

## Task 2: Backend — `listMembers` allows member sessions [#9]

**Files:**
- Modify: `functions/src/functions/members.js:67`
- Test: `functions/test/functions/members.test.js` (replace one test, add one)

**Interfaces:**
- Produces: `listMembers(db, data)` now resolves for `session.role ∈ {admin, member}` (previously admin-only). Response shape unchanged: `[{id, name, weight, account, settled}]`.

- [ ] **Step 1: Update the failing/changed test**

In `functions/test/functions/members.test.js`, replace the test at lines 257-261 (`'listMembers requires an admin session, not a member session'`) with:

```js
  test('listMembers resolves for a member session (read-only roster access)', async () => {
    const db = new FakeFirestore();
    const { token: adminTok } = await createSession(db, { role: 'admin', tripId: 't1' });
    await addMember(db, {
      sessionToken: adminTok, tripId: 't1', name: '슬기', weight: 1.5, account: '우리 111',
    });
    const { token: memberTok } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const result = await listMembers(db, { sessionToken: memberTok, tripId: 't1' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('슬기');
    expect(result[0].account).toBe('우리 111');
  });

  test('listMembers rejects a session with neither admin nor member role', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    await expect(listMembers(db, { sessionToken: token, tripId: 't1' })).rejects.toThrow('FORBIDDEN');
  });
```

- [ ] **Step 2: Run it to verify the new test fails**

Run: `cd functions && npx jest members -t listMembers`
Expected: FAIL (`listMembers resolves for a member session` throws `FORBIDDEN`).

- [ ] **Step 3: Relax the allowed roles**

In `functions/src/functions/members.js:67`, change:

```js
async function listMembers(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);
```

to:

```js
async function listMembers(db, data) {
  await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
```

- [ ] **Step 4: Run the members suite to verify it passes**

Run: `cd functions && npx jest members`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/members.js functions/test/functions/members.test.js
git commit -m "feat(functions): listMembers allows member-role read-only roster access"
```

---

## Task 3: Backend — remove `listReceiptUrls` [#8]

The frontend gallery calling this is being replaced (Task 6); nothing else calls it, so it becomes dead code.

**Files:**
- Modify: `functions/src/functions/report.js` (remove the function + its export)
- Modify: `functions/index.js:96` (remove the export line, and the now-unused `getReceiptReadUrl` import stays since `tripPhotos.js` owns its own import — no change needed to `storage.js`'s exports)
- Modify: `functions/test/functions/report.test.js` (remove its describe block)

- [ ] **Step 1: Remove the `describe('listReceiptUrls', …)` block**

In `functions/test/functions/report.test.js`, delete lines 253-281 (the entire `describe('listReceiptUrls', …)` block) and remove `listReceiptUrls` from the destructured import on line 4:

```js
const { getReportData, perPersonCategoryAverage, listReceiptUrls } = require('../../src/functions/report');
```

becomes:

```js
const { getReportData, perPersonCategoryAverage } = require('../../src/functions/report');
```

- [ ] **Step 2: Remove the function from `report.js`**

In `functions/src/functions/report.js`, delete the `listReceiptUrls` function (lines 95-109) and remove the now-unused `getReceiptReadUrl` import (line 3):

```js
const { getReceiptReadUrl } = require('../lib/storage');
```

Update the export line:

```js
module.exports = { getReportData, perPersonCategoryAverage };
```

- [ ] **Step 3: Remove the callable registration**

In `functions/index.js`, delete line 96:

```js
exports.listReceiptUrls = onCall(wrapWithBucket(report.listReceiptUrls));
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/report.js functions/test/functions/report.test.js functions/index.js
git commit -m "refactor(functions): remove listReceiptUrls (superseded by trip photos)"
```

---

## Task 4: Frontend — `ui.js` — `openModal` keydown hook + shared `fileToBase64`

**Files:**
- Modify: `public/ui.js`
- Test: `public/test/ui.test.js` (append tests)
- Modify: `public/views/admin.js` (dedupe `fileToBase64`)
- Modify: `public/views/member.js` (dedupe `fileToBase64`)

**Interfaces:**
- Produces: `openModal(titleHTML, bodyHTML, { onKeydown } = {})` — `onKeydown(event)` fires for every keydown while the modal is open, except `Escape` (which still closes it first). Replaced on every `openModal` call, same lifecycle as the existing Escape handler.
- Produces: `fileToBase64(file)` → `Promise<string>` (base64, no data-URL prefix) — moved here verbatim from `member.js`/`admin.js` (both had identical copies).

- [ ] **Step 1: Write the failing tests**

Append to `public/test/ui.test.js` (inside the `describe('ui.js', …)` block, and update the import line):

```js
const { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 } = await import('../ui.js');
```

```js
  test('openModal invokes onKeydown for non-Escape keys while open', () => {
    let received = null;
    openModal('제목', '내용', { onKeydown: (e) => { received = e.key; } });
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(received, 'ArrowRight');
    closeModal();
  });

  test('onKeydown does not fire for Escape (Escape still closes the modal)', () => {
    let calls = 0;
    openModal('제목', '내용', { onKeydown: () => { calls += 1; } });
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(calls, 0);
    assert.equal(document.getElementById('modal-overlay').classList.contains('open'), false);
  });

  test('a new openModal call replaces the previous onKeydown handler', () => {
    let calls = 0;
    openModal('제목', '내용', { onKeydown: () => { calls += 1; } });
    openModal('제목2', '내용2');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(calls, 0);
    closeModal();
  });

  test('fileToBase64 resolves with the base64 payload (no data-URL prefix)', async () => {
    const file = new dom.window.File([new dom.window.Blob(['hi'])], 'x.jpg', { type: 'image/jpeg' });
    const result = await fileToBase64(file);
    assert.equal(typeof result, 'string');
    assert.ok(!result.startsWith('data:'));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (`onKeydown` has no effect yet — the third test passes trivially with no handler wired, so it may falsely pass; the first test fails because nothing invokes it; `fileToBase64 is not a function`).

- [ ] **Step 3: Implement in `ui.js`**

Replace `openModal`:

```js
function openModal(titleHTML, bodyHTML, { onKeydown } = {}) {
  const overlay = getModalRoot();
  const box = overlay.querySelector('.modal-box');
  overlay.querySelector('.modal-title').textContent = titleHTML;
  box.setAttribute('aria-label', String(titleHTML));
  overlay.querySelector('.modal-body').innerHTML = bodyHTML;
  overlay.classList.add('open');

  if (escHandler) document.removeEventListener('keydown', escHandler);
  lastFocused = document.activeElement;
  escHandler = (e) => {
    if (e.key === 'Escape') { closeModal(); return; }
    if (onKeydown) onKeydown(e);
  };
  document.addEventListener('keydown', escHandler);

  const first = overlay.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-body button');
  if (first) first.focus();
}
```

Add `fileToBase64` after `escapeHtml`:

```js
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

Update the export line:

```js
export { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (49/49).

- [ ] **Step 5: Dedupe `fileToBase64` out of `admin.js` and `member.js`**

In `public/views/admin.js`, change the import (line 3) to:

```js
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 } from '../ui.js';
```

and delete the local `fileToBase64` function (currently at the bottom of the file, just above `export { mount };`).

In `public/views/member.js`, change the import (line 3) to:

```js
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 } from '../ui.js';
```

and delete the local `fileToBase64` function (currently at the bottom of the file, just above `export { mount };`).

- [ ] **Step 6: Run the frontend suite**

Run: `npm test`
Expected: PASS (49/49 — `admin.js`/`member.js` have no test harness; this is a manual sanity check that nothing else referenced the deleted local function, confirmed by `grep -rn "function fileToBase64" public/views/` returning nothing).

- [ ] **Step 7: Commit**

```bash
git add public/ui.js public/test/ui.test.js public/views/admin.js public/views/member.js
git commit -m "feat(frontend): openModal onKeydown option + shared fileToBase64"
```

---

## Task 5: Frontend — `report.js` trip-photo gallery + lightbox [#8]

**Files:**
- Modify: `public/views/report.js`

**Interfaces:**
- Consumes: `listTripPhotos`/`addTripPhoto`/`deleteTripPhoto` (Task 1), `openModal(title, body, {onKeydown})`/`fileToBase64` (Task 4).

- [ ] **Step 1: Import `fileToBase64`**

In `public/views/report.js` line 3, add `fileToBase64`:

```js
import { openModal, closeModal, showToast, escapeHtml, fileToBase64 } from '../ui.js';
```

- [ ] **Step 2: Replace the 영수증 갤러리 section markup**

In `renderReportInto`'s `container.innerHTML` template, replace line 52:

```js
    <div class="section"><h2>영수증 갤러리</h2><div id="report-gallery"><p class="muted">불러오는 중...</p></div></div>`;
```

with:

```js
    <div class="section"><h2>여행사진</h2>
      <input type="file" accept="image/jpeg,image/png" id="tp-upload" style="display:none">
      <button type="button" class="btn btn-secondary" id="tp-upload-btn" style="margin-bottom:0.6rem">사진 추가</button>
      <div id="tp-gallery"><p class="muted">불러오는 중...</p></div>
    </div>`;
```

- [ ] **Step 3: Replace the old gallery-fetch block with the upload wiring + `loadTripPhotos` call**

At the end of `renderReportInto`, replace the trailing `try { ... listReceiptUrls ... } catch { ... }` block (lines 113-125) with:

```js
  document.getElementById('tp-upload-btn').addEventListener('click', () => document.getElementById('tp-upload').click());
  document.getElementById('tp-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = document.getElementById('tp-upload-btn');
    btn.disabled = true; btn.textContent = '올리는 중...';
    try {
      const b64 = await fileToBase64(file);
      await callFunction('addTripPhoto', { tripId: session.tripId, photoBase64: b64, mimeType: file.type });
      await loadTripPhotos(container, session.tripId);
      showToast('사진이 추가되었습니다', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '사진 추가';
      e.target.value = '';
    }
  });

  await loadTripPhotos(container, session.tripId);
}
```

(This closing `}` ends `renderReportInto` — the old function ended the same way after its try/catch, so no extra brace is being added.)

- [ ] **Step 4: Add the gallery + lightbox module-scope helpers**

Add these after `renderReportInto` (before `mount`):

```js
let tripPhotosCache = [];

async function loadTripPhotos(container, tripId) {
  const gal = container.querySelector('#tp-gallery');
  if (!gal) return;
  try {
    const { photos } = await callFunction('listTripPhotos', { tripId });
    tripPhotosCache = photos;
    gal.innerHTML = photos.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px">${photos.map((p, i) => `<img src="${escapeHtml(p.url)}" data-index="${i}" class="tp-thumb" style="width:100%;height:90px;object-fit:cover;border-radius:4px;cursor:pointer" alt="여행사진">`).join('')}</div>`
      : '<p class="muted">여행사진이 없습니다.</p>';
    gal.querySelectorAll('.tp-thumb').forEach((img) => {
      img.addEventListener('click', () => openTripPhoto(tripId, Number(img.dataset.index), container));
    });
  } catch (err) {
    gal.innerHTML = '<p class="muted">사진을 불러오지 못했습니다.</p>';
  }
}

function renderLightbox(photos, index) {
  const p = photos[index];
  const session = getSession();
  const canDelete = session.role === 'admin' || p.uploadedBy === session.memberId;
  return `
    <div style="text-align:center">
      <img src="${escapeHtml(p.url)}" style="max-width:100%;border-radius:4px" alt="여행사진">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.6rem">
        <button type="button" class="btn btn-secondary" id="tp-prev" ${index === 0 ? 'disabled' : ''}>◀ 이전</button>
        <span class="muted" style="font-size:12px">${index + 1} / ${photos.length}</span>
        <button type="button" class="btn btn-secondary" id="tp-next" ${index === photos.length - 1 ? 'disabled' : ''}>다음 ▶</button>
      </div>
      ${canDelete ? '<button type="button" class="btn btn-danger btn-block" id="tp-delete" style="margin-top:0.6rem">삭제</button>' : ''}
    </div>`;
}

function openTripPhoto(tripId, index, container) {
  const step = (next) => {
    if (next < 0 || next >= tripPhotosCache.length) return;
    openTripPhoto(tripId, next, container);
  };

  openModal('여행사진', renderLightbox(tripPhotosCache, index), {
    onKeydown: (e) => {
      if (e.key === 'ArrowLeft') step(index - 1);
      if (e.key === 'ArrowRight') step(index + 1);
    },
  });

  const prevBtn = document.getElementById('tp-prev');
  const nextBtn = document.getElementById('tp-next');
  if (prevBtn) prevBtn.addEventListener('click', () => step(index - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => step(index + 1));

  const delBtn = document.getElementById('tp-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true; delBtn.textContent = '삭제 중...';
      try {
        await callFunction('deleteTripPhoto', { tripId, photoId: tripPhotosCache[index].id });
        closeModal();
        await loadTripPhotos(container, tripId);
        showToast('사진이 삭제되었습니다', 'success');
      } catch (err) {
        delBtn.disabled = false; delBtn.textContent = '삭제';
        showToast(err.message, 'error');
      }
    });
  }
}
```

- [ ] **Step 5: Run the frontend suite**

Run: `npm test`
Expected: PASS (49/49 — no helper behavior changed, `report.js` has no unit-test harness).

- [ ] **Step 6: Commit**

```bash
git add public/views/report.js
git commit -m "feat(frontend): trip photo gallery + prev/next lightbox in report"
```

---

## Task 6: Frontend — `member.js` tab-bar restructure [#9]

**Files:**
- Modify: `public/views/member.js` (full restructure)

**Interfaces:**
- Consumes: `listMembers` (now member-accessible, Task 2), `renderReportInto` (`./report.js`, unchanged), `fileToBase64` (`../ui.js`, Task 4).

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `public/views/member.js` with:

```js
import { callFunction, logout } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml, fileToBase64 } from '../ui.js';
import { renderReportInto } from './report.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비'];
let currentTab = 'expenses';
let renderToken = 0;

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) {
    location.href = `/t/${slug}`;
    return;
  }
  render(root, slug);
}

function render(root, slug) {
  const myToken = ++renderToken;
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>내 여행</h2>
        <button type="button" class="btn btn-secondary" id="member-logout">로그아웃</button>
      </div>
      <div class="tabs">
        <button type="button" class="tab ${currentTab === 'expenses' ? 'active' : ''}" data-tab="expenses">경비목록</button>
        <button type="button" class="tab ${currentTab === 'members' ? 'active' : ''}" data-tab="members">구성원</button>
        <button type="button" class="tab ${currentTab === 'report' ? 'active' : ''}" data-tab="report">리포트</button>
      </div>
      <div id="member-tab-body"></div>
    </div>`;

  document.getElementById('member-logout').addEventListener('click', logout);

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      render(root, slug);
    });
  });

  const body = root.querySelector('#member-tab-body');
  body.innerHTML = '<p class="muted">불러오는 중...</p>';
  if (currentTab === 'members') renderMembersTab(body, slug, myToken);
  else if (currentTab === 'report') renderReportInto(body, slug);
  else renderExpensesTab(body, slug, myToken);
}

async function renderExpensesTab(body, slug, myToken) {
  body.innerHTML = `
    <div style="margin-bottom:1rem"><button type="button" class="btn btn-primary" id="member-add-expense">경비 입력</button></div>
    <div id="member-expenses-list"></div>`;
  document.getElementById('member-add-expense').addEventListener('click', () => openExpenseModal(body, slug));
  await loadExpenses(body, slug, myToken);
}

async function loadExpenses(body, slug, myToken) {
  const session = getSession();
  let expenses, members;
  try {
    [expenses, members] = await Promise.all([
      callFunction('listExpenses', { tripId: session.tripId }),
      callFunction('listMembersForLogin', { slug }),
    ]);
  } catch (err) {
    if (myToken !== renderToken) return;
    body.querySelector('#member-expenses-list').innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="me-retry">다시 시도</button>`;
    body.querySelector('#me-retry').addEventListener('click', () => loadExpenses(body, slug, myToken));
    return;
  }
  if (myToken !== renderToken) return;
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  body.querySelector('#member-expenses-list').innerHTML = expenses.map((e) => {
    const isMine = e.enteredBy === session.memberId;
    const canEdit = isMine && !e.confirmed;
    return `
      <div class="card${e.photoPath ? ' expense-card-receipt' : ''}" data-id="${e.id}" style="margin-bottom:0.6rem;${e.confirmed ? 'opacity:0.7;' : ''}${e.photoPath ? 'cursor:pointer' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
          <div style="min-width:0">
            <span class="tag">${e.category}</span>
            <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
            <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(e.date)} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
            ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">🔒 확정됨</span>' : ''}
            ${e.photoPath ? '<span class="muted" style="font-size:11px;margin-left:0.4rem">📷</span>' : ''}
          </div>
          ${canEdit ? `
          <div class="card-actions">
            <button type="button" class="btn btn-secondary member-edit" data-id="${e.id}">수정</button>
            <button type="button" class="btn btn-secondary member-delete" data-id="${e.id}">삭제</button>
          </div>` : ''}
        </div>
        <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}</p>
        ${e.excludedMembers && e.excludedMembers.length ? `<p class="muted" style="font-size:12px">제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</p>` : ''}
      </div>`;
  }).join('');

  body.querySelectorAll('.member-delete').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      btn.disabled = true;
      try {
        await callFunction('deleteExpense', { tripId: session.tripId, expenseId: btn.dataset.id });
        await loadExpenses(body, slug, myToken);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });

  body.querySelectorAll('.member-edit').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const exp = expenses.find((x) => x.id === btn.dataset.id);
      openMemberExpenseEditModal(body, slug, exp);
    });
  });

  body.querySelectorAll('.expense-card-receipt').forEach((card) => {
    card.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: card.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증 사진">`);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderMembersTab(body, slug, myToken) {
  const session = getSession();
  let members;
  try {
    members = await callFunction('listMembers', { tripId: session.tripId });
  } catch (err) {
    if (myToken !== renderToken) return;
    body.innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p><button type="button" class="btn btn-secondary" id="tab-retry">다시 시도</button>`;
    body.querySelector('#tab-retry').addEventListener('click', () => renderMembersTab(body, slug, myToken));
    return;
  }
  if (myToken !== renderToken) return;

  body.innerHTML = members.map((m) => `
    <div class="card" style="margin-bottom:0.6rem">
      <strong>${escapeHtml(m.name)}</strong>
      <span class="muted" style="font-size:12px;margin-left:0.5rem">가중치 ${m.weight}${m.account ? ' · 계좌 ' + escapeHtml(m.account) : ''}</span>
    </div>`).join('');
}

function openExpenseModal(body, slug) {
  let category = CATEGORIES[1];
  let photoPath = null;
  let classifyPromise = null;
  let skipped = false;

  openModal('경비 입력', `
    <div class="field"><label class="label">사진</label><input type="file" accept="image/*" id="me-photo"></div>
    <div id="me-photo-preview"></div>
    <div class="field"><label class="label">카테고리</label><div id="me-category"></div></div>
    <div class="field"><label class="label">날짜</label><input type="date" class="input" id="me-date"></div>
    <div class="field"><label class="label">금액</label><input type="number" class="input" id="me-amount"></div>
    <div class="field"><label class="label">상호명</label><input class="input" id="me-merchant"></div>
    <div class="field"><label class="label">세부사항</label><input class="input" id="me-detail"></div>
    <button type="button" class="btn btn-primary btn-block" id="me-submit">입력 완료</button>
    <p class="muted" id="me-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  function rerenderCategoryChips() {
    renderChipGroup(document.getElementById('me-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderCategoryChips();
    });
  }
  rerenderCategoryChips();

  ['me-amount', 'me-merchant', 'me-detail'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('me-submit').click();
    });
  });

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

  document.getElementById('me-submit').addEventListener('click', async () => {
    const session = getSession();
    const btn = document.getElementById('me-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      if (classifyPromise) {
        btn.textContent = '사진 저장 중...';
        await classifyPromise;
        btn.textContent = '저장 중...';
      }
      await callFunction('addExpense', {
        tripId: session.tripId,
        category,
        date: document.getElementById('me-date').value,
        amount: Number(document.getElementById('me-amount').value),
        merchant: document.getElementById('me-merchant').value,
        detail: document.getElementById('me-detail').value,
        photoPath,
      });
      closeModal();
      await loadExpenses(body, slug, renderToken);
    } catch (err) {
      btn.disabled = false; btn.textContent = '입력 완료';
      document.getElementById('me-error').textContent = err.message;
    }
  });
}

function openMemberExpenseEditModal(body, slug, exp) {
  let category = exp.category;
  const session = getSession();

  openModal('경비 수정', `
    <div class="field"><label class="label">카테고리</label><div id="mee-category"></div></div>
    <div class="field"><label class="label">날짜</label><input type="date" class="input" id="mee-date" value="${escapeHtml(exp.date || '')}"></div>
    <div class="field"><label class="label">금액</label><input type="number" class="input" id="mee-amount" value="${Number(exp.amount) || ''}"></div>
    <div class="field"><label class="label">상호명</label><input class="input" id="mee-merchant" value="${escapeHtml(exp.merchant || '')}"></div>
    <div class="field"><label class="label">세부사항</label><input class="input" id="mee-detail" value="${escapeHtml(exp.detail || '')}"></div>
    <button type="button" class="btn btn-primary btn-block" id="mee-submit">저장</button>
    <p class="muted" id="mee-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  function rerenderChips() {
    renderChipGroup(document.getElementById('mee-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderChips();
    });
  }
  rerenderChips();

  ['mee-amount', 'mee-merchant', 'mee-detail'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mee-submit').click();
    });
  });

  document.getElementById('mee-submit').addEventListener('click', async () => {
    const btn = document.getElementById('mee-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      await callFunction('updateExpense', {
        tripId: session.tripId,
        expenseId: exp.id,
        patch: {
          category,
          date: document.getElementById('mee-date').value,
          amount: Number(document.getElementById('mee-amount').value),
          merchant: document.getElementById('mee-merchant').value,
          detail: document.getElementById('mee-detail').value,
        },
      });
      closeModal();
      await loadExpenses(body, slug, renderToken);
    } catch (err) {
      btn.disabled = false; btn.textContent = '저장';
      document.getElementById('mee-error').textContent = err.message;
    }
  });
}

export { mount };
```

- [ ] **Step 2: Run the frontend suite**

Run: `npm test`
Expected: PASS (49/49 — `member.js` has no unit-test harness; this confirms the rewrite didn't break `report.js`/`ui.js` imports).

- [ ] **Step 3: Commit**

```bash
git add public/views/member.js
git commit -m "feat(frontend): member tab bar (경비목록/구성원/리포트) replacing flat list + swap"
```

---

## Task 7: E2E + deploy (controller-run)

**Files:** none.

- [ ] Backend suite green (`cd functions && npm test`).
- [ ] Frontend suite green (`npm test`).
- [ ] Emulator E2E at `http://127.0.0.1:5000` (login as admin + as a member of the same trip):
  1. **#8 upload**: 리포트 탭 → 여행사진 → [사진 추가] → pick a photo → thumbnail appears in the grid. Do this as both admin and member.
  2. **#8 lightbox**: click a thumbnail → modal shows the image, index counter, ◀/▶ (disabled at the ends); click through with both the buttons and the ←/→ arrow keys.
  3. **#8 delete permission**: as the uploading member, open your own photo → [삭제] visible → delete → thumbnail gone. As a *different* member, open someone else's photo → no [삭제] button. As admin, [삭제] is visible on every photo.
  4. **#8 trip-complete exemption**: mark the trip 완료 (admin 여행정보 탭) → confirm 여행사진 업로드/삭제 still works while 경비/구성원 edits stay locked.
  5. **#9 tabs**: log in as a member → 경비목록/구성원/리포트 tab bar renders (matching the admin's tab-bar look); default tab is 경비목록.
  6. **#9 members read-only**: 구성원 탭 shows every member's name/가중치/계좌 with no 추가/수정 controls.
  7. **#9 regressions**: 경비목록 tab still supports 경비 입력 (with classify indicator/skip from Plan 7) and 수정/삭제 on your own unconfirmed expenses; switching to 리포트 and back to 경비목록 preserves correct data (no stale render from the race-guard).
  8. Confirm the old 영수증 갤러리 section is gone from the report and that per-expense receipt-click (전체 지출 내역 rows, admin/member cards) from Plan 6 still works unaffected.
- [ ] Stop emulator; ports free; no orphaned node/java.
- [ ] Merge to `main` (fast-forward if possible); push.
- [ ] Deploy backend: `firebase deploy --only functions` (owner-run if the controller lacks credentials — there ARE backend changes this plan, including a removed callable). Frontend auto-deploys via Vercel from `main`.
- [ ] Production smoke at https://tripsplit-opal.vercel.app: upload + view + delete a trip photo; member tab bar renders and 구성원 tab shows the roster.

---

## Plan-Level Verification

```bash
cd functions && npm test    # backend, all green
cd .. && npm test           # frontend, all green
```

Plus Task 7 emulator E2E and production smoke.

## Self-Review Notes (coverage)
- #8 → Task 1 (backend: upload/list/delete + storage helper), Task 3 (remove the superseded `listReceiptUrls`), Task 4 (`openModal` keydown hook for arrow-key nav), Task 5 (gallery + lightbox UI).
- #9 → Task 2 (`listMembers` role relaxation), Task 6 (member tab bar + read-only 구성원 tab).
- Type consistency: `addTripPhoto` returns `{id, photoPath}` (Task 1) — the frontend never uses `photoPath` directly, only refetches via `listTripPhotos`. `listTripPhotos` returns `{photos: [{id, url, uploadedBy, createdAt}]}` (Task 1), consumed as `tripPhotosCache` in `report.js` (Task 5) — field names match exactly (`id`, `url`, `uploadedBy`). `deleteTripPhoto({tripId, photoId})` (Task 1) called with `photoId: tripPhotosCache[index].id` (Task 5) — matches. `openModal(titleHTML, bodyHTML, {onKeydown})` (Task 4) called identically in Task 5's `openTripPhoto`.
- `fileToBase64` moved to `ui.js` in Task 4 before Task 5/6 need it — no forward reference.
- Trip-photo exemption from `requireTripEditable`: verified by an explicit test in Task 1 Step 6 (`succeeds even when the trip is completed`) for both `addTripPhoto` and `deleteTripPhoto`.

## What This Plan Does Not Cover
- Any further plans beyond the original 11-item owner request — Plans 6/7/8 are the full set.
