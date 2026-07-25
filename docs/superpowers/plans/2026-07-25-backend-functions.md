# Backend & Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entire Cloud Functions backend and Firestore data layer for the multi-trip sfaYW platform: session-token auth, trip/member/expense CRUD, Gemini-based receipt classification, and settlement/report aggregation — all independently testable without a live Firebase project.

**Architecture:** Firebase Cloud Functions (Node 20, JavaScript, Functions v2 `onCall`) backed by Firestore, with Firestore security rules denying all direct client access (`allow read, write: if false`). Every function is a thin `onCall` wrapper around a plain, framework-free handler function of the shape `async (db, ...args) => result`, so handlers can be unit-tested with an in-memory fake Firestore instead of the real emulator. A single session-token check (`requireSession`) is the security boundary for every write and every trip-scoped read.

**Tech Stack:** Node.js 20, `firebase-functions` v5 (v2 API), `firebase-admin` v12, `bcryptjs` for PIN/password hashing, Jest for tests, Gemini API (`generativelanguage.googleapis.com`) called via Node's built-in `fetch`.

## Global Constraints

- Firestore security rules must deny all direct client access: `allow read, write: if false;`. All reads/writes happen through Cloud Functions using the Admin SDK.
- No Firebase Auth. Authorization is a bearer session token stored in `sessions/{token}` and checked by `requireSession` on every call.
- PINs and the superadmin password are never stored or compared in plaintext — always hashed with `bcryptjs` (superadmin password hash lives in a Functions secret, not Firestore).
- The Gemini API key and the superadmin password hash are Firebase Functions secrets (`defineSecret`), never bundled into client code.
- Expense categories are a fixed list: `숙박`, `식비`, `장보기`, `교통비` (from `functions/src/lib/categories.js`). No dynamic/custom categories.
- Functions code is plain JavaScript (no TypeScript, no build step), matching the project's existing dependency-light style.
- A member may only edit an expense where `expense.enteredBy === session.memberId` and `expense.confirmed === false`. An admin may edit any expense in their trip regardless of confirmation state, but only `confirmExpense` can flip the `confirmed` flag.
- Every trip-scoped call must verify `session.tripId === data.tripId` (except for `superadmin`-role sessions), preventing a token issued for one trip from touching another trip's data.

---

## File Structure

```
functions/
  package.json
  index.js                          # Task 14 — wires all handlers to onCall
  firestore.rules                   # Task 1
  storage.rules                     # Task 1
  src/
    lib/
      hashing.js                    # Task 2
      sessions.js                   # Task 3
      rateLimit.js                  # Task 4
      settlement.js                 # Task 5
      categories.js                 # Task 6
      geminiClient.js                # Task 6
      storage.js                     # Task 12
    functions/
      superadmin.js                  # Task 7
      tripAuth.js                    # Task 8
      tripSetup.js                   # Task 9
      members.js                     # Task 10
      expenses.js                    # Task 11
      receipts.js                    # Task 12
      report.js                      # Task 13
  test/
    helpers/
      fakeFirestore.js               # Task 1
      fakeBucket.js                  # Task 12
    lib/
      hashing.test.js
      sessions.test.js
      rateLimit.test.js
      settlement.test.js
      geminiClient.test.js
      storage.test.js
    functions/
      superadmin.test.js
      tripAuth.test.js
      tripSetup.test.js
      members.test.js
      expenses.test.js
      receipts.test.js
      report.test.js
firebase.json                       # Task 1
.firebaserc                         # Task 1
```

---

### Task 1: Project scaffold, Firestore/Storage rules, fake Firestore test double

**Files:**
- Create: `functions/package.json`
- Create: `functions/jest.config.js`
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `firestore.rules`
- Create: `storage.rules`
- Create: `functions/test/helpers/fakeFirestore.js`
- Test: `functions/test/helpers/fakeFirestore.test.js`

**Interfaces:**
- Produces: `FakeFirestore` class (from `functions/test/helpers/fakeFirestore.js`) with `.collection(name)`, `.recursiveDelete(ref)`; collection refs support `.doc(id?)`, `.add(value)`, `.where(field, '==', value)`, `.get()`; doc refs support `.get()`, `.set(value)`, `.update(patch)`, `.delete()`, `.collection(name)` (nesting), `.id`, `.path`. This is the shared test double every later task's tests depend on.

- [ ] **Step 1: Create the Firebase project files**

`firebase.json`:

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs20"
    }
  ],
  "firestore": {
    "rules": "firestore.rules"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "functions": { "port": 5001 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true }
  }
}
```

`.firebaserc` (uses a `demo-` project id so the emulator suite runs with no real GCP project — real deployment adds an alias later):

```json
{
  "projects": {
    "default": "demo-sfayw"
  }
}
```

`firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

`storage.rules` (all receipt access happens through Cloud Functions using the Admin SDK, never through client-side Storage SDK calls, so this stays fully locked down):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

`functions/package.json`:

```json
{
  "name": "sfayw-functions",
  "version": "1.0.0",
  "private": true,
  "engines": { "node": "20" },
  "main": "index.js",
  "scripts": {
    "test": "jest"
  },
  "dependencies": {
    "firebase-admin": "^12.1.0",
    "firebase-functions": "^5.0.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

`functions/jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
};
```

- [ ] **Step 2: Write the fake Firestore test double**

`functions/test/helpers/fakeFirestore.js`:

```js
class FakeQuerySnapshot {
  constructor(docs) { this.docs = docs; }
  get empty() { return this.docs.length === 0; }
}

class FakeDocRef {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split('/').pop();
  }

  async get() {
    const data = this.store.data.get(this.path);
    return { exists: data !== undefined, id: this.id, data: () => data };
  }

  async set(value) {
    this.store.data.set(this.path, { ...value });
  }

  async update(patch) {
    const current = this.store.data.get(this.path) || {};
    this.store.data.set(this.path, { ...current, ...patch });
  }

  async delete() {
    this.store.data.delete(this.path);
  }

  collection(name) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(store, path, filters = []) {
    this.store = store;
    this.path = path;
    this._filters = filters;
  }

  doc(id) {
    const docId = id || `auto_${this.store.nextId++}`;
    return new FakeDocRef(this.store, `${this.path}/${docId}`);
  }

  async add(value) {
    const ref = this.doc();
    await ref.set(value);
    return ref;
  }

  where(field, op, value) {
    if (op !== '==') throw new Error(`FakeFirestore only supports '==', got '${op}'`);
    return new FakeCollectionRef(this.store, this.path, [...this._filters, { field, value }]);
  }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [];
    for (const [path, data] of this.store.data.entries()) {
      if (!path.startsWith(prefix)) continue;
      if (path.slice(prefix.length).includes('/')) continue; // direct children only
      if (this._filters.every((f) => data[f.field] === f.value)) {
        docs.push({ id: path.split('/').pop(), data: () => data });
      }
    }
    return new FakeQuerySnapshot(docs);
  }
}

class FakeFirestore {
  constructor() {
    this.data = new Map();
    this.nextId = 1;
  }

  collection(name) {
    return new FakeCollectionRef(this, name);
  }

  async recursiveDelete(ref) {
    const prefix = ref.path;
    for (const key of [...this.data.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) this.data.delete(key);
    }
  }
}

module.exports = { FakeFirestore };
```

- [ ] **Step 3: Write tests proving the fake behaves like Firestore for the operations we rely on**

`functions/test/helpers/fakeFirestore.test.js`:

```js
const { FakeFirestore } = require('./fakeFirestore');

