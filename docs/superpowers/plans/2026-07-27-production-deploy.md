# Production Deploy + Pre-Deploy Fixes Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 8 is a controller-run runbook with owner checkpoints — do NOT dispatch it to a subagent.**

**Goal:** Fix the receipt-photo data model before real data exists, move the stack to the Seoul region, then deploy the backend to Firebase project `sfayw-10d11` and the frontend to Vercel, verified by a golden-path smoke test on the real URL.

**Architecture:** Backend stays Firebase Cloud Functions v2 (callable protocol) + Firestore + Storage; expense docs now store a permanent `photoPath` and signed URLs are minted per-view by a new `getReceiptUrl` callable. Frontend stays the no-build vanilla SPA in `public/`, deployed to Vercel as static files with an SPA rewrite.

**Tech Stack:** firebase-functions v2, firebase-admin, bcryptjs, Jest (backend); vanilla ES modules + node:test (frontend); firebase-tools@14 CLI, Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-07-27-production-deploy-design.md`

## Global Constraints

- Region is `asia-northeast3` everywhere a region appears (functions global options, `api.js` REGION) — after Task 5, the string `us-central1` must not exist in the codebase.
- Expense documents store `photoPath` (storage object path) — the string `photoUrl` must not survive anywhere (backend, frontend, tests) after Task 6.
- Signed URLs are minted only at read time, TTL exactly 15 minutes (`15 * 60 * 1000`).
- `classifyReceipt` throws on upload failure or invalid payload, but returns `{ photoPath, classified: false }` on Gemini classification failure — it must never discard a successfully uploaded photo.
- Session docs gain a Firestore `Timestamp` field `ttlAt` equal to the `expiresAt` epoch-ms instant; `expiresAt` (number) remains the API contract and is unchanged.
- Production project id is `sfayw-10d11`; the emulator project stays `demo-sfayw` and the local emulator workflow must keep working unchanged.
- No framework, no bundler, no build step on the frontend; category list stays exactly `['숙박', '식비', '장보기', '교통비']`.
- Backend tests: Jest via `cd functions && npm test`. Frontend tests: `npm test` at repo root (node:test). Both suites must be green at every commit.
- Secret VALUES (superadmin password, Gemini key) are entered only by the owner, never by Claude, never committed, never echoed into chat.

## File Structure

```
functions/src/lib/storage.js          # MODIFY Task 1 — path-based upload + read-URL minting
functions/test/lib/storage.test.js    # MODIFY Task 1
functions/src/functions/receipts.js   # MODIFY Task 2 — classifyReceipt contract + getReceiptUrl
functions/test/functions/receipts.test.js  # MODIFY Task 2
functions/src/functions/expenses.js   # MODIFY Task 3 — photoPath rename + delete cleanup
functions/test/functions/expenses.test.js  # MODIFY Task 3
functions/test/helpers/fakeBucket.js  # MODIFY Task 3 — delete() support
functions/src/lib/sessions.js         # MODIFY Task 4 — ttlAt Timestamp
functions/test/lib/sessions.test.js   # MODIFY Task 4
functions/index.js                    # MODIFY Tasks 2,3 (wiring) + Task 5 (region/bucket)
public/api.js                         # MODIFY Task 5 — region + prod project id
public/test/api.test.js               # MODIFY Task 5 — region assertion
.firebaserc                           # MODIFY Task 5 — prod alias
vercel.json                           # CREATE Task 5
functions/scripts/hash-password.js    # CREATE Task 5 — owner-run bcrypt hash helper
public/views/member.js                # MODIFY Task 6 — photoPath + classified flag
public/views/admin.js                 # MODIFY Task 6 — photoPath + 영수증 보기
```

---

### Task 1: Path-based storage API (`storage.js`)

**Files:**
- Modify: `functions/src/lib/storage.js`
- Test: `functions/test/lib/storage.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `uploadReceiptImage(bucket, tripId, base64, mimeType) -> Promise<string>` now resolving to the object PATH (`receipts/<tripId>/<32hex>.<jpg|png>`); new `getReceiptReadUrl(bucket, path) -> Promise<string>` minting a signed URL with `READ_URL_TTL_MS = 15 * 60 * 1000`; exports `{ uploadReceiptImage, getReceiptReadUrl, base64ToBuffer, READ_URL_TTL_MS }` (the old `SIGNED_URL_TTL_MS` export is deleted).

- [ ] **Step 1: Rewrite the test file to describe the new contract**

Replace the whole `functions/test/lib/storage.test.js` with:

```js
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { uploadReceiptImage, getReceiptReadUrl, READ_URL_TTL_MS } = require('../../src/lib/storage');

describe('uploadReceiptImage', () => {
  test('saves the image under the trip and returns the object path', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadReceiptImage(bucket, 'trip1', Buffer.from('fake-image').toString('base64'), 'image/jpeg');

    expect(path).toMatch(/^receipts\/trip1\/[0-9a-f]{32}\.jpg$/);
    expect(bucket.saved).toHaveLength(1);
    expect(bucket.saved[0].path).toBe(path);
    expect(bucket.saved[0].opts.metadata.contentType).toBe('image/jpeg');
  });

  test('does not make the uploaded object public', async () => {
    const bucket = makeFakeBucket();
    await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/jpeg');

    expect(bucket.saved[0].opts).not.toHaveProperty('public');
    expect(Object.keys(bucket.saved[0].opts)).toEqual(['metadata']);
  });

  test('uses a .png extension for png images', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/png');
    expect(path).toMatch(/\.png$/);
  });

  test('uses a .jpg extension for jpeg images', async () => {
    const bucket = makeFakeBucket();
    const path = await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/jpeg');
    expect(path).toMatch(/\.jpg$/);
  });
});

describe('getReceiptReadUrl', () => {
  test('mints a signed URL for the given path with a 15-minute expiry', async () => {
    const bucket = makeFakeBucket();
    const before = Date.now();
    const url = await getReceiptReadUrl(bucket, 'receipts/trip1/abc.jpg');

    expect(url).toMatch(/^https:\/\/storage\.fake\/receipts\/trip1\/abc\.jpg\?expires=/);
    const expires = Number(new URL(url).searchParams.get('expires'));
    expect(expires).toBeGreaterThanOrEqual(before + READ_URL_TTL_MS);
    expect(expires).toBeLessThanOrEqual(Date.now() + READ_URL_TTL_MS);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && npx jest test/lib/storage.test.js`
Expected: FAIL — `getReceiptReadUrl` is not a function; upload tests fail because a URL, not a path, is returned.

- [ ] **Step 3: Rewrite `functions/src/lib/storage.js`**

```js
const crypto = require('crypto');

const READ_URL_TTL_MS = 15 * 60 * 1000;

function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

/**
 * Uploads a receipt as a PRIVATE object and returns its storage PATH. The
 * object name is cryptographically random so receipts cannot be enumerated
 * by guessing timestamps. Signed URLs are minted at read time by
 * getReceiptReadUrl so stored references never expire.
 */
async function uploadReceiptImage(bucket, tripId, base64, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const filePath = `receipts/${tripId}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(base64ToBuffer(base64), { metadata: { contentType: mimeType } });
  return filePath;
}

async function getReceiptReadUrl(bucket, path) {
  const [url] = await bucket.file(path).getSignedUrl({ action: 'read', expires: Date.now() + READ_URL_TTL_MS });
  return url;
}

module.exports = { uploadReceiptImage, getReceiptReadUrl, base64ToBuffer, READ_URL_TTL_MS };
```

- [ ] **Step 4: Run the storage tests — expect PASS; then the full backend suite**

Run: `cd functions && npx jest test/lib/storage.test.js` → PASS.
Run: `cd functions && npm test` → EXPECTED FAILURES in `test/functions/receipts.test.js` only (it still asserts the old URL-returning contract). That is Task 2's job. Every other suite must pass. If anything else fails, fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/storage.js functions/test/lib/storage.test.js
git commit -m "feat(functions): store receipt paths, mint signed URLs at read time"
```

(Committing with receipts.test.js temporarily red is acceptable ONLY because Task 2 lands next in the same session; the two tasks may also be reviewed together if the reviewer prefers.)

---

### Task 2: `classifyReceipt` partial-failure contract + `getReceiptUrl` callable

**Files:**
- Modify: `functions/src/functions/receipts.js`
- Modify: `functions/index.js` (wiring only)
- Test: `functions/test/functions/receipts.test.js`

**Interfaces:**
- Consumes: `uploadReceiptImage` / `getReceiptReadUrl` from Task 1; existing `requireSession(db, token, roles, tripId)`, `checkRateLimit`, `classifyReceiptImage(base64, mimeType, apiKey)`.
- Produces: `classifyReceipt(db, bucket, apiKey, data)` returning `{ photoPath, classified: true, category, date, amount, merchant, detail }` on success or `{ photoPath, classified: false }` when Gemini classification throws (upload/validation errors still throw). New `getReceiptUrl(db, bucket, data)` with `data = { sessionToken, tripId, expenseId }` returning `{ url }`; errors `EXPENSE_NOT_FOUND`, `NO_PHOTO`. Exported as `{ classifyReceipt, getReceiptUrl, ALLOWED_MIME_TYPES }`.