describe('FakeFirestore', () => {
  test('set and get a document', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ name: 'Yeongwol' });
    const snap = await db.collection('trips').doc('t1').get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ name: 'Yeongwol' });
  });

  test('add() generates an id readable via the returned ref', async () => {
    const db = new FakeFirestore();
    const ref = await db.collection('trips').add({ name: 'Auto' });
    const snap = await ref.get();
    expect(snap.data()).toEqual({ name: 'Auto' });
  });

  test('subcollection documents do not leak into the parent collection query', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ name: 'Yeongwol' });
    await db.collection('trips').doc('t1').collection('members').doc('m1').set({ name: '슬기' });

    const tripDocs = await db.collection('trips').get();
    expect(tripDocs.docs).toHaveLength(1);

    const memberDocs = await db.collection('trips').doc('t1').collection('members').get();
    expect(memberDocs.docs).toHaveLength(1);
    expect(memberDocs.docs[0].data()).toEqual({ name: '슬기' });
  });

  test('where() filters by equality and chains', async () => {
    const db = new FakeFirestore();
    await db.collection('trips').doc('t1').set({ slug: 'a', status: 'active' });
    await db.collection('trips').doc('t2').set({ slug: 'b', status: 'completed' });
    await db.collection('trips').doc('t3').set({ slug: 'c', status: 'completed' });

    const result = await db.collection('trips').where('status', '==', 'completed').get();
    expect(result.docs.map((d) => d.id).sort()).toEqual(['t2', 't3']);
  });

  test('recursiveDelete removes a document and everything nested under it', async () => {
    const db = new FakeFirestore();
    const tripRef = db.collection('trips').doc('t1');
    await tripRef.set({ name: 'Yeongwol' });
    await tripRef.collection('members').doc('m1').set({ name: '슬기' });

    await db.recursiveDelete(tripRef);

    const snap = await tripRef.get();
    expect(snap.exists).toBe(false);
    const members = await tripRef.collection('members').get();
    expect(members.docs).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Install dependencies and run the tests**

Run: `cd functions && npm install && npm test`
Expected: all 5 tests in `fakeFirestore.test.js` PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/package.json functions/jest.config.js functions/test/helpers/fakeFirestore.js functions/test/helpers/fakeFirestore.test.js firebase.json .firebaserc firestore.rules storage.rules
git commit -m "feat(functions): scaffold Firebase project and fake Firestore test double"
```

---

### Task 2: PIN/password hashing

**Files:**
- Create: `functions/src/lib/hashing.js`
- Test: `functions/test/lib/hashing.test.js`

**Interfaces:**
- Produces: `hashSecret(plain: string) => Promise<string>`, `verifySecret(plain: string, hash: string) => Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```js
const { hashSecret, verifySecret } = require('../../src/lib/hashing');

describe('hashing', () => {
  test('a hashed secret verifies correctly', async () => {
    const hash = await hashSecret('1234');
    await expect(verifySecret('1234', hash)).resolves.toBe(true);
  });

  test('the wrong secret does not verify', async () => {
    const hash = await hashSecret('1234');
    await expect(verifySecret('9999', hash)).resolves.toBe(false);
  });

  test('the hash is not the plaintext value', async () => {
    const hash = await hashSecret('20112988sk!');
    expect(hash).not.toBe('20112988sk!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx jest test/lib/hashing.test.js`
Expected: FAIL — `Cannot find module '../../src/lib/hashing'`

- [ ] **Step 3: Write the implementation**

```js
const bcrypt = require('bcryptjs');

async function hashSecret(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifySecret(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashSecret, verifySecret };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx jest test/lib/hashing.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/hashing.js functions/test/lib/hashing.test.js
git commit -m "feat(functions): add PIN/password hashing helper"
```

---

### Task 3: Session tokens

**Files:**
- Create: `functions/src/lib/sessions.js`
- Test: `functions/test/lib/sessions.test.js`

**Interfaces:**
- Consumes: `FakeFirestore` (Task 1) in tests only.
- Produces: `generateToken() => string`, `createSession(db, {role, tripId?, memberId?}) => Promise<{token, expiresAt}>`, `requireSession(db, token, allowedRoles: string[], expectedTripId?: string) => Promise<session>` where `session = {role, tripId, memberId, expiresAt}`. Throws `Error('UNAUTHENTICATED')`, `Error('SESSION_EXPIRED')`, or `Error('FORBIDDEN')` on failure.

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession, requireSession } = require('../../src/lib/sessions');

describe('sessions', () => {
  test('a freshly created session is accepted by requireSession', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'trip1' });

    const session = await requireSession(db, token, ['admin']);
    expect(session.role).toBe('admin');
    expect(session.tripId).toBe('trip1');
  });

  test('an unknown token is rejected', async () => {
    const db = new FakeFirestore();
    await expect(requireSession(db, 'not-a-real-token', ['admin'])).rejects.toThrow('UNAUTHENTICATED');
  });

  test('an expired session is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'trip1' });
    await db.collection('sessions').doc(token).update({ expiresAt: Date.now() - 1000 });

    await expect(requireSession(db, token, ['admin'])).rejects.toThrow('SESSION_EXPIRED');
  });

  test('a role not in the allow-list is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 'trip1', memberId: 'm1' });
    await expect(requireSession(db, token, ['admin'])).rejects.toThrow('FORBIDDEN');
  });

  test('a session scoped to one trip cannot act on another trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 'trip1' });
    await expect(requireSession(db, token, ['admin'], 'trip2')).rejects.toThrow('FORBIDDEN');
  });

  test('a superadmin session is exempt from the trip-scope check', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    const session = await requireSession(db, token, ['superadmin'], 'trip2');
    expect(session.role).toBe('superadmin');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/lib/sessions.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
const crypto = require('crypto');

const SESSION_TTL_MS = {
  superadmin: 12 * 60 * 60 * 1000,
  admin: 30 * 24 * 60 * 60 * 1000,
  member: 30 * 24 * 60 * 60 * 1000,
};

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function createSession(db, { role, tripId = null, memberId = null }) {
  const token = generateToken();
  const expiresAt = Date.now() + SESSION_TTL_MS[role];
  await db.collection('sessions').doc(token).set({ role, tripId, memberId, expiresAt });
  return { token, expiresAt };
}

async function requireSession(db, token, allowedRoles, expectedTripId = null) {
  if (!token) throw new Error('UNAUTHENTICATED');

  const snap = await db.collection('sessions').doc(token).get();
  if (!snap.exists) throw new Error('UNAUTHENTICATED');

  const session = snap.data();
  if (session.expiresAt < Date.now()) throw new Error('SESSION_EXPIRED');
  if (!allowedRoles.includes(session.role)) throw new Error('FORBIDDEN');
  if (expectedTripId && session.role !== 'superadmin' && session.tripId !== expectedTripId) {
    throw new Error('FORBIDDEN');
  }

  return session;
}

module.exports = { generateToken, createSession, requireSession, SESSION_TTL_MS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/lib/sessions.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/sessions.js functions/test/lib/sessions.test.js
git commit -m "feat(functions): add session token creation and verification"
```

---

### Task 4: Rate limiting

**Files:**
- Create: `functions/src/lib/rateLimit.js`
- Test: `functions/test/lib/rateLimit.test.js`

**Interfaces:**
- Consumes: `FakeFirestore` (Task 1).
- Produces: `checkRateLimit(db, token, action: string, limit: number, windowMs: number) => Promise<void>`. Throws `Error('RATE_LIMITED')` when the limit is exceeded within the window; otherwise records the call and resolves.

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { checkRateLimit } = require('../../src/lib/rateLimit');

describe('checkRateLimit', () => {
  test('allows calls under the limit', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);
    await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);

    await expect(checkRateLimit(db, token, 'classifyReceipt', 5, 60000)).resolves.toBeUndefined();
  });

  test('rejects the call once the limit is hit within the window', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    for (let i = 0; i < 5; i += 1) {
      await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);
    }

    await expect(checkRateLimit(db, token, 'classifyReceipt', 5, 60000)).rejects.toThrow('RATE_LIMITED');
  });

  test('calls outside the window do not count', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const ref = db.collection('sessions').doc(token);
    const oldTimestamps = Array(5).fill(Date.now() - 120000);
    await ref.update({ rateLimit_classifyReceipt: oldTimestamps });

    await expect(checkRateLimit(db, token, 'classifyReceipt', 5, 60000)).resolves.toBeUndefined();
  });

  test('different actions have independent limits', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    for (let i = 0; i < 5; i += 1) {
      await checkRateLimit(db, token, 'classifyReceipt', 5, 60000);
    }

    await expect(checkRateLimit(db, token, 'addExpense', 5, 60000)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/lib/rateLimit.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
async function checkRateLimit(db, token, action, limit, windowMs) {
  const ref = db.collection('sessions').doc(token);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('UNAUTHENTICATED');

  const session = snap.data();
  const now = Date.now();
  const key = `rateLimit_${action}`;
  const recent = (session[key] || []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) throw new Error('RATE_LIMITED');

  recent.push(now);
  await ref.update({ [key]: recent });
}

module.exports = { checkRateLimit };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/lib/rateLimit.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/rateLimit.js functions/test/lib/rateLimit.test.js
git commit -m "feat(functions): add per-session rate limiting"
```

---

### Task 5: Settlement calculation

**Files:**
- Create: `functions/src/lib/settlement.js`
- Test: `functions/test/lib/settlement.test.js`

**Interfaces:**
- Produces: `computeSettlement(members, expenses) => {categoryTotals, totalConfirmed, perMember}` where `members = [{id, weight, excludedCategories}]`, `expenses = [{category, amount, enteredBy, confirmed}]`, and `perMember = [{id, name, due, paid, net}]`. Unconfirmed expenses are ignored entirely. This is pure logic with no Firestore dependency.

- [ ] **Step 1: Write the failing tests**

```js
const { computeSettlement } = require('../../src/lib/settlement');

describe('computeSettlement', () => {
  test('splits a category total evenly across members with weight 1', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(50000);
    expect(result.perMember.find((m) => m.id === 'b').due).toBe(50000);
  });

  test('a 0.5-weight member (e.g. a child) owes half as much', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'kid', name: "A's kid", weight: 0.5, excludedCategories: [] },
    ];
    const expenses = [{ category: '숙박', amount: 150000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(100000);
    expect(result.perMember.find((m) => m.id === 'kid').due).toBe(50000);
  });

  test('a member excluded from a category owes nothing for it', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: ['식비'] },
    ];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').due).toBe(100000);
    expect(result.perMember.find((m) => m.id === 'b').due).toBe(0);
  });

  test('unconfirmed expenses are excluded from every total', () => {
    const members = [{ id: 'a', name: 'A', weight: 1, excludedCategories: [] }];
    const expenses = [{ category: '식비', amount: 100000, enteredBy: 'a', confirmed: false }];

    const result = computeSettlement(members, expenses);
    expect(result.totalConfirmed).toBe(0);
    expect(result.perMember[0].due).toBe(0);
  });

  test('net is what was paid minus what was owed', () => {
    const members = [
      { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
      { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
    ];
    const expenses = [{ category: '교통비', amount: 100000, enteredBy: 'a', confirmed: true }];

    const result = computeSettlement(members, expenses);
    expect(result.perMember.find((m) => m.id === 'a').net).toBe(50000);
    expect(result.perMember.find((m) => m.id === 'b').net).toBe(-50000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/lib/settlement.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
function computeSettlement(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);

  const categoryTotals = {};
  for (const e of confirmed) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }

  const dueByMember = {};
  for (const m of members) dueByMember[m.id] = 0;

  for (const category of Object.keys(categoryTotals)) {
    const weightSum = members.reduce((sum, m) => {
      if (m.excludedCategories.includes(category)) return sum;
      return sum + m.weight;
    }, 0);
    if (weightSum <= 0) continue;

    const perWeightUnit = categoryTotals[category] / weightSum;
    for (const m of members) {
      if (m.excludedCategories.includes(category)) continue;
      dueByMember[m.id] += perWeightUnit * m.weight;
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
    due: Math.round(dueByMember[m.id] || 0),
    paid: Math.round(paidByMember[m.id] || 0),
    net: Math.round((paidByMember[m.id] || 0) - (dueByMember[m.id] || 0)),
  }));

  return { categoryTotals, totalConfirmed, perMember };
}

module.exports = { computeSettlement };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/lib/settlement.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/settlement.js functions/test/lib/settlement.test.js
git commit -m "feat(functions): add weighted settlement calculation"
```

---

### Task 6: Categories constant + Gemini receipt classification

**Files:**
- Create: `functions/src/lib/categories.js`
- Create: `functions/src/lib/geminiClient.js`
- Test: `functions/test/lib/geminiClient.test.js`

**Interfaces:**
- Produces: `CATEGORIES = ['숙박', '식비', '장보기', '교통비']` (from `categories.js`); `classifyReceiptImage(base64Image, mimeType, apiKey, fetchImpl = fetch) => Promise<{category, date, amount, merchant, detail}>` (from `geminiClient.js`). Any field Gemini fails to produce validly is coerced to `''` (strings) or `0` (amount) rather than throwing, except for HTTP failures and unparsable responses which throw.

- [ ] **Step 1: Write the categories constant**

```js
const CATEGORIES = ['숙박', '식비', '장보기', '교통비'];

module.exports = { CATEGORIES };
```

- [ ] **Step 2: Write the failing tests for geminiClient**

```js
const { classifyReceiptImage } = require('../../src/lib/geminiClient');

function fakeFetch(responseBody, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => responseBody,
  });
}

function geminiTextResponse(jsonText) {
  return { candidates: [{ content: { parts: [{ text: jsonText }] } }] };
}

describe('classifyReceiptImage', () => {
  test('parses a well-formed Gemini response', async () => {
    const body = geminiTextResponse(JSON.stringify({
      category: '식비', date: '2026-08-01', amount: 45000, merchant: '감자바우', detail: '옹심이칼국수 x18',
    }));
    const result = await classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body));

    expect(result).toEqual({
      category: '식비', date: '2026-08-01', amount: 45000, merchant: '감자바우', detail: '옹심이칼국수 x18',
    });
  });

  test('coerces an unrecognized category to an empty string', async () => {
    const body = geminiTextResponse(JSON.stringify({
      category: '기타', date: '2026-08-01', amount: 1000, merchant: 'x', detail: 'y',
    }));
    const result = await classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body));
    expect(result.category).toBe('');
  });

  test('throws on an HTTP error from Gemini', async () => {
    await expect(
      classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch({}, false, 500))
    ).rejects.toThrow('GEMINI_HTTP_500');
  });

  test('throws when Gemini returns text that is not valid JSON', async () => {
    const body = geminiTextResponse('this is not json');
    await expect(
      classifyReceiptImage('base64data', 'image/jpeg', 'key', fakeFetch(body))
    ).rejects.toThrow('GEMINI_PARSE_ERROR');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd functions && npx jest test/lib/geminiClient.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```js
const { CATEGORIES } = require('./categories');

const PROMPT = `이 영수증 이미지를 분석해서 아래 JSON 형식으로만 답해줘. 다른 설명은 절대 추가하지 마.
{"category": "숙박" | "식비" | "장보기" | "교통비" 중 하나, "date": "YYYY-MM-DD", "amount": 숫자(원 단위, 콤마 없이), "merchant": "상호명", "detail": "구매 품목 요약"}
영수증에서 확인할 수 없는 값은 빈 문자열이나 0으로 둬.`;

async function classifyReceiptImage(base64Image, mimeType, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: base64Image } },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    }
  );

  if (!res.ok) throw new Error(`GEMINI_HTTP_${res.status}`);

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('GEMINI_EMPTY_RESPONSE');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('GEMINI_PARSE_ERROR');
  }

  return {
    category: CATEGORIES.includes(parsed.category) ? parsed.category : '',
    date: typeof parsed.date === 'string' ? parsed.date : '',
    amount: Number.isFinite(parsed.amount) ? parsed.amount : 0,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant : '',
    detail: typeof parsed.detail === 'string' ? parsed.detail : '',
  };
}