- [ ] **Step 1: Update `functions/test/functions/receipts.test.js`**

Open the existing file. Keep its existing setup helpers (fake db/session seeding — follow the file's current pattern for creating a session doc and trip). Make these changes:

1. Everywhere a test asserts the success return, change from expecting `photoUrl` (a URL) to expecting `photoPath` matching `/^receipts\/trip1\/[0-9a-f]{32}\.(jpg|png)$/` and `classified: true` plus the classification fields.
2. Replace any test asserting "throws when Gemini fails" with:

```js
test('returns photoPath with classified:false when Gemini classification fails', async () => {
  const { db, bucket, sessionToken } = await seed(); // use the file's existing seeding helper names
  const failingApiKey = 'k';
  // Follow the file's existing mechanism for making the Gemini call fail
  // (it stubs fetch or the gemini client); make classifyReceiptImage reject.
  const result = await classifyReceipt(db, bucket, failingApiKey, {
    sessionToken, tripId: 'trip1', photoBase64: Buffer.from('x').toString('base64'), mimeType: 'image/jpeg',
  });
  expect(result.classified).toBe(false);
  expect(result.photoPath).toMatch(/^receipts\/trip1\/[0-9a-f]{32}\.jpg$/);
  expect(bucket.saved).toHaveLength(1); // the upload was kept
});
```

3. Keep (or add) tests that invalid payloads still throw BEFORE any upload: `MISSING_FIELDS` when photoBase64/mimeType absent, `INVALID_MIME_TYPE` for e.g. `image/gif`, and assert `bucket.saved` stays empty in those cases.
4. Add a `getReceiptUrl` describe block:

```js
describe('getReceiptUrl', () => {
  test('returns a signed URL for an expense with a photo', async () => {
    const { db, bucket, sessionToken } = await seed();
    await db.collection('trips').doc('trip1').collection('expenses').doc('e1')
      .set({ photoPath: 'receipts/trip1/abc.jpg' });
    const { url } = await getReceiptUrl(db, bucket, { sessionToken, tripId: 'trip1', expenseId: 'e1' });
    expect(url).toMatch(/^https:\/\/storage\.fake\/receipts\/trip1\/abc\.jpg\?expires=/);
  });

  test('rejects EXPENSE_NOT_FOUND for a missing expense', async () => {
    const { db, bucket, sessionToken } = await seed();
    await expect(getReceiptUrl(db, bucket, { sessionToken, tripId: 'trip1', expenseId: 'nope' }))
      .rejects.toThrow('EXPENSE_NOT_FOUND');
  });

  test('rejects NO_PHOTO when the expense has no photoPath', async () => {
    const { db, bucket, sessionToken } = await seed();
    await db.collection('trips').doc('trip1').collection('expenses').doc('e2')
      .set({ photoPath: null });
    await expect(getReceiptUrl(db, bucket, { sessionToken, tripId: 'trip1', expenseId: 'e2' }))
      .rejects.toThrow('NO_PHOTO');
  });

  test('rejects UNAUTHENTICATED without a valid session', async () => {
    const { db, bucket } = await seed();
    await expect(getReceiptUrl(db, bucket, { sessionToken: 'bogus', tripId: 'trip1', expenseId: 'e1' }))
      .rejects.toThrow('UNAUTHENTICATED');
  });

  test('rejects a session scoped to a different trip', async () => {
    const { db, bucket, sessionToken } = await seed(); // session belongs to trip1
    await db.collection('trips').doc('trip2').collection('expenses').doc('e9')
      .set({ photoPath: 'receipts/trip2/zzz.jpg' });
    await expect(getReceiptUrl(db, bucket, { sessionToken, tripId: 'trip2', expenseId: 'e9' }))
      .rejects.toThrow(); // requireSession(expectedTripId) rejects — match the error name used by the file's existing wrong-trip tests (PERMISSION_DENIED or FORBIDDEN)
  });
});
```

(Import `getReceiptUrl` alongside `classifyReceipt` at the top. If the file's seeding helper is named differently, adapt the calls — the behaviors asserted must stay exactly these.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd functions && npx jest test/functions/receipts.test.js`
Expected: FAIL — `getReceiptUrl` undefined; classified-flag test fails because classifyReceipt still throws through Gemini failures.

- [ ] **Step 3: Rewrite `functions/src/functions/receipts.js`**

```js
const { requireSession } = require('../lib/sessions');
const { checkRateLimit } = require('../lib/rateLimit');
const { uploadReceiptImage, getReceiptReadUrl } = require('../lib/storage');
const { classifyReceiptImage } = require('../lib/geminiClient');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

async function classifyReceipt(db, bucket, apiKey, data) {
  const {
    sessionToken, tripId, photoBase64, mimeType,
  } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  // Validate the payload before the rate-limit slot is spent and, more
  // importantly, before the Storage upload and the billable Gemini call.
  if (!photoBase64 || !mimeType) throw new Error('MISSING_FIELDS');
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error('INVALID_MIME_TYPE');

  await checkRateLimit(db, sessionToken, 'classifyReceipt', 5, 60000);

  const photoPath = await uploadReceiptImage(bucket, tripId, photoBase64, mimeType);

  // A classification failure must not discard the uploaded photo: the
  // frontend falls back to manual entry but keeps the receipt attached.
  try {
    const classification = await classifyReceiptImage(photoBase64, mimeType, apiKey);
    return { photoPath, classified: true, ...classification };
  } catch (err) {
    return { photoPath, classified: false };
  }
}

async function getReceiptUrl(db, bucket, data) {
  const { sessionToken, tripId, expenseId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const snap = await db.collection('trips').doc(tripId).collection('expenses').doc(expenseId).get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');
  const { photoPath } = snap.data();
  if (!photoPath) throw new Error('NO_PHOTO');

  const url = await getReceiptReadUrl(bucket, photoPath);
  return { url };
}

module.exports = { classifyReceipt, getReceiptUrl, ALLOWED_MIME_TYPES };
```

- [ ] **Step 4: Wire `getReceiptUrl` in `functions/index.js`**

Add a bucket-passing wrapper next to the existing `wrap()` helper, and register the callable with the other expense exports:

```js
function wrapWithBucket(handler) {
  return async (request) => {
    try {
      return await handler(db, bucket, request.data);
    } catch (err) {
      throw toHttpsError(err);
    }
  };
}
```

```js
exports.getReceiptUrl = onCall(wrapWithBucket(receipts.getReceiptUrl));
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd functions && npm test`
Expected: ALL suites pass (Task 1's temporary receipts failures are now resolved).

- [ ] **Step 6: Commit**

```bash
git add functions/src/functions/receipts.js functions/test/functions/receipts.test.js functions/index.js
git commit -m "feat(functions): keep photo on classify failure, add getReceiptUrl callable"
```

---

### Task 3: `photoPath` rename in expenses + storage cleanup on delete

**Files:**
- Modify: `functions/src/functions/expenses.js`
- Modify: `functions/index.js` (deleteExpense wiring)
- Modify: `functions/test/helpers/fakeBucket.js`
- Test: `functions/test/functions/expenses.test.js`

**Interfaces:**
- Consumes: `wrapWithBucket` from Task 2's index.js change.
- Produces: expense docs field `photoPath` (was `photoUrl`) in `addExpense`/`updateExpense`; `deleteExpense(db, bucket, data)` (bucket param added) which best-effort deletes the storage object; `fakeBucket` gains per-file `delete()` recording into `bucket.deleted` and a `bucket.failNextDelete` flag.

- [ ] **Step 1: Extend the fake bucket**

Replace `functions/test/helpers/fakeBucket.js` with:

```js
function makeFakeBucket() {
  const saved = [];
  const deleted = [];
  const bucket = {
    saved,
    deleted,
    failNextDelete: false,
    file(path) {
      return {
        async save(buffer, opts) {
          saved.push({ path, buffer, opts });
        },
        async getSignedUrl(options) {
          return [`https://storage.fake/${path}?expires=${options.expires}`];
        },
        async delete() {
          if (bucket.failNextDelete) {
            bucket.failNextDelete = false;
            throw new Error('storage unavailable');
          }
          deleted.push(path);
        },
        publicUrl() {
          return `https://storage.fake/${path}`;
        },
      };
    },
  };
  return bucket;
}

module.exports = { makeFakeBucket };
```

- [ ] **Step 2: Update `functions/test/functions/expenses.test.js`**

1. Global rename in this file: `photoUrl` → `photoPath` (field names in seeded docs, payloads, and assertions).
2. `deleteExpense` is now called as `deleteExpense(db, bucket, data)` — update every call site in the file; create the bucket with `makeFakeBucket()` (import it like receipts.test.js does).
3. Add these tests to the deleteExpense describe block:

```js
test('deletes the storage object when the expense has a photoPath', async () => {
  const { db, bucket, adminToken } = await seed();
  await db.collection('trips').doc('trip1').collection('expenses').doc('e1')
    .set({ enteredBy: 'm1', confirmed: false, photoPath: 'receipts/trip1/abc.jpg' });
  await deleteExpense(db, bucket, { sessionToken: adminToken, tripId: 'trip1', expenseId: 'e1' });
  expect(bucket.deleted).toEqual(['receipts/trip1/abc.jpg']);
});

test('still deletes the expense when the storage delete fails', async () => {
  const { db, bucket, adminToken } = await seed();
  await db.collection('trips').doc('trip1').collection('expenses').doc('e1')
    .set({ enteredBy: 'm1', confirmed: false, photoPath: 'receipts/trip1/abc.jpg' });
  bucket.failNextDelete = true;
  await deleteExpense(db, bucket, { sessionToken: adminToken, tripId: 'trip1', expenseId: 'e1' });
  const snap = await db.collection('trips').doc('trip1').collection('expenses').doc('e1').get();
  expect(snap.exists).toBe(false);
});