module.exports = { classifyReceiptImage, PROMPT };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npx jest test/lib/geminiClient.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add functions/src/lib/categories.js functions/src/lib/geminiClient.js functions/test/lib/geminiClient.test.js
git commit -m "feat(functions): add fixed category list and Gemini receipt classifier"
```

---

### Task 7: Superadmin functions

**Files:**
- Create: `functions/src/functions/superadmin.js`
- Test: `functions/test/functions/superadmin.test.js`

**Interfaces:**
- Consumes: `FakeFirestore` (Task 1), `hashSecret`/`verifySecret` (Task 2), `createSession`/`requireSession` (Task 3).
- Produces: `verifySuperadminPassword(db, passwordHash, data: {password}) => Promise<{token, expiresAt}>`; `createTrip(db, data: {sessionToken, name, slug, group, adminPin, memberPin}) => Promise<{tripId}>`; `listTrips(db, data: {sessionToken}) => Promise<Array<trip w/o pin hashes>>`; `updateTrip(db, data: {sessionToken, tripId, patch}) => Promise<{ok: true}>`; `archiveTrip(db, data: {sessionToken, tripId}) => Promise<{ok: true}>`.

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { hashSecret } = require('../../src/lib/hashing');
const { createSession } = require('../../src/lib/sessions');
const {
  verifySuperadminPassword, createTrip, listTrips, updateTrip, archiveTrip,
} = require('../../src/functions/superadmin');

describe('superadmin functions', () => {
  test('verifySuperadminPassword issues a session for the correct password', async () => {
    const db = new FakeFirestore();
    const hash = await hashSecret('20112988sk!');

    const { token } = await verifySuperadminPassword(db, hash, { password: '20112988sk!' });
    expect(typeof token).toBe('string');
  });

  test('verifySuperadminPassword rejects the wrong password', async () => {
    const db = new FakeFirestore();
    const hash = await hashSecret('20112988sk!');
    await expect(verifySuperadminPassword(db, hash, { password: 'wrong' })).rejects.toThrow('INVALID_PASSWORD');
  });

  test('createTrip requires a superadmin session', async () => {
    const db = new FakeFirestore();
    await expect(createTrip(db, {
      sessionToken: 'nope', name: 'x', slug: 'x', group: 'g', adminPin: '1111', memberPin: '2222',
    })).rejects.toThrow('UNAUTHENTICATED');
  });

  test('createTrip creates a trip in setup status with hashed PINs', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });

    const { tripId } = await createTrip(db, {
      sessionToken: token, name: 'SFA 2026', slug: 'sfa-2026', group: 'SFA', adminPin: '1111', memberPin: '2222',
    });

    const snap = await db.collection('trips').doc(tripId).get();
    const trip = snap.data();
    expect(trip.status).toBe('setup');
    expect(trip.adminPinHash).not.toBe('1111');
    expect(trip.memberPinHash).not.toBe('2222');
  });

  test('createTrip rejects a duplicate slug', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'dup', group: 'G', adminPin: '1111', memberPin: '2222',
    });

    await expect(createTrip(db, {
      sessionToken: token, name: 'B', slug: 'dup', group: 'G', adminPin: '3333', memberPin: '4444',
    })).rejects.toThrow('SLUG_TAKEN');
  });

  test('listTrips never exposes PIN hashes', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'a', group: 'G', adminPin: '1111', memberPin: '2222',
    });

    const trips = await listTrips(db, { sessionToken: token });
    expect(trips).toHaveLength(1);
    expect(trips[0].adminPinHash).toBeUndefined();
    expect(trips[0].memberPinHash).toBeUndefined();
  });

  test('updateTrip re-hashes a new admin PIN instead of storing it raw', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    const { tripId } = await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'a', group: 'G', adminPin: '1111', memberPin: '2222',
    });

    await updateTrip(db, { sessionToken: token, tripId, patch: { adminPin: '9999' } });

    const snap = await db.collection('trips').doc(tripId).get();
    expect(snap.data().adminPinHash).not.toBe('9999');
    expect(snap.data().adminPin).toBeUndefined();
  });

  test('archiveTrip removes the trip and its members subcollection', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'superadmin' });
    const { tripId } = await createTrip(db, {
      sessionToken: token, name: 'A', slug: 'a', group: 'G', adminPin: '1111', memberPin: '2222',
    });
    await db.collection('trips').doc(tripId).collection('members').doc('m1').set({ name: 'X' });

    await archiveTrip(db, { sessionToken: token, tripId });

    const snap = await db.collection('trips').doc(tripId).get();
    expect(snap.exists).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/functions/superadmin.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
const { hashSecret, verifySecret } = require('../lib/hashing');
const { createSession, requireSession } = require('../lib/sessions');

async function verifySuperadminPassword(db, passwordHash, data) {
  const ok = await verifySecret(data.password || '', passwordHash);
  if (!ok) throw new Error('INVALID_PASSWORD');
  return createSession(db, { role: 'superadmin' });
}

async function createTrip(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);

  const {
    name, slug, group, adminPin, memberPin,
  } = data;
  if (!name || !slug || !group || !adminPin || !memberPin) throw new Error('MISSING_FIELDS');

  const existing = await db.collection('trips').where('slug', '==', slug).get();
  if (!existing.empty) throw new Error('SLUG_TAKEN');

  const adminPinHash = await hashSecret(adminPin);
  const memberPinHash = await hashSecret(memberPin);

  const ref = await db.collection('trips').add({
    name,
    slug,
    group,
    adminPinHash,
    memberPinHash,
    status: 'setup',
    period: { start: null, end: null },
    location: '',
    lodging: '',
    createdAt: Date.now(),
  });

  return { tripId: ref.id };
}

async function listTrips(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);
  const snap = await db.collection('trips').get();
  return snap.docs.map((d) => {
    const { adminPinHash, memberPinHash, ...rest } = d.data();
    return { id: d.id, ...rest };
  });
}

async function updateTrip(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);
  const { tripId, patch } = data;
  const update = { ...patch };

  if (update.adminPin) {
    update.adminPinHash = await hashSecret(update.adminPin);
    delete update.adminPin;
  }
  if (update.memberPin) {
    update.memberPinHash = await hashSecret(update.memberPin);
    delete update.memberPin;
  }

  await db.collection('trips').doc(tripId).update(update);
  return { ok: true };
}

async function archiveTrip(db, data) {
  await requireSession(db, data.sessionToken, ['superadmin']);
  await db.recursiveDelete(db.collection('trips').doc(data.tripId));
  return { ok: true };
}

module.exports = {
  verifySuperadminPassword, createTrip, listTrips, updateTrip, archiveTrip,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/functions/superadmin.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/superadmin.js functions/test/functions/superadmin.test.js
git commit -m "feat(functions): add superadmin trip management functions"
```