test('does not touch storage when the expense has no photoPath', async () => {
  const { db, bucket, adminToken } = await seed();
  await db.collection('trips').doc('trip1').collection('expenses').doc('e1')
    .set({ enteredBy: 'm1', confirmed: false, photoPath: null });
  await deleteExpense(db, bucket, { sessionToken: adminToken, tripId: 'trip1', expenseId: 'e1' });
  expect(bucket.deleted).toEqual([]);
});
```

(Adapt the seeding helper call to the file's existing pattern; the seeded expense shape must include whatever fields the file's other tests already seed.)

- [ ] **Step 3: Run to verify failures**

Run: `cd functions && npx jest test/functions/expenses.test.js`
Expected: FAIL — signature mismatch and photoPath assertions.

- [ ] **Step 4: Update `functions/src/functions/expenses.js`**

1. In `addExpense`: destructure `photoPath` instead of `photoUrl` (line 12) and write `photoPath: photoPath || null` (line 37).
2. In `updateExpense`: `if ('photoPath' in patch) update.photoPath = patch.photoPath;` (line 74).
3. Replace `deleteExpense` with:

```js
async function deleteExpense(db, bucket, data) {
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

  // Best-effort: a storage failure must never block the expense delete.
  if (expense.photoPath) {
    await bucket.file(expense.photoPath).delete().catch(() => {});
  }

  await ref.delete();
  return { ok: true };
}
```

4. In `functions/index.js`, change the deleteExpense export to use the bucket wrapper from Task 2:

```js
exports.deleteExpense = onCall(wrapWithBucket(expenses.deleteExpense));
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd functions && npm test`
Expected: ALL pass. Also run `grep -rn "photoUrl" functions/src functions/test` — expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add functions/src/functions/expenses.js functions/test/functions/expenses.test.js functions/test/helpers/fakeBucket.js functions/index.js
git commit -m "feat(functions): rename photoUrl to photoPath, delete photo with expense"
```

---

### Task 4: Session `ttlAt` Timestamp

**Files:**
- Modify: `functions/src/lib/sessions.js`
- Test: `functions/test/lib/sessions.test.js`

**Interfaces:**
- Consumes: `Timestamp` from `firebase-admin/firestore` (instantiable in Jest without app init).
- Produces: session docs written by `createSession` carry `ttlAt` (Firestore `Timestamp`, same instant as `expiresAt`). The `createSession` RETURN VALUE is unchanged (`{ token, expiresAt, role, tripId, memberId }`).

- [ ] **Step 1: Add the failing test**