---

### Task 8: Trip login (admin PIN / member name+PIN)

**Files:**
- Create: `functions/src/functions/tripAuth.js`
- Test: `functions/test/functions/tripAuth.test.js`

**Interfaces:**
- Consumes: `findTripBySlug` is internal but exported for reuse by Task 9/10/11/13; `createSession` (Task 3), `verifySecret` (Task 2).
- Produces: `verifyAdminPin(db, data: {slug, pin}) => Promise<{token, expiresAt}>`; `verifyMemberPin(db, data: {slug, name, pin}) => Promise<{token, expiresAt}>`; `findTripBySlug(db, slug) => Promise<trip w/ id>`.

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { hashSecret } = require('../../src/lib/hashing');
const { verifyAdminPin, verifyMemberPin } = require('../../src/functions/tripAuth');

async function makeTrip(db, overrides = {}) {
  const adminPinHash = await hashSecret('1111');
  const memberPinHash = await hashSecret('2222');
  const ref = await db.collection('trips').add({
    slug: 'sfa-2026', name: 'SFA', group: 'SFA', status: 'setup', adminPinHash, memberPinHash, ...overrides,
  });
  return ref;
}

describe('tripAuth', () => {
  test('verifyAdminPin issues an admin session for the correct PIN', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);

    const { token } = await verifyAdminPin(db, { slug: 'sfa-2026', pin: '1111' });
    const session = (await db.collection('sessions').doc(token).get()).data();
    expect(session.role).toBe('admin');
    expect(session.tripId).toBe(tripRef.id);
  });

  test('verifyAdminPin rejects the wrong PIN', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);
    await expect(verifyAdminPin(db, { slug: 'sfa-2026', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
  });

  test('verifyAdminPin rejects an unknown slug', async () => {
    const db = new FakeFirestore();
    await expect(verifyAdminPin(db, { slug: 'no-such-trip', pin: '1111' })).rejects.toThrow('TRIP_NOT_FOUND');
  });

  test('verifyMemberPin issues a member session tied to the matching member document', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const memberRef = await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    const { token } = await verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: '2222' });
    const session = (await db.collection('sessions').doc(token).get()).data();
    expect(session.role).toBe('member');
    expect(session.memberId).toBe(memberRef.id);
  });

  test('verifyMemberPin rejects a name that is not a registered member', async () => {
    const db = new FakeFirestore();
    await makeTrip(db);
    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '모르는사람', pin: '2222' })).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  test('verifyMemberPin rejects the wrong PIN even for a real member', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    await tripRef.collection('members').add({ name: '슬기', weight: 1, excludedCategories: [] });

    await expect(verifyMemberPin(db, { slug: 'sfa-2026', name: '슬기', pin: 'wrong' })).rejects.toThrow('INVALID_PIN');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/functions/tripAuth.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
const { verifySecret } = require('../lib/hashing');
const { createSession } = require('../lib/sessions');

async function findTripBySlug(db, slug) {
  const snap = await db.collection('trips').where('slug', '==', slug).get();
  if (snap.empty) throw new Error('TRIP_NOT_FOUND');
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function verifyAdminPin(db, data) {
  const trip = await findTripBySlug(db, data.slug);
  const ok = await verifySecret(data.pin || '', trip.adminPinHash);
  if (!ok) throw new Error('INVALID_PIN');
  return createSession(db, { role: 'admin', tripId: trip.id });
}

async function verifyMemberPin(db, data) {
  const trip = await findTripBySlug(db, data.slug);
  const ok = await verifySecret(data.pin || '', trip.memberPinHash);
  if (!ok) throw new Error('INVALID_PIN');

  const membersSnap = await db.collection('trips').doc(trip.id).collection('members')
    .where('name', '==', data.name).get();
  if (membersSnap.empty) throw new Error('MEMBER_NOT_FOUND');
  const member = membersSnap.docs[0];

  return createSession(db, { role: 'member', tripId: trip.id, memberId: member.id });
}

module.exports = { verifyAdminPin, verifyMemberPin, findTripBySlug };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/functions/tripAuth.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/tripAuth.js functions/test/functions/tripAuth.test.js
git commit -m "feat(functions): add admin PIN and member name+PIN login"
```

---

### Task 9: Trip setup (period/location/lodging)

**Files:**
- Create: `functions/src/functions/tripSetup.js`
- Test: `functions/test/functions/tripSetup.test.js`

**Interfaces:**
- Consumes: `requireSession` (Task 3).
- Produces: `getTripSetup(db, data: {sessionToken, tripId}) => Promise<trip w/o pin hashes>`; `updateTripSetup(db, data: {sessionToken, tripId, patch: {period?, location?, lodging?}}) => Promise<{ok: true}>` — flips `status` from `'setup'` to `'active'` on first save.

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { getTripSetup, updateTripSetup } = require('../../src/functions/tripSetup');

async function makeTrip(db, overrides = {}) {
  const ref = await db.collection('trips').add({
    slug: 'a', name: 'A', group: 'G', status: 'setup', adminPinHash: 'x', memberPinHash: 'y', ...overrides,
  });
  return ref;
}

describe('tripSetup', () => {
  test('getTripSetup returns trip fields without PIN hashes', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    const result = await getTripSetup(db, { sessionToken: token, tripId: tripRef.id });
    expect(result.name).toBe('A');
    expect(result.adminPinHash).toBeUndefined();
  });

  test('getTripSetup rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'admin', tripId: 'some-other-trip' });

    await expect(getTripSetup(db, { sessionToken: token, tripId: tripRef.id })).rejects.toThrow('FORBIDDEN');
  });

  test('updateTripSetup requires an admin session, not a member session', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: 'm1' });

    await expect(updateTripSetup(db, {
      sessionToken: token, tripId: tripRef.id, patch: { location: '영월' },
    })).rejects.toThrow('FORBIDDEN');
  });

  test('updateTripSetup moves status from setup to active on first save', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db);
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await updateTripSetup(db, {
      sessionToken: token,
      tripId: tripRef.id,
      patch: { period: { start: '2026-08-01', end: '2026-08-02' }, location: '영월', lodging: '동강시스타' },
    });

    const snap = await tripRef.get();
    expect(snap.data().status).toBe('active');
    expect(snap.data().location).toBe('영월');
  });

  test('updateTripSetup leaves an already-active trip active', async () => {
    const db = new FakeFirestore();
    const tripRef = await makeTrip(db, { status: 'active' });
    const { token } = await createSession(db, { role: 'admin', tripId: tripRef.id });

    await updateTripSetup(db, { sessionToken: token, tripId: tripRef.id, patch: { location: '속초' } });

    const snap = await tripRef.get();
    expect(snap.data().status).toBe('active');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/functions/tripSetup.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
const { requireSession } = require('../lib/sessions');

async function getTripSetup(db, data) {
  await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
  const snap = await db.collection('trips').doc(data.tripId).get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');
  const { adminPinHash, memberPinHash, ...rest } = snap.data();
  return rest;
}

async function updateTripSetup(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);

  const ref = db.collection('trips').doc(data.tripId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('TRIP_NOT_FOUND');

  const update = { ...data.patch };
  if (snap.data().status === 'setup') update.status = 'active';

  await ref.update(update);
  return { ok: true };
}

module.exports = { getTripSetup, updateTripSetup };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/functions/tripSetup.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/tripSetup.js functions/test/functions/tripSetup.test.js
git commit -m "feat(functions): add trip setup read/update"
```

---

### Task 10: Member management

**Files:**
- Create: `functions/src/functions/members.js`
- Test: `functions/test/functions/members.test.js`

**Interfaces:**
- Consumes: `requireSession` (Task 3).
- Produces: `addMember(db, data: {sessionToken, tripId, name, weight?, excludedCategories?}) => Promise<{memberId}>`; `updateMember(db, data: {sessionToken, tripId, memberId, patch}) => Promise<{ok: true}>`. Names must be unique within a trip.

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { addMember, updateMember } = require('../../src/functions/members');

describe('members', () => {
  test('addMember requires an admin session for the trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await expect(addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' })).rejects.toThrow('FORBIDDEN');
  });

  test('addMember creates a member with default weight 1 and no exclusions', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });
    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data()).toEqual({ name: '슬기', weight: 1, excludedCategories: [], account: null });
  });

  test('addMember rejects a duplicate name within the same trip', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' });

    await expect(addMember(db, { sessionToken: token, tripId: 't1', name: '슬기' })).rejects.toThrow('NAME_TAKEN');
  });

  test('addMember allows the same name in a different trip', async () => {
    const db = new FakeFirestore();
    const { token: t1 } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { token: t2 } = await createSession(db, { role: 'admin', tripId: 't2' });

    await addMember(db, { sessionToken: t1, tripId: 't1', name: '슬기' });
    await expect(addMember(db, { sessionToken: t2, tripId: 't2', name: '슬기' })).resolves.toBeDefined();
  });

  test('updateMember can set a custom weight and excluded categories', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '충엽' });

    await updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { weight: 1, excludedCategories: ['식비'] },
    });

    const snap = await db.collection('trips').doc('t1').collection('members').doc(memberId).get();
    expect(snap.data().excludedCategories).toEqual(['식비']);
  });

  test('updateMember rejects renaming a member to a name already used by someone else', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await addMember(db, { sessionToken: token, tripId: 't1', name: '행범' });
    const { memberId } = await addMember(db, { sessionToken: token, tripId: 't1', name: '경건' });

    await expect(updateMember(db, {
      sessionToken: token, tripId: 't1', memberId, patch: { name: '행범' },
    })).rejects.toThrow('NAME_TAKEN');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/functions/members.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
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

  if (patch.name) {
    const existing = await membersRef.where('name', '==', patch.name).get();
    const clashesWithAnother = existing.docs.some((d) => d.id !== memberId);
    if (clashesWithAnother) throw new Error('NAME_TAKEN');
  }

  await membersRef.doc(memberId).update(patch);
  return { ok: true };
}