In `functions/test/lib/sessions.test.js`, add inside the createSession describe block (follow the file's existing style for reading the stored doc back out of the fake db):

```js
test('stores a ttlAt Timestamp matching expiresAt for the Firestore TTL policy', async () => {
  const db = makeFakeFirestore(); // match the file's existing constructor name
  const { token, expiresAt } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
  const stored = (await db.collection('sessions').doc(token).get()).data();
  expect(stored.ttlAt.toMillis()).toBe(expiresAt);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npx jest test/lib/sessions.test.js`
Expected: FAIL — `stored.ttlAt` undefined.

- [ ] **Step 3: Implement**

In `functions/src/lib/sessions.js`: add at the top

```js
const { Timestamp } = require('firebase-admin/firestore');
```

and change the `createSession` write to:

```js
await db.collection('sessions').doc(token).set({
  role, tripId, memberId, expiresAt, ttlAt: Timestamp.fromMillis(expiresAt),
});
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd functions && npm test`
Expected: ALL pass (other suites reading session docs ignore the extra field; if any asserts exact doc equality, extend that assertion to include `ttlAt`).

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/sessions.js functions/test/lib/sessions.test.js
git commit -m "feat(functions): add ttlAt Timestamp to sessions for Firestore TTL"
```

---

### Task 5: Seoul region + production configuration + Vercel/hash tooling

**Files:**
- Modify: `functions/index.js`
- Modify: `public/api.js`
- Modify: `public/test/api.test.js:103`
- Modify: `.firebaserc`
- Create: `vercel.json`
- Create: `functions/scripts/hash-password.js`

**Interfaces:**
- Produces: all callables served from `asia-northeast3`; frontend targets `https://asia-northeast3-sfayw-10d11.cloudfunctions.net` in production and `http://127.0.0.1:5001/demo-sfayw/asia-northeast3` locally; `firebase deploy -P prod` targets `sfayw-10d11`.

- [ ] **Step 1: Update the region assertion test first**

`public/test/api.test.js:103` — change the expected URL:

```js
assert.match(url, /^http:\/\/127\.0\.0\.1:5001\/demo-sfayw\/asia-northeast3\/listTrips$/);
```

Run: `npm test` (repo root). Expected: this test FAILS (still us-central1), everything else passes.

- [ ] **Step 2: Update `public/api.js`**

Replace lines 3-5 (`REGION`, NOTE comment, `PROD_PROJECT_ID`) with:

```js
const REGION = 'asia-northeast3';
const PROD_PROJECT_ID = 'sfayw-10d11';
```

Run: `npm test` → 38/38 PASS.

- [ ] **Step 3: Update `functions/index.js` region + bucket**

At the top, extend the v2 imports and set global options before any export:

```js
const { onCall } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

setGlobalOptions({ region: 'asia-northeast3' });
```

Replace the NOTE comment + `admin.initializeApp({ storageBucket: 'demo-sfayw.appspot.com' });` block with:

```js
// Under the emulator the demo project needs its bucket named explicitly; in
// production initializeApp() resolves the project's default bucket on its own.
if (process.env.FUNCTIONS_EMULATOR) {
  admin.initializeApp({ storageBucket: 'demo-sfayw.appspot.com' });
} else {
  admin.initializeApp();
}
```

Run: `cd functions && npm test` → ALL pass (tests never import index.js with a live app; if any do and break on double-init, guard with `admin.apps.length === 0`).

- [ ] **Step 4: `.firebaserc` prod alias**

```json
{
  "projects": {
    "default": "demo-sfayw",
    "prod": "sfayw-10d11"
  }
}
```

- [ ] **Step 5: Create `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": null,
  "outputDirectory": "public",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

(Vercel serves real files from `public/` first; the rewrite only catches non-file routes, which is exactly the SPA behavior firebase.json provides locally.)

- [ ] **Step 6: Create `functions/scripts/hash-password.js`**

Owner-run helper so the superadmin password itself never lands in shell history or chat — it reads from stdin:

```js
// Usage: node scripts/hash-password.js   (run from the functions/ directory)
// Type the password, press Enter. Prints the bcrypt hash to paste into
// `firebase functions:secrets:set SUPERADMIN_PASSWORD_HASH`.
const readline = require('readline');
const bcrypt = require('bcryptjs');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Password: ', async (password) => {
  rl.close();
  if (!password) {
    console.error('Empty password — nothing hashed.');
    process.exit(1);
  }
  console.log(await bcrypt.hash(password, 10));
});
```

Verify: `cd functions && echo test1234 | node scripts/hash-password.js` prints a `$2...` hash.

- [ ] **Step 7: Run both suites, then commit**

Run: `npm test` (root) → 38/38. Run: `cd functions && npm test` → 202+ pass.

```bash
git add public/api.js public/test/api.test.js functions/index.js .firebaserc vercel.json functions/scripts/hash-password.js
git commit -m "feat: move to asia-northeast3, point prod at sfayw-10d11, add vercel config"
```

---

### Task 6: Frontend `photoPath` + 영수증 보기

**Files:**
- Modify: `public/views/member.js`
- Modify: `public/views/admin.js`

**Interfaces:**
- Consumes: `classifyReceipt` new return `{ photoPath, classified, ...fields }` (Task 2); `getReceiptUrl` → `{ url }` (Task 2); `addExpense` accepting `photoPath` (Task 3); existing `openModal(title, bodyHTML)`, `showToast`, `escapeHtml` from `ui.js`.
- Produces: no new exports. No dedicated test files (views are verified by the emulator E2E in Task 7, same convention as Plan 2).

- [ ] **Step 1: `public/views/member.js` — photo handler**

Line 76: `let photoUrl = null;` → `let photoPath = null;`

Replace the photo `change` handler's try/catch body (lines 105-116) with:

```js
    try {
      const session = getSession();
      const classification = await callFunction('classifyReceipt', { tripId: session.tripId, photoBase64, mimeType });
      photoPath = classification.photoPath;
      if (classification.classified === false) {
        showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
      } else {
        if (classification.category) { category = classification.category; rerenderCategoryChips(); }
        if (classification.date) document.getElementById('me-date').value = classification.date;
        if (classification.amount) document.getElementById('me-amount').value = classification.amount;
        if (classification.merchant) document.getElementById('me-merchant').value = classification.merchant;
        if (classification.detail) document.getElementById('me-detail').value = classification.detail;
      }
    } catch (err) {
      showToast('사진 업로드 실패 — 사진 없이 저장됩니다', 'error');
    }