module.exports = { addMember, updateMember };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/functions/members.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/members.js functions/test/functions/members.test.js
git commit -m "feat(functions): add member roster management"
```

---

### Task 11: Expense CRUD and confirmation

**Files:**
- Create: `functions/src/functions/expenses.js`
- Test: `functions/test/functions/expenses.test.js`

**Interfaces:**
- Consumes: `requireSession` (Task 3), `CATEGORIES` (Task 6).
- Produces: `listExpenses(db, data: {sessionToken, tripId}) => Promise<Array<expense w/ id>>`; `addExpense(db, data: {sessionToken, tripId, date, category, amount, merchant?, detail?, photoUrl?, enteredBy?}) => Promise<{expenseId}>` (member sessions ignore any provided `enteredBy` and are forced to their own `memberId`; admin sessions must supply a valid `enteredBy`); `updateExpense(db, data: {sessionToken, tripId, expenseId, patch}) => Promise<{ok: true}>` (a member may only touch their own unconfirmed expense; an admin may touch any); `confirmExpense(db, data: {sessionToken, tripId, expenseId, confirmed}) => Promise<{ok: true}>` (admin-only).

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const {
  listExpenses, addExpense, updateExpense, confirmExpense,
} = require('../../src/functions/expenses');

describe('expenses', () => {
  test('a member adding an expense is always attributed to themselves', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000, enteredBy: 'someone-else',
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().enteredBy).toBe('m1');
    expect(snap.data().recordedBy).toBe('member');
    expect(snap.data().confirmed).toBe(false);
  });

  test('an admin adding an expense must supply a valid enteredBy member', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
    await db.collection('trips').doc('t1').collection('members').doc('m1').set({ name: 'X' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '숙박', amount: 200000, enteredBy: 'm1',
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().enteredBy).toBe('m1');
    expect(snap.data().recordedBy).toBe('admin');
  });

  test('an admin adding an expense for an unknown member is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'admin', tripId: 't1' });

    await expect(addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '숙박', amount: 1000, enteredBy: 'ghost',
    })).rejects.toThrow('MEMBER_NOT_FOUND');
  });

  test('an invalid category is rejected', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await expect(addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '기타', amount: 1000,
    })).rejects.toThrow('INVALID_CATEGORY');
  });

  test('a member can edit their own unconfirmed expense', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await updateExpense(db, { sessionToken: token, tripId: 't1', expenseId, patch: { amount: 12000 } });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().amount).toBe(12000);
  });

  test('a member cannot edit someone else\'s expense', async () => {
    const db = new FakeFirestore();
    const { token: mine } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: theirs } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm2' });
    const { expenseId } = await addExpense(db, {
      sessionToken: mine, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(updateExpense(db, {
      sessionToken: theirs, tripId: 't1', expenseId, patch: { amount: 1 },
    })).rejects.toThrow('FORBIDDEN');
  });

  test('a member cannot edit their own expense once it is confirmed', async () => {
    const db = new FakeFirestore();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: admin } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });
    await confirmExpense(db, {
      sessionToken: admin, tripId: 't1', expenseId, confirmed: true,
    });

    await expect(updateExpense(db, {
      sessionToken: member, tripId: 't1', expenseId, patch: { amount: 1 },
    })).rejects.toThrow('EXPENSE_LOCKED');
  });

  test('an admin can edit any expense regardless of who entered it or confirmation state', async () => {
    const db = new FakeFirestore();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { token: admin } = await createSession(db, { role: 'admin', tripId: 't1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });
    await confirmExpense(db, { sessionToken: admin, tripId: 't1', expenseId, confirmed: true });

    await updateExpense(db, { sessionToken: admin, tripId: 't1', expenseId, patch: { amount: 9999 } });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().amount).toBe(9999);
  });

  test('confirmExpense requires an admin session', async () => {
    const db = new FakeFirestore();
    const { token: member } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const { expenseId } = await addExpense(db, {
      sessionToken: member, tripId: 't1', date: '2026-08-01', category: '식비', amount: 10000,
    });

    await expect(confirmExpense(db, {
      sessionToken: member, tripId: 't1', expenseId, confirmed: true,
    })).rejects.toThrow('FORBIDDEN');
  });

  test('listExpenses returns every expense in the trip with its id', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    await addExpense(db, { sessionToken: token, tripId: 't1', date: '2026-08-01', category: '식비', amount: 1000 });
    await addExpense(db, { sessionToken: token, tripId: 't1', date: '2026-08-02', category: '교통비', amount: 2000 });

    const result = await listExpenses(db, { sessionToken: token, tripId: 't1' });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/functions/expenses.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
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

  if (patch.category && !CATEGORIES.includes(patch.category)) throw new Error('INVALID_CATEGORY');

  await ref.update({ ...patch, updatedAt: Date.now() });
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
  listExpenses, addExpense, updateExpense, confirmExpense,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/functions/expenses.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/expenses.js functions/test/functions/expenses.test.js
git commit -m "feat(functions): add expense CRUD with member/admin edit rules and confirmation lock"
```