```

In the submit payload (line 129): `photoUrl,` → `photoPath,`

- [ ] **Step 2: `public/views/admin.js` — photo handler + submit**

In `openAdminExpenseModal`, replace the `ae-photo` change-handler try/catch body (lines 246-257) with:

```js
    try {
      const session = getSession();
      const classification = await callFunction('classifyReceipt', { tripId: session.tripId, photoBase64, mimeType });
      document.getElementById('ae-photo').dataset.photoPath = classification.photoPath;
      if (classification.classified === false) {
        showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
      } else {
        if (classification.category) { category = classification.category; rerenderCategoryChips(); }
        if (classification.date) document.getElementById('ae-date').value = classification.date;
        if (classification.amount) document.getElementById('ae-amount').value = classification.amount;
        if (classification.merchant) document.getElementById('ae-merchant').value = classification.merchant;
        if (classification.detail) document.getElementById('ae-detail').value = classification.detail;
      }
    } catch (err) {
      showToast('사진 업로드 실패 — 사진 없이 저장됩니다', 'error');
    }
```

In the submit payload (line 271): `photoUrl: document.getElementById('ae-photo').dataset.photoUrl || null,` → `photoPath: document.getElementById('ae-photo').dataset.photoPath || null,`

- [ ] **Step 3: `public/views/admin.js` — 영수증 보기 button**

In `renderExpensesTab`'s expense-card template, add a receipt button in the button group (between the confirm and delete buttons, line 181-182):

```js
          ${e.photoPath ? `<button type="button" class="btn btn-secondary expense-receipt" data-id="${e.id}">영수증</button>` : ''}
```

After the `.expense-delete` listener block (line 207), add:

```js
  body.querySelectorAll('.expense-receipt').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: btn.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증 사진">`);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
```

- [ ] **Step 4: Verify no `photoUrl` remains, run the frontend suite**

Run: `grep -rn "photoUrl" public/` → no matches.
Run: `npm test` (root) → 38/38 PASS.

- [ ] **Step 5: Commit**

```bash
git add public/views/member.js public/views/admin.js
git commit -m "feat(frontend): photoPath contract, keep photo on classify failure, admin receipt viewer"
```

---

### Task 7: Emulator E2E re-verification (controller-run)

**Files:** none — verifies Tasks 1-6 against the full emulator suite in a real browser. Controller runs this directly (browser tooling), not a subagent.

- [ ] **Step 1:** Both suites green: `npm test` (root) and `cd functions && npm test`.
- [ ] **Step 2:** Start emulators (Java portable at `C:\Users\user\java-portable\jdk-17.0.19+10-jre\bin` on PATH):

```bash
export PATH="/c/Users/user/java-portable/jdk-17.0.19+10-jre/bin:$PATH"
npx -y firebase-tools@14 emulators:start --only functions,firestore,storage,hosting --project demo-sfayw
```

Wait for "All emulators ready!". `functions/.secret.local` (already on this machine) supplies dummy secrets.
- [ ] **Step 3:** Golden path at `http://127.0.0.1:5000` (same walkthrough as Plan 2 Task 13), with the new checks:
  1. Member expense entry with a photo → dummy Gemini key makes classification fail → toast appears **but the expense saves with the photo attached** (verify in the admin 경비확인 tab: the 영수증 button IS present on that expense).
  2. Admin clicks 영수증 → modal shows the actual image (signed URL served by the Storage emulator).
  3. Admin deletes an expense that has a photo → no error; expense disappears.
  4. Report still renders all sections.
- [ ] **Step 4:** Fix anything broken (normal fix-commit flow; re-test after each fix).
- [ ] **Step 5:** Stop the emulator; verify no orphaned node/java processes and ports 4000/5000/5001/8080/9199 are free.
- [ ] **Step 6:** Commit only if Step 4 produced fixes.

---

### Task 8: Production deploy runbook (controller-run, owner checkpoints)

**Files:** none created. Controller executes with the owner; owner-marked steps are theirs alone (billing, OAuth, secret values). Do not proceed past a failed step.

- [ ] **Step 1 (OWNER):** Firebase console (console.firebase.google.com) → project `sfayw-10d11` → upgrade to Blaze; set a budget alert (예: $1/월) at console.cloud.google.com → Billing → Budgets & alerts.
- [ ] **Step 2 (OWNER):** In the session terminal: `! npx firebase-tools@14 login` (browser OAuth completes the CLI login).
- [ ] **Step 3 (Claude):** Verify access + provisioning:

```bash
npx firebase-tools@14 projects:list            # sfayw-10d11 must appear
npx firebase-tools@14 firestore:databases:list -P prod   # default database must exist — if not, create via console (native mode, region asia-northeast3): hand to owner
npx firebase-tools@14 storage:buckets:list -P prod 2>/dev/null || echo "check bucket in console"
```

If the default Storage bucket does not exist, hand the single console click to the owner (Storage → 시작하기, region `asia-northeast3`). Record the resulting bucket name — expected `sfayw-10d11.firebasestorage.app`.
- [ ] **Step 4 (Claude):** Deploy rules: `npx firebase-tools@14 deploy --only firestore:rules,storage -P prod`
- [ ] **Step 5 (OWNER):** Secrets (values never enter chat):

```bash
! cd functions && node scripts/hash-password.js        # type the real superadmin password; copy the printed hash
! npx firebase-tools@14 functions:secrets:set SUPERADMIN_PASSWORD_HASH -P prod   # paste the HASH when prompted
! npx firebase-tools@14 functions:secrets:set GEMINI_API_KEY -P prod             # paste the real Gemini key
```

- [ ] **Step 6 (Claude):** Deploy functions: `npx firebase-tools@14 deploy --only functions -P prod` (first v2 deploy enables Cloud Build/Run/Artifact Registry APIs — can take several minutes; if an API-enablement error appears, run the printed enablement URL past the owner).
- [ ] **Step 7 (Claude):** signBlob for signed URLs — find the runtime service account (v2 default: `PROJECT_NUMBER-compute@developer.gserviceaccount.com`; get PROJECT_NUMBER via `npx firebase-tools@14 projects:list`). If `gcloud` is installed:

```bash
gcloud iam service-accounts add-iam-policy-binding PROJECT_NUMBER-compute@developer.gserviceaccount.com --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --project=sfayw-10d11
```

If not, hand the owner the console path: IAM 및 관리자 → 서비스 계정 → `...-compute@developer.gserviceaccount.com` → 권한 → 액세스 권한 부여 → principal = the same service account, role = `서비스 계정 토큰 생성자`.
- [ ] **Step 8 (Claude):** Firestore TTL policy on `sessions.ttlAt` — with gcloud: `gcloud firestore fields ttls update ttlAt --collection-group=sessions --enable-ttl --project=sfayw-10d11`; otherwise owner console path: Firestore → TTL(수명) → 정책 만들기 → 컬렉션 그룹 `sessions`, 필드 `ttlAt`.
- [ ] **Step 9 (OWNER + Claude):** Vercel — owner authorizes (`vercel login` in terminal with `!` prefix, or the session's Vercel integration if already authenticated); then Claude creates/links project `tripsplit` from the repo root and deploys to production (`vercel deploy --prod` or the vercel:deploy skill). Record the production URL.
- [ ] **Step 10 (Claude):** Production smoke test on the real URL (browser tooling): full golden path — superadmin login with the real password (owner enters it in the browser themselves if preferred; otherwise owner shares nothing — Claude uses a REAL browser session the owner logs into, or the owner performs the login click while Claude verifies the rest), create a real test trip, admin setup, member photo expense with a REAL receipt photo → verify Gemini actually classifies (fields autofill), admin 영수증 보기 shows the image, report renders. Then superadmin archives the test trip.
  - If classification fails: check the functions logs (`npx firebase-tools@14 functions:log -P prod`) — distinguish key issues (secret not set) from IAM issues (signBlob) before changing anything.
- [ ] **Step 11 (Claude):** Push main to GitHub (`git push origin main`) so the deployed commit is the pushed commit.

---

## Plan-Level Verification

```bash
npm test                    # 38+ frontend tests
cd functions && npm test    # 205+ backend tests
```

Plus: Task 7's emulator golden path, and Task 8 Step 10's production golden path with real Gemini classification — the plan's success criterion.

## What This Plan Does Not Cover (deferred)

- travel_report.html / RTDB `accounts`·`paid` migration → Plan 4.
- Korean error-message map, load-failure handling, submit states, modal a11y → Plan 5.
- Custom domain, IP-scoped throttling, image downscaling, `public/constants.js` dedup — ledger follow-up list.