---

### Task 12: Receipt upload + classification

**Files:**
- Create: `functions/src/lib/storage.js`
- Create: `functions/src/functions/receipts.js`
- Create: `functions/test/helpers/fakeBucket.js`
- Test: `functions/test/lib/storage.test.js`
- Test: `functions/test/functions/receipts.test.js`

**Interfaces:**
- Consumes: `requireSession` (Task 3), `checkRateLimit` (Task 4), `classifyReceiptImage` (Task 6).
- Produces: `uploadReceiptImage(bucket, tripId, base64, mimeType) => Promise<string photoUrl>` (from `storage.js`); `classifyReceipt(db, bucket, apiKey, data: {sessionToken, tripId, photoBase64, mimeType}) => Promise<{photoUrl, category, date, amount, merchant, detail}>` (from `receipts.js`). Note: this only classifies and uploads — saving the reviewed result as an expense is a separate `addExpense` call from the client after the user confirms/edits the fields.

- [ ] **Step 1: Write the fake Storage bucket test double**

`functions/test/helpers/fakeBucket.js`:

```js
function makeFakeBucket() {
  const saved = [];
  return {
    saved,
    file(path) {
      return {
        async save(buffer, opts) {
          saved.push({ path, buffer, opts });
        },
        publicUrl() {
          return `https://storage.fake/${path}`;
        },
      };
    },
  };
}

module.exports = { makeFakeBucket };
```

- [ ] **Step 2: Write the failing test for storage.js**

```js
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { uploadReceiptImage } = require('../../src/lib/storage');

describe('uploadReceiptImage', () => {
  test('saves the image under the trip and returns its public URL', async () => {
    const bucket = makeFakeBucket();
    const url = await uploadReceiptImage(bucket, 'trip1', Buffer.from('fake-image').toString('base64'), 'image/jpeg');

    expect(url).toMatch(/^https:\/\/storage\.fake\/receipts\/trip1\//);
    expect(bucket.saved).toHaveLength(1);
    expect(bucket.saved[0].opts.metadata.contentType).toBe('image/jpeg');
  });

  test('uses a .png extension for png images', async () => {
    const bucket = makeFakeBucket();
    const url = await uploadReceiptImage(bucket, 'trip1', Buffer.from('x').toString('base64'), 'image/png');
    expect(url).toMatch(/\.png$/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd functions && npx jest test/lib/storage.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Write storage.js**

```js
function base64ToBuffer(base64) {
  return Buffer.from(base64, 'base64');
}

async function uploadReceiptImage(bucket, tripId, base64, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const filePath = `receipts/${tripId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(base64ToBuffer(base64), { metadata: { contentType: mimeType }, public: true });
  return file.publicUrl();
}

module.exports = { uploadReceiptImage, base64ToBuffer };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd functions && npx jest test/lib/storage.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing tests for receipts.js**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { makeFakeBucket } = require('../helpers/fakeBucket');
const { createSession } = require('../../src/lib/sessions');

jest.mock('../../src/lib/geminiClient', () => ({
  classifyReceiptImage: jest.fn().mockResolvedValue({
    category: '식비', date: '2026-08-01', amount: 45000, merchant: '감자바우', detail: '옹심이칼국수',
  }),
}));

const { classifyReceipt } = require('../../src/functions/receipts');

describe('classifyReceipt', () => {
  test('uploads the photo and returns the Gemini classification alongside the photo URL', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const result = await classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken: token, tripId: 't1', photoBase64: Buffer.from('img').toString('base64'), mimeType: 'image/jpeg',
    });

    expect(result.category).toBe('식비');
    expect(result.photoUrl).toMatch(/^https:\/\/storage\.fake\/receipts\/t1\//);
    expect(bucket.saved).toHaveLength(1);
  });

  test('is rate-limited after 5 calls within a minute', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
    const call = () => classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken: token, tripId: 't1', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    });

    for (let i = 0; i < 5; i += 1) await call();

    await expect(call()).rejects.toThrow('RATE_LIMITED');
  });

  test('rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    const bucket = makeFakeBucket();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    await expect(classifyReceipt(db, bucket, 'fake-api-key', {
      sessionToken: token, tripId: 't2', photoBase64: 'aW1n', mimeType: 'image/jpeg',
    })).rejects.toThrow('FORBIDDEN');
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd functions && npx jest test/functions/receipts.test.js`
Expected: FAIL — module not found.

- [ ] **Step 8: Write receipts.js**

```js
const { requireSession } = require('../lib/sessions');
const { checkRateLimit } = require('../lib/rateLimit');
const { uploadReceiptImage } = require('../lib/storage');
const { classifyReceiptImage } = require('../lib/geminiClient');

async function classifyReceipt(db, bucket, apiKey, data) {
  const {
    sessionToken, tripId, photoBase64, mimeType,
  } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await checkRateLimit(db, sessionToken, 'classifyReceipt', 5, 60000);

  const photoUrl = await uploadReceiptImage(bucket, tripId, photoBase64, mimeType);
  const classification = await classifyReceiptImage(photoBase64, mimeType, apiKey);

  return { photoUrl, ...classification };
}

module.exports = { classifyReceipt };
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd functions && npx jest test/functions/receipts.test.js`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add functions/src/lib/storage.js functions/src/functions/receipts.js functions/test/helpers/fakeBucket.js functions/test/lib/storage.test.js functions/test/functions/receipts.test.js
git commit -m "feat(functions): add receipt upload and Gemini classification endpoint"
```

---

### Task 13: Report aggregation (settlement + group average)

**Files:**
- Create: `functions/src/functions/report.js`
- Test: `functions/test/functions/report.test.js`

**Interfaces:**
- Consumes: `requireSession` (Task 3), `computeSettlement` (Task 5).
- Produces: `getReportData(db, data: {sessionToken, tripId}) => Promise<{trip, members, expenses, settlement, currentCategoryAverages, groupCategoryAverages, tripsInComparison}>`; `perPersonCategoryAverage(members, expenses) => {categoryTotals, averages}` (exported for reuse/testing — headcount-based per-person average of confirmed spend per category, used only for the report's comparison display, not for settlement math).

- [ ] **Step 1: Write the failing tests**

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const { getReportData, perPersonCategoryAverage } = require('../../src/functions/report');

async function seedTrip(db, { id, group, status, members, expenses }) {
  await db.collection('trips').doc(id).set({
    name: id, group, status, period: { start: null, end: null }, location: '', lodging: '',
  });
  for (const m of members) {
    await db.collection('trips').doc(id).collection('members').doc(m.id).set(m);
  }
  for (const e of expenses) {
    await db.collection('trips').doc(id).collection('expenses').add(e);
  }
}

describe('perPersonCategoryAverage', () => {
  test('divides each confirmed category total by the headcount not excluded from it', () => {
    const members = [
      { id: 'a', excludedCategories: [] },
      { id: 'b', excludedCategories: [] },
    ];
    const expenses = [{ category: '식비', amount: 40000, confirmed: true }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    expect(averages['식비']).toBe(20000);
  });

  test('ignores unconfirmed expenses', () => {
    const members = [{ id: 'a', excludedCategories: [] }];
    const expenses = [{ category: '식비', amount: 40000, confirmed: false }];

    const { averages } = perPersonCategoryAverage(members, expenses);
    expect(averages['식비']).toBeUndefined();
  });
});

describe('getReportData', () => {
  test('returns settlement and current-trip category averages', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [
        { id: 'a', name: 'A', weight: 1, excludedCategories: [] },
        { id: 'b', name: 'B', weight: 1, excludedCategories: [] },
      ],
      expenses: [{ category: '식비', amount: 40000, enteredBy: 'a', confirmed: true }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.settlement.perMember.find((m) => m.id === 'a').due).toBe(20000);
    expect(result.currentCategoryAverages['식비']).toBe(20000);
  });

  test('averages the comparison across completed trips in the same group only', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current', group: 'SFA', status: 'active',
      members: [{ id: 'a', name: 'A', weight: 1, excludedCategories: [] }],
      expenses: [{ category: '식비', amount: 50000, enteredBy: 'a', confirmed: true }],
    });
    await seedTrip(db, {
      id: 'past-sfa', group: 'SFA', status: 'completed',
      members: [{ id: 'x', name: 'X', weight: 1, excludedCategories: [] }],
      expenses: [{ category: '식비', amount: 30000, enteredBy: 'x', confirmed: true }],
    });
    await seedTrip(db, {
      id: 'other-group', group: 'FRIENDS', status: 'completed',
      members: [{ id: 'y', name: 'Y', weight: 1, excludedCategories: [] }],
      expenses: [{ category: '식비', amount: 999999, enteredBy: 'y', confirmed: true }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.groupCategoryAverages['식비']).toBe(30000);
    expect(result.tripsInComparison).toBe(1);
  });

  test('rejects a session scoped to a different trip', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current', group: 'SFA', status: 'active', members: [], expenses: [],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'other-trip' });

    await expect(getReportData(db, { sessionToken: token, tripId: 'current' })).rejects.toThrow('FORBIDDEN');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx jest test/functions/report.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
const { requireSession } = require('../lib/sessions');
const { computeSettlement } = require('../lib/settlement');

async function loadTripBundle(db, tripId) {
  const membersSnap = await db.collection('trips').doc(tripId).collection('members').get();
  const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const expensesSnap = await db.collection('trips').doc(tripId).collection('expenses').get();
  const expenses = expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { members, expenses };
}

function perPersonCategoryAverage(members, expenses) {
  const confirmed = expenses.filter((e) => e.confirmed);
  const categoryTotals = {};
  for (const e of confirmed) {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
  }

  const averages = {};
  for (const category of Object.keys(categoryTotals)) {
    const headcount = members.filter((m) => !(m.excludedCategories || []).includes(category)).length;
    if (headcount > 0) averages[category] = categoryTotals[category] / headcount;
  }

  return { categoryTotals, averages };
}

async function getReportData(db, data) {
  const { sessionToken, tripId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const tripSnap = await db.collection('trips').doc(tripId).get();
  if (!tripSnap.exists) throw new Error('TRIP_NOT_FOUND');
  const trip = tripSnap.data();

  const { members, expenses } = await loadTripBundle(db, tripId);
  const settlement = computeSettlement(members, expenses);
  const { averages: currentCategoryAverages } = perPersonCategoryAverage(members, expenses);

  const otherTripsSnap = await db.collection('trips')
    .where('group', '==', trip.group)
    .where('status', '==', 'completed')
    .get();
  const otherTrips = otherTripsSnap.docs.filter((d) => d.id !== tripId);

  const perCategorySums = {};
  const perCategoryCounts = {};
  for (const tripDoc of otherTrips) {
    const bundle = await loadTripBundle(db, tripDoc.id);
    const { averages } = perPersonCategoryAverage(bundle.members, bundle.expenses);
    for (const category of Object.keys(averages)) {
      perCategorySums[category] = (perCategorySums[category] || 0) + averages[category];
      perCategoryCounts[category] = (perCategoryCounts[category] || 0) + 1;
    }
  }

  const groupCategoryAverages = {};
  for (const category of Object.keys(perCategorySums)) {
    groupCategoryAverages[category] = perCategorySums[category] / perCategoryCounts[category];
  }

  return {
    trip: {
      name: trip.name, period: trip.period, location: trip.location, lodging: trip.lodging,
    },
    members,
    expenses,
    settlement,
    currentCategoryAverages,
    groupCategoryAverages,
    tripsInComparison: otherTrips.length,
  };
}

module.exports = { getReportData, perPersonCategoryAverage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx jest test/functions/report.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/functions/report.js functions/test/functions/report.test.js
git commit -m "feat(functions): add settlement + group-average report aggregation"
```

---

### Task 14: Wire everything into `onCall` and verify against the local emulator

**Files:**
- Create: `functions/index.js`
- Modify: `functions/package.json` (bump nothing; documented commands only)

**Interfaces:**
- Consumes: every handler from Tasks 7–13.
- Produces: deployed-shape Cloud Functions exports: `verifySuperadminPassword`, `createTrip`, `listTrips`, `updateTrip`, `archiveTrip`, `verifyAdminPin`, `verifyMemberPin`, `getTripSetup`, `updateTripSetup`, `addMember`, `updateMember`, `listExpenses`, `addExpense`, `updateExpense`, `confirmExpense`, `classifyReceipt`, `getReportData` — this is the exact set of callable names the frontend plan (Plan 2) will call by name via the Firebase client SDK's `httpsCallable`.

This task has no unit test of its own — `index.js` is Firebase wiring glue that depends on `firebase-admin` being initialized against a running project/emulator, so it is verified manually against the emulator instead. Every function it wires already has full unit coverage from Tasks 7–13.

- [ ] **Step 1: Write `functions/index.js`**

```js
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

const superadminPasswordHash = defineSecret('SUPERADMIN_PASSWORD_HASH');
const geminiApiKey = defineSecret('GEMINI_API_KEY');

const superadmin = require('./src/functions/superadmin');
const tripAuth = require('./src/functions/tripAuth');
const tripSetup = require('./src/functions/tripSetup');
const members = require('./src/functions/members');
const expenses = require('./src/functions/expenses');
const receipts = require('./src/functions/receipts');
const report = require('./src/functions/report');

function wrap(handler) {
  return async (request) => {
    try {
      return await handler(db, request.data);
    } catch (err) {
      throw new HttpsError('invalid-argument', err.message);
    }
  };
}

exports.verifySuperadminPassword = onCall({ secrets: [superadminPasswordHash] }, async (request) => {
  try {
    return await superadmin.verifySuperadminPassword(db, superadminPasswordHash.value(), request.data);
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
});

exports.createTrip = onCall(wrap(superadmin.createTrip));
exports.listTrips = onCall(wrap(superadmin.listTrips));
exports.updateTrip = onCall(wrap(superadmin.updateTrip));
exports.archiveTrip = onCall(wrap(superadmin.archiveTrip));

exports.verifyAdminPin = onCall(wrap(tripAuth.verifyAdminPin));
exports.verifyMemberPin = onCall(wrap(tripAuth.verifyMemberPin));

exports.getTripSetup = onCall(wrap(tripSetup.getTripSetup));
exports.updateTripSetup = onCall(wrap(tripSetup.updateTripSetup));

exports.addMember = onCall(wrap(members.addMember));
exports.updateMember = onCall(wrap(members.updateMember));

exports.listExpenses = onCall(wrap(expenses.listExpenses));
exports.addExpense = onCall(wrap(expenses.addExpense));
exports.updateExpense = onCall(wrap(expenses.updateExpense));
exports.confirmExpense = onCall(wrap(expenses.confirmExpense));

exports.classifyReceipt = onCall({ secrets: [geminiApiKey] }, async (request) => {
  try {
    return await receipts.classifyReceipt(db, bucket, geminiApiKey.value(), request.data);
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
});

exports.getReportData = onCall(wrap(report.getReportData));
```

- [ ] **Step 2: Run the full unit test suite one more time**

Run: `cd functions && npm test`
Expected: PASS — every test from Tasks 1–13 still passes (index.js does not change any of them).

- [ ] **Step 3: Generate the superadmin password secret value for local emulator use**

Run: `node -e "require('bcryptjs').hash('20112988sk!', 10).then(console.log)"`

Copy the printed hash. Create `functions/.secret.local` (gitignored — add `functions/.secret.local` to `.gitignore` now):

```
SUPERADMIN_PASSWORD_HASH=<paste the hash here>
GEMINI_API_KEY=dummy-key-for-local-smoke-test
```

- [ ] **Step 4: Start the emulator suite**

Run: `npx firebase-tools@latest emulators:start --only functions,firestore,storage --project demo-sfayw`
Expected: emulator UI reachable at `http://127.0.0.1:4000`, functions listed include all 16 exports from Step 1.

- [ ] **Step 5: Manually verify the superadmin → createTrip flow end-to-end against the emulator**

```bash
curl -s -X POST http://127.0.0.1:5001/demo-sfayw/us-central1/verifySuperadminPassword \
  -H "Content-Type: application/json" \
  -d '{"data": {"password": "20112988sk!"}}'
```

Expected: `{"result":{"token":"<hex string>","expiresAt":<number>}}`. Copy `<hex string>` as `TOKEN`, then:

```bash
curl -s -X POST http://127.0.0.1:5001/demo-sfayw/us-central1/createTrip \
  -H "Content-Type: application/json" \
  -d '{"data": {"sessionToken": "'"$TOKEN"'", "name": "SFA 테스트", "slug": "smoke-test", "group": "SFA", "adminPin": "1111", "memberPin": "2222"}}'
```

Expected: `{"result":{"tripId":"<id>"}}`. Open `http://127.0.0.1:4000/firestore` and confirm a `trips` document exists with `status: "setup"` and `adminPinHash`/`memberPinHash` present as bcrypt strings (not `1111`/`2222`).

- [ ] **Step 6: Stop the emulator and commit**

```bash
git add functions/index.js .gitignore
git commit -m "feat(functions): wire all handlers to onCall exports"
```

---

## Plan-Level Verification

After Task 14, run the entire suite once more from the repo root to confirm nothing regressed:

```bash
cd functions && npm test
```

Expected: every test file listed in the File Structure section passes (Tasks 1–13, ~60 tests total).

## What This Plan Does Not Cover (deferred to later plans)

- **Frontend SPA** (login/admin/member/report views, camera capture UI, SVG pie chart, api.js client wrapper calling these `onCall` functions) — Plan 2.
- **Migration script** for the existing `travel_report.html` data and Realtime Database `accounts`/`paid` records into this Firestore structure, plus the real-project deployment runbook (`firebase deploy`, enabling Blaze billing if needed, setting real secrets, DNS/hosting) — Plan 3.
