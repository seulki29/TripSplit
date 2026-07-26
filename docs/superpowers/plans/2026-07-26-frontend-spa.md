# Frontend SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vanilla-JS, no-build SPA that consumes Plan 1's Cloud Functions backend — superadmin trip management, per-trip login, a tabbed admin console, the participant expense-entry flow (camera → Gemini review → save), and the report page with its new category-analysis section.

**Architecture:** A single `public/` directory served by Firebase Hosting with all paths rewritten to `index.html`. `app.js` is a tiny History-API router that dynamically `import()`s one view module per route. Every network call goes through `api.js`, a dependency-free `fetch()` wrapper that speaks the Firebase callable-function wire protocol directly (`POST .../data:{...}` → `{result}` or `{error}`) — no Firebase SDK is loaded, keeping the "no build step" property of Plan 1 intact on the frontend too. Session state (`{token, role, tripId, tripSlug, memberId, expiresAt}`) lives in `localStorage` via `session.js`.

**Tech Stack:** Vanilla JS ES modules (native browser `import`/`export`, no bundler), plain CSS custom properties, Node's built-in `node:test` runner for logic tests (no Jest — avoids Jest's experimental-ESM friction for a project that ships pure ES modules), `jsdom` as the only dev dependency (for the one test file that touches `document`).

## Global Constraints

- No framework, no bundler, no build step. Every `public/*.js` file must be loadable as-is by `<script type="module">`.
- All Cloud Function calls go through `api.js`'s `callFunction(name, data)` — no view module calls `fetch()` directly.
- Session token is attached automatically by `callFunction` from `session.js`'s `getSession()`; a view never manually threads `sessionToken` through its own calls.
- On an `UNAUTHENTICATED` or `PERMISSION_DENIED` response, `callFunction` clears the session and reloads the page — every view's own mount logic already checks `getSession()` first and redirects to the right login screen, so this single reload is sufficient recovery.
- Category list is always exactly `['숙박', '식비', '장보기', '교통비']`, matching `functions/src/lib/categories.js` — never hardcode a different list.
- Colors/fonts reference the existing sfaYW tokens (`--ink`, `--accent`, `--receive`, `--pay`, Playfair Display + DM Sans + Noto Sans KR) per the design doc — the CSS structure itself is new, not copied from `travel_report.html`.
- Admin console is tab-based (여행정보 · 구성원 · 경비확인 · 리포트 링크) — confirmed via brainstorming, not sidebar-based.
- Receipt entry review screen is photo-on-top, form-below (stacked) — confirmed via brainstorming.
- The report's new category-analysis section sits between the existing "02 지출내역" and "03 결제자별" sections, with the donut chart above and the group-average comparison bars below (stacked) — confirmed via brainstorming.
- Tests use Node's built-in `node:test` + `node:assert/strict`, run via `node --test public/test/`. No Jest in `public/`.

---

## File Structure

```
package.json                     # root-level, ESM, dev-only (test tooling)
firebase.json                    # MODIFY — add "hosting" pointing at public/
public/
  index.html                     # Task 1
  style.css                      # Task 2
  session.js                     # Task 3
  api.js                         # Task 4
  ui.js                          # Task 5
  app.js                         # Task 6
  views/
    superadmin.js                # Task 8
    login.js                     # Task 9
    admin.js                     # Task 10
    member.js                    # Task 11
    report.js                    # Task 12
  test/
    session.test.js
    api.test.js
    ui.test.js
    router.test.js
functions/src/lib/sessions.js         # MODIFY — Task 7 (Gap B): createSession returns role/tripId/memberId
functions/test/lib/sessions.test.js   # MODIFY — Task 7
functions/src/functions/members.js    # MODIFY — Task 7 (Gap A): adds listMembers
functions/test/functions/members.test.js  # MODIFY — Task 7
functions/index.js                    # MODIFY — Task 7: wires listMembers
```

---

### Task 1: Root test tooling + Firebase Hosting config + index.html shell

**Files:**
- Create: `package.json`
- Create: `public/index.html`
- Modify: `firebase.json`

**Interfaces:**
- Produces: `node --test public/test/` as the frontend test command; `public/index.html` as the single entry point every route loads.

- [ ] **Step 1: Create the root package.json**

```json
{
  "name": "sfayw-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test public/test/"
  },
  "devDependencies": {
    "jsdom": "^24.1.0"
  }
}
```

- [ ] **Step 2: Install the dev dependency**

Run: `npm install`
Expected: `node_modules/jsdom` present, no errors.

- [ ] **Step 3: Add a `hosting` block to `firebase.json`**

Read the current `firebase.json` first (it already has `functions`, `firestore`, `storage`, `emulators` from Plan 1) and add a `hosting` key and a `hosting` emulator port, without removing anything existing:

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
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "emulators": {
    "functions": { "port": 5001 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true }
  }
}
```

- [ ] **Step 4: Write `public/index.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>sfaYW</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&family=Noto+Sans+KR:wght@300;400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json firebase.json public/index.html
git commit -m "feat(frontend): scaffold frontend test tooling, hosting config, and app shell"
```

---

### Task 2: Design system (`style.css`)

**Files:**
- Create: `public/style.css`

**Interfaces:**
- Produces: CSS custom properties (`--ink`, `--ink-2`, `--ink-3`, `--paper`, `--paper-2`, `--rule`, `--accent`, `--accent-2`, `--warm`, `--receive`, `--pay`, `--danger`, `--f-display`, `--f-body`, `--f-kr`, `--radius`) and reusable classes every later task's HTML relies on: `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-danger`, `.input`, `.card`, `.tabs`/`.tab`/`.tab.active`, `.chip`/`.chip-selected`, `.chip-group`, `.badge`/`.badge-locked`, `.modal-overlay`/`.modal-box`/`.modal-header`/`.modal-body`, `.toast`/`.toast-info`/`.toast-error`/`.toast-success`, `.tag-*` per-member name color tags (reused from the original report styling).

- [ ] **Step 1: Write the stylesheet**

```css
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --ink: #0e0e0e;
  --ink-2: #3a3a3a;
  --ink-3: #7a7a7a;
  --ink-4: #b8b8b8;
  --paper: #fafaf8;
  --paper-2: #f2f1ee;
  --rule: #e4e3df;
  --accent: #1a4a6b;
  --accent-2: #2d7aaa;
  --warm: #c4874a;
  --receive: #1a5c3a;
  --pay: #8a3a1a;
  --danger: #b02a2a;

  --f-display: 'Playfair Display', Georgia, serif;
  --f-body: 'DM Sans', 'Noto Sans KR', sans-serif;
  --f-kr: 'Noto Sans KR', sans-serif;

  --radius: 4px;
}

html { scroll-behavior: smooth; }

body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--f-body);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.container { max-width: 960px; margin: 0 auto; padding: 0 clamp(1.25rem, 5vw, 2.5rem); }

h1, h2, h3 { font-family: var(--f-display); font-weight: 400; color: var(--ink); }
h1 { font-size: clamp(2rem, 5vw, 3rem); }
h2 { font-size: clamp(1.4rem, 3vw, 1.9rem); margin-bottom: 1rem; }
h3 { font-size: 1.1rem; margin-bottom: 0.5rem; }

.label {
  font-size: 11px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ink-3); font-family: var(--f-body);
}

/* ── FORM CONTROLS ── */
.input, select.input {
  width: 100%; padding: 0.75rem 0.9rem;
  border: 1px solid var(--rule); border-radius: var(--radius);
  font-size: 14px; font-family: var(--f-kr);
  background: var(--paper); color: var(--ink);
  outline: none; transition: border-color 0.15s;
}
.input:focus { border-color: var(--accent); }
.field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; }

.btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.7rem 1.2rem; border: none; border-radius: var(--radius);
  font-size: 13px; font-weight: 500; font-family: var(--f-kr);
  cursor: pointer; transition: background 0.15s, opacity 0.15s;
}
.btn-primary { background: var(--accent); color: white; }
.btn-primary:hover { background: #0d3a5a; }
.btn-secondary { background: var(--paper-2); color: var(--ink-2); }
.btn-secondary:hover { background: var(--rule); }
.btn-danger { background: var(--danger); color: white; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-block { width: 100%; }

/* ── CARD ── */
.card {
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 1.25rem;
}

/* ── TABS ── */
.tabs { display: flex; border-bottom: 2px solid var(--rule); margin-bottom: 1.5rem; overflow-x: auto; }
.tab {
  padding: 0.7rem 1.1rem; font-size: 13px; font-family: var(--f-kr); font-weight: 500;
  color: var(--ink-3); background: none; border: none; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap;
}
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ── CHIPS (category selector) ── */
.chip-group { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.chip {
  padding: 0.4rem 0.8rem; border: 1px solid var(--rule); border-radius: 999px;
  font-size: 12px; font-family: var(--f-kr); background: var(--paper); color: var(--ink-2);
  cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.chip-selected { background: var(--accent); color: white; border-color: var(--accent); }

/* ── BADGES / TAGS ── */
.badge {
  font-size: 10px; font-weight: 500; letter-spacing: 0.05em; padding: 0.15rem 0.5rem;
  border-radius: 2px; font-family: var(--f-body);
}
.badge-locked { background: #e4f0e8; color: var(--receive); }
.badge-pending { background: #fdf0e0; color: #804a10; }

.tag {
  display: inline-block; font-size: 11px; font-weight: 500; font-family: var(--f-kr);
  padding: 0.15rem 0.6rem; border-radius: 2px; white-space: nowrap;
  background: var(--paper-2); color: var(--ink-2);
}

/* ── MODAL ── */
.modal-overlay {
  display: none; position: fixed; inset: 0; background: rgba(10,10,10,0.6);
  z-index: 1000; align-items: center; justify-content: center; padding: 1.5rem;
}
.modal-overlay.open { display: flex; }
.modal-box {
  background: var(--paper); border-radius: 6px; max-width: 440px; width: 100%;
  max-height: 90svh; overflow-y: auto; box-shadow: 0 24px 80px rgba(0,0,0,0.35);
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.25rem; border-bottom: 1px solid var(--rule);
  position: sticky; top: 0; background: var(--paper);
}
.modal-title { font-size: 13px; font-weight: 500; font-family: var(--f-kr); }
.modal-close {
  background: none; border: none; cursor: pointer; font-size: 1.1rem; color: var(--ink-3);
  width: 28px; height: 28px; border-radius: 50%;
}
.modal-close:hover { background: var(--paper-2); }
.modal-body { padding: 1.25rem; }

/* ── TOAST ── */
.toast {
  position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%) translateY(20px);
  padding: 0.75rem 1.25rem; border-radius: var(--radius); font-size: 13px; font-family: var(--f-kr);
  color: white; opacity: 0; transition: opacity 0.25s, transform 0.25s; z-index: 2000;
  max-width: 90vw;
}
.toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
.toast-info { background: var(--ink-2); }
.toast-error { background: var(--danger); }
.toast-success { background: var(--receive); }

/* ── UTILITY ── */
.mono { font-variant-numeric: tabular-nums; }
.center { text-align: center; }
.muted { color: var(--ink-3); }
.section { padding: 2rem 0; border-top: 1px solid var(--rule); }
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat(frontend): add design system stylesheet"
```

---

### Task 3: Session storage (`session.js`)

**Files:**
- Create: `public/session.js`
- Test: `public/test/session.test.js`

**Interfaces:**
- Produces: `getSession() => {token, expiresAt, role, tripId, tripSlug, memberId} | null` (returns `null` and clears storage if expired or unparsable); `setSession(session) => void`; `clearSession() => void`.

- [ ] **Step 1: Write the failing test**

```js
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

globalThis.localStorage = makeFakeLocalStorage();
const { getSession, setSession, clearSession } = await import('../session.js');

describe('session.js', () => {
  beforeEach(() => {
    globalThis.localStorage = makeFakeLocalStorage();
  });

  test('getSession returns null when nothing is stored', () => {
    assert.equal(getSession(), null);
  });

  test('setSession then getSession round-trips', () => {
    const session = { token: 'abc', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null };
    setSession(session);
    assert.deepEqual(getSession(), session);
  });

  test('getSession returns null and clears storage for an expired session', () => {
    setSession({ token: 'abc', expiresAt: Date.now() - 1000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    assert.equal(getSession(), null);
    assert.equal(localStorage.getItem('sfayw_session'), null);
  });

  test('getSession returns null for unparsable stored data', () => {
    localStorage.setItem('sfayw_session', 'not json');
    assert.equal(getSession(), null);
  });

  test('clearSession removes the stored session', () => {
    setSession({ token: 'abc', expiresAt: Date.now() + 100000, role: 'member', tripId: 't1', tripSlug: 'sfa-2026', memberId: 'm1' });
    clearSession();
    assert.equal(getSession(), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/test/session.test.js`
Expected: FAIL — `Cannot find module '../session.js'`

- [ ] **Step 3: Write the implementation**

```js
const STORAGE_KEY = 'sfayw_session';

function getSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  if (session.expiresAt && session.expiresAt < Date.now()) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  return session;
}

function setSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export { getSession, setSession, clearSession };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test public/test/session.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add public/session.js public/test/session.test.js
git commit -m "feat(frontend): add localStorage-backed session module"
```

---

### Task 4: API client (`api.js`)

**Files:**
- Create: `public/api.js`
- Test: `public/test/api.test.js`

**Interfaces:**
- Consumes: `getSession`, `clearSession` from `./session.js` (Task 3).
- Produces: `callFunction(name, data = {}) => Promise<result>`. Throws an `Error` whose `.status` carries the upper-snake-case callable error status (e.g. `'INVALID_ARGUMENT'`) and `.message` carries the human-readable message. Automatically attaches `sessionToken` from the current session (unless the caller already provided one, e.g. the login functions don't have a session yet). On `UNAUTHENTICATED`/`PERMISSION_DENIED`, clears the session and reloads the page before the promise rejects. Also produces `logout() => Promise<void>` — calls the backend `logout` function (best-effort, ignores failure), clears the local session, and reloads.

- [ ] **Step 1: Write the failing tests**

```js
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

globalThis.localStorage = makeFakeLocalStorage();
globalThis.location = { hostname: 'localhost', href: '', reload: mock.fn() };

const { setSession } = await import('../session.js');
const { callFunction } = await import('../api.js');

function fakeFetchOnce(status, body) {
  return mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe('callFunction', () => {
  beforeEach(() => {
    globalThis.localStorage = makeFakeLocalStorage();
    globalThis.location.reload.mock.resetCalls();
  });

  test('returns the result on success', async () => {
    globalThis.fetch = fakeFetchOnce(200, { result: { tripId: 't1' } });
    const result = await callFunction('createTrip', { name: 'X' });
    assert.deepEqual(result, { tripId: 't1' });
  });

  test('attaches sessionToken from the stored session automatically', async () => {
    setSession({ token: 'tok123', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    const fetchMock = fakeFetchOnce(200, { result: { ok: true } });
    globalThis.fetch = fetchMock;

    await callFunction('updateTripSetup', { patch: { location: '속초' } });

    const [, options] = fetchMock.mock.calls[0].arguments;
    const sentBody = JSON.parse(options.body);
    assert.equal(sentBody.data.sessionToken, 'tok123');
    assert.equal(sentBody.data.patch.location, '속초');
  });

  test('does not overwrite an explicitly-provided sessionToken', async () => {
    setSession({ token: 'stored-token', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    const fetchMock = fakeFetchOnce(200, { result: { ok: true } });
    globalThis.fetch = fetchMock;

    await callFunction('someFn', { sessionToken: 'explicit-token' });

    const [, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(JSON.parse(options.body).data.sessionToken, 'explicit-token');
  });

  test('throws with the domain error message and status on a callable error response', async () => {
    globalThis.fetch = fakeFetchOnce(400, { error: { status: 'INVALID_ARGUMENT', message: 'INVALID_PIN' } });

    await assert.rejects(
      () => callFunction('verifyAdminPin', { slug: 'x', pin: '0000' }),
      (err) => {
        assert.equal(err.message, 'INVALID_PIN');
        assert.equal(err.status, 'INVALID_ARGUMENT');
        return true;
      }
    );
  });

  test('clears the session and reloads on UNAUTHENTICATED', async () => {
    setSession({ token: 'expired-tok', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    globalThis.fetch = fakeFetchOnce(401, { error: { status: 'UNAUTHENTICATED', message: 'SESSION_EXPIRED' } });

    await assert.rejects(() => callFunction('listExpenses', {}));

    const { getSession } = await import('../session.js');
    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });

  test('clears the session and reloads on PERMISSION_DENIED', async () => {
    setSession({ token: 'tok', expiresAt: Date.now() + 100000, role: 'member', tripId: 't1', tripSlug: 'sfa-2026', memberId: 'm1' });
    globalThis.fetch = fakeFetchOnce(403, { error: { status: 'PERMISSION_DENIED', message: 'FORBIDDEN' } });

    await assert.rejects(() => callFunction('updateExpense', {}));

    const { getSession } = await import('../session.js');
    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });

  test('uses the local emulator URL when hostname is localhost', async () => {
    const fetchMock = fakeFetchOnce(200, { result: {} });
    globalThis.fetch = fetchMock;
    await callFunction('listTrips', {});
    const [url] = fetchMock.mock.calls[0].arguments;
    assert.match(url, /^http:\/\/127\.0\.0\.1:5001\/demo-sfayw\/us-central1\/listTrips$/);
  });
});

describe('logout', () => {
  beforeEach(() => {
    globalThis.localStorage = makeFakeLocalStorage();
    globalThis.location.reload.mock.resetCalls();
  });

  test('calls the logout function, clears the session, and reloads', async () => {
    const { setSession, getSession } = await import('../session.js');
    setSession({ token: 'tok', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    globalThis.fetch = fakeFetchOnce(200, { result: { ok: true } });

    const { logout } = await import('../api.js');
    await logout();

    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });

  test('still clears the session and reloads even if the logout call itself fails', async () => {
    const { setSession, getSession } = await import('../session.js');
    setSession({ token: 'already-expired', expiresAt: Date.now() + 100000, role: 'admin', tripId: 't1', tripSlug: 'sfa-2026', memberId: null });
    globalThis.fetch = mock.fn(async () => { throw new Error('network down'); });

    const { logout } = await import('../api.js');
    await logout();

    assert.equal(getSession(), null);
    assert.equal(globalThis.location.reload.mock.callCount(), 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test public/test/api.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
import { getSession, clearSession } from './session.js';

const REGION = 'us-central1';
// NOTE: replace 'sfayw-prod' with the real deployed project id in Plan 3.
const PROD_PROJECT_ID = 'sfayw-prod';

function functionsBaseUrl() {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) return `http://127.0.0.1:5001/demo-sfayw/${REGION}`;
  return `https://${REGION}-${PROD_PROJECT_ID}.cloudfunctions.net`;
}

async function callFunction(name, data = {}) {
  const session = getSession();
  const payload = { ...data };
  if (session?.token && !('sessionToken' in payload)) {
    payload.sessionToken = session.token;
  }

  const res = await fetch(`${functionsBaseUrl()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
  });

  const body = await res.json();

  if (!res.ok || body.error) {
    const status = (body.error?.status || '').toUpperCase();
    const message = body.error?.message || '알 수 없는 오류가 발생했습니다.';

    if (status === 'UNAUTHENTICATED' || status === 'PERMISSION_DENIED') {
      clearSession();
      location.reload();
    }

    const err = new Error(message);
    err.status = status;
    throw err;
  }

  return body.result;
}

async function logout() {
  try {
    await callFunction('logout', {});
  } catch {
    // session was already invalid/expired server-side — clearing locally is enough
  }
  clearSession();
  location.reload();
}

export { callFunction, logout };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test public/test/api.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add public/api.js public/test/api.test.js
git commit -m "feat(frontend): add dependency-free Cloud Functions client"
```

---

### Task 5: Shared UI components (`ui.js`)

**Files:**
- Create: `public/ui.js`
- Test: `public/test/ui.test.js`

**Interfaces:**
- Produces: `openModal(titleHTML, bodyHTML) => void`; `closeModal() => void`; `showToast(message, kind = 'info') => void` (`kind` one of `'info'|'error'|'success'`); `renderChipGroup(container, options, selected, onSelect) => void`.

- [ ] **Step 1: Write the failing tests**

```js
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { openModal, closeModal, showToast, renderChipGroup } = await import('../ui.js');

describe('ui.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('openModal creates the modal root, sets content, and opens it', () => {
    openModal('제목', '<p>내용</p>');
    const overlay = document.getElementById('modal-overlay');
    assert.ok(overlay.classList.contains('open'));
    assert.equal(overlay.querySelector('.modal-title').textContent, '제목');
    assert.equal(overlay.querySelector('.modal-body').innerHTML, '<p>내용</p>');
  });

  test('closeModal removes the open class without destroying the root', () => {
    openModal('제목', '내용');
    closeModal();
    const overlay = document.getElementById('modal-overlay');
    assert.equal(overlay.classList.contains('open'), false);
  });

  test('clicking the close button closes the modal', () => {
    openModal('제목', '내용');
    document.querySelector('.modal-close').click();
    assert.equal(document.getElementById('modal-overlay').classList.contains('open'), false);
  });

  test('clicking the overlay background (not the box) closes the modal', () => {
    openModal('제목', '내용');
    const overlay = document.getElementById('modal-overlay');
    overlay.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(overlay.classList.contains('open'), false);
  });

  test('showToast appends a toast element with the right class', () => {
    showToast('저장됨', 'success');
    const toast = document.querySelector('.toast');
    assert.ok(toast);
    assert.ok(toast.classList.contains('toast-success'));
    assert.equal(toast.textContent, '저장됨');
  });

  test('renderChipGroup renders one chip per option and marks the selected one', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비', '장보기', '교통비'], '식비', () => {});
    const chips = container.querySelectorAll('.chip');
    assert.equal(chips.length, 4);
    assert.ok(chips[1].classList.contains('chip-selected'));
    assert.equal(chips[0].classList.contains('chip-selected'), false);
  });

  test('renderChipGroup calls onSelect with the clicked option', () => {
    const container = document.createElement('div');
    let selected = null;
    renderChipGroup(container, ['숙박', '식비'], '숙박', (opt) => { selected = opt; });
    container.querySelectorAll('.chip')[1].click();
    assert.equal(selected, '식비');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test public/test/ui.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
function getModalRoot() {
  let overlay = document.getElementById('modal-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <span class="modal-title"></span>
        <button type="button" class="modal-close" aria-label="닫기">&times;</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  document.body.appendChild(overlay);
  return overlay;
}

function openModal(titleHTML, bodyHTML) {
  const overlay = getModalRoot();
  overlay.querySelector('.modal-title').textContent = titleHTML;
  overlay.querySelector('.modal-body').innerHTML = bodyHTML;
  overlay.classList.add('open');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('open');
}

function showToast(message, kind = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function renderChipGroup(container, options, selected, onSelect) {
  container.innerHTML = '';
  container.className = 'chip-group';
  options.forEach((opt) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (opt === selected ? ' chip-selected' : '');
    chip.textContent = opt;
    chip.addEventListener('click', () => onSelect(opt));
    container.appendChild(chip);
  });
}

export { openModal, closeModal, showToast, renderChipGroup };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test public/test/ui.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add public/ui.js public/test/ui.test.js
git commit -m "feat(frontend): add shared modal/toast/chip-group UI components"
```

---

### Task 6: Router (`app.js`)

**Files:**
- Create: `public/app.js`
- Test: `public/test/router.test.js`

**Interfaces:**
- Produces: `matchRoute(pathname) => {view: string, params: object}` (exported for testing) where `view` is one of `'superadmin' | 'trip' | 'admin' | 'report' | 'notfound'`. `app.js`'s top-level code (not exported, not unit-tested — verified manually in Task 13) reads `location.pathname`, calls `matchRoute`, dynamically imports the matching view module from `./views/`, and calls its exported `mount(params)` function into `#app`.

- [ ] **Step 1: Write the failing test for `matchRoute`**

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute } from '../app.js';

describe('matchRoute', () => {
  test('routes /sa/<anything> to the superadmin view', () => {
    assert.deepEqual(matchRoute('/sa/9f2k7'), { view: 'superadmin', params: {} });
  });

  test('routes /t/<slug> to the trip view (login or member, resolved at runtime)', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026'), { view: 'trip', params: { slug: 'sfa-2026' } });
  });

  test('routes /t/<slug>/admin to the admin view', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026/admin'), { view: 'admin', params: { slug: 'sfa-2026' } });
  });

  test('routes /t/<slug>/report to the report view', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026/report'), { view: 'report', params: { slug: 'sfa-2026' } });
  });

  test('trailing slash on /t/<slug>/ still routes to trip', () => {
    assert.deepEqual(matchRoute('/t/sfa-2026/'), { view: 'trip', params: { slug: 'sfa-2026' } });
  });

  test('an unrecognized path routes to notfound', () => {
    assert.deepEqual(matchRoute('/something/else'), { view: 'notfound', params: {} });
  });

  test('the bare root path routes to notfound', () => {
    assert.deepEqual(matchRoute('/'), { view: 'notfound', params: {} });
  });

  test('/sa with no trailing segment routes to notfound', () => {
    assert.deepEqual(matchRoute('/sa'), { view: 'notfound', params: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/test/router.test.js`
Expected: FAIL — module not found (or `matchRoute` undefined, since `app.js` doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```js
import { getSession } from './session.js';

function matchRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (parts[0] === 'sa' && parts[1]) {
    return { view: 'superadmin', params: {} };
  }

  if (parts[0] === 't' && parts[1]) {
    const slug = parts[1];
    if (parts[2] === 'admin') return { view: 'admin', params: { slug } };
    if (parts[2] === 'report') return { view: 'report', params: { slug } };
    if (!parts[2]) return { view: 'trip', params: { slug } };
  }

  return { view: 'notfound', params: {} };
}

async function mount() {
  const { view, params } = matchRoute(location.pathname);
  const root = document.getElementById('app');

  if (view === 'notfound') {
    root.innerHTML = '<div class="container center" style="padding:4rem 0"><h2>페이지를 찾을 수 없습니다</h2></div>';
    return;
  }

  if (view === 'superadmin') {
    const mod = await import('./views/superadmin.js');
    mod.mount(root, params);
    return;
  }

  if (view === 'admin') {
    const mod = await import('./views/admin.js');
    mod.mount(root, params);
    return;
  }

  if (view === 'report') {
    const mod = await import('./views/report.js');
    mod.mount(root, params);
    return;
  }

  // view === 'trip': show login if no matching session, otherwise the member view.
  const session = getSession();
  if (session && session.tripSlug === params.slug && (session.role === 'member' || session.role === 'admin')) {
    const mod = await import('./views/member.js');
    mod.mount(root, params);
  } else {
    const mod = await import('./views/login.js');
    mod.mount(root, params);
  }
}

// Errors here mean document/location aren't available (e.g. this module was
// imported from a Node test for its `matchRoute` export, not run in a browser) —
// swallow rather than surface as an unhandled rejection in either context.
mount().catch(() => {});

export { matchRoute };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test public/test/router.test.js`
Expected: PASS (8 tests)

Note: importing `app.js` for the `matchRoute` test also executes its top-level `mount()` call. Since `router.test.js` doesn't set up jsdom globals, `document`/`location` are undefined inside `mount()`, but the `.catch(() => {})` above absorbs that rejection — the test only asserts on the synchronously-exported `matchRoute` function and is unaffected either way.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/test/router.test.js
git commit -m "feat(frontend): add history-API router with dynamic view imports"
```

---

### Task 7: Backend gaps found while designing the frontend

Designing the admin console and login views surfaced two gaps in Plan 1's function surface. Both are small, additive backend changes — fix both in this one task before building the views that depend on them.

**Gap A:** Plan 1 has `listMembersForLogin` (public, returns only `{id, name}` for the pre-login roster dropdown) but no function returns full member records (`weight`, `excludedCategories`, `account`) for the admin's 구성원 management tab. `getReportData` happens to include full member data, but calling it just to list members would be wasteful (it computes a full settlement) and is semantically mismatched.

**Gap B:** `createSession` (and therefore `verifyAdminPin`/`verifyMemberPin`/`verifySuperadminPassword`, which all return its result directly) currently returns only `{token, expiresAt}`. The frontend needs `tripId` (to pass as `tripId` on every subsequent trip-scoped call — Firestore rejects a call built around `tripId: undefined`) and `memberId` (for a member session, to know which expenses are "mine"). These are already stored server-side in the session document; they just aren't returned to the caller that just logged in.

**Files:**
- Modify: `functions/src/lib/sessions.js` (Gap B)
- Modify: `functions/test/lib/sessions.test.js` (Gap B)
- Modify: `functions/src/functions/members.js` (Gap A)
- Modify: `functions/test/functions/members.test.js` (Gap A)
- Modify: `functions/index.js` (Gap A)

**Interfaces:**
- Produces: `createSession(db, {role, tripId, memberId}) => Promise<{token, expiresAt, role, tripId, memberId}>` (extends the existing return shape — every existing caller that destructures only `{token}` is unaffected). `listMembers(db, {sessionToken, tripId}) => Promise<Array<{id, name, weight, excludedCategories, account}>>` — admin-only, trip-scoped.

- [ ] **Step 1: Write the failing test for Gap B**

Add to `functions/test/lib/sessions.test.js`, alongside the existing `createSession`/`requireSession` tests (this file already uses `describe`/`test`/`expect`):

```js
test('createSession returns role, tripId, and memberId alongside the token', async () => {
  const db = new FakeFirestore();
  const result = await createSession(db, { role: 'member', tripId: 'trip1', memberId: 'm1' });
  expect(result).toEqual({
    token: result.token,
    expiresAt: result.expiresAt,
    role: 'member',
    tripId: 'trip1',
    memberId: 'm1',
  });
});

test('createSession returns null tripId/memberId for a superadmin session', async () => {
  const db = new FakeFirestore();
  const result = await createSession(db, { role: 'superadmin' });
  expect(result.tripId).toBeNull();
  expect(result.memberId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx jest test/lib/sessions.test.js`
Expected: FAIL — `result.role` etc. are `undefined`.

- [ ] **Step 3: Update `createSession` in `functions/src/lib/sessions.js`**

Change only the final line's return value:

```js
async function createSession(db, { role, tripId = null, memberId = null }) {
  if (SESSION_TTL_MS[role] === undefined) {
    throw new Error('INVALID_ROLE');
  }

  const token = generateToken();
  const expiresAt = Date.now() + SESSION_TTL_MS[role];
  await db.collection('sessions').doc(token).set({ role, tripId, memberId, expiresAt });
  return { token, expiresAt, role, tripId, memberId };
}
```

- [ ] **Step 4: Run test to verify it passes, then run the full backend suite**

Run: `cd functions && npx jest test/lib/sessions.test.js && npm test`
Expected: the 2 new tests pass, and the full suite (every existing test that destructures `{token}` or `{token, expiresAt}` from `createSession`) still passes unchanged — the added fields are additive.

- [ ] **Step 5: Commit Gap B**

```bash
git add functions/src/lib/sessions.js functions/test/lib/sessions.test.js
git commit -m "feat(functions): return role/tripId/memberId from createSession"
```

- [ ] **Step 6: Write the failing tests for Gap A**

Add to `functions/test/functions/members.test.js`, alongside the existing tests (reusing the file's existing `FakeFirestore`/`createSession`/`addMember` imports at the top — add `listMembers` to the `require('../../src/functions/members')` line):

```js
test('listMembers returns full member records for an admin session', async () => {
  const db = new FakeFirestore();
  const { token } = await createSession(db, { role: 'admin', tripId: 't1' });
  await addMember(db, { sessionToken: token, tripId: 't1', name: '슬기', weight: 1.5, excludedCategories: ['식비'] });

  const result = await listMembers(db, { sessionToken: token, tripId: 't1' });

  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('슬기');
  expect(result[0].weight).toBe(1.5);
  expect(result[0].excludedCategories).toEqual(['식비']);
  expect(result[0].id).toBeDefined();
});

test('listMembers requires an admin session, not a member session', async () => {
  const db = new FakeFirestore();
  const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });
  await expect(listMembers(db, { sessionToken: token, tripId: 't1' })).rejects.toThrow('FORBIDDEN');
});

test('listMembers rejects a session scoped to a different trip', async () => {
  const db = new FakeFirestore();
  const { token } = await createSession(db, { role: 'admin', tripId: 'other-trip' });
  await expect(listMembers(db, { sessionToken: token, tripId: 't1' })).rejects.toThrow('FORBIDDEN');
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd functions && npx jest test/functions/members.test.js`
Expected: FAIL — `listMembers is not a function` / not exported.

- [ ] **Step 8: Add the implementation to `functions/src/functions/members.js`**

```js
async function listMembers(db, data) {
  await requireSession(db, data.sessionToken, ['admin'], data.tripId);
  const membersRef = db.collection('trips').doc(data.tripId).collection('members');
  const snap = await membersRef.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
```

Add `listMembers` to the file's `module.exports`.

- [ ] **Step 9: Run test to verify it passes**

Run: `cd functions && npx jest test/functions/members.test.js`
Expected: PASS (all tests including the 3 new ones)

- [ ] **Step 10: Wire into `functions/index.js`**

Add, alongside the existing `addMember`/`updateMember` exports:

```js
exports.listMembers = onCall(wrap(members.listMembers));
```

- [ ] **Step 11: Run the full backend suite**

Run: `cd functions && npm test`
Expected: all suites pass, no regressions.

- [ ] **Step 12: Commit Gap A**

```bash
git add functions/src/functions/members.js functions/test/functions/members.test.js functions/index.js
git commit -m "feat(functions): add listMembers for the admin member-management tab"
```

---

### Task 8: Superadmin view (`views/superadmin.js`)

**Files:**
- Create: `public/views/superadmin.js`

**Interfaces:**
- Consumes: `callFunction`/`logout` (Task 4), `getSession`/`setSession` (Task 3), `openModal`/`closeModal`/`showToast` (Task 5).
- Produces: `mount(root, params) => void` — the shape every view module exports, called by `app.js`'s router.

No automated test for this task (it's DOM-rendering + network-call glue with no meaningful pure-logic subset to extract) — verified manually in Task 13 via the running emulator.

- [ ] **Step 1: Write `public/views/superadmin.js`**

```js
import { callFunction, logout } from '../api.js';
import { getSession, setSession } from '../session.js';
import { openModal, closeModal, showToast } from '../ui.js';

function mount(root) {
  const session = getSession();
  if (session && session.role === 'superadmin') {
    renderDashboard(root);
  } else {
    renderLogin(root);
  }
}

function renderLogin(root) {
  root.innerHTML = `
    <div class="container" style="max-width:360px;padding-top:4rem">
      <h2>슈퍼어드민</h2>
      <div class="field">
        <label class="label">비밀번호</label>
        <input type="password" class="input" id="sa-password" autocomplete="current-password">
      </div>
      <button type="button" class="btn btn-primary btn-block" id="sa-login-btn">로그인</button>
      <p class="muted" id="sa-error" style="margin-top:0.75rem;font-size:13px"></p>
    </div>`;

  document.getElementById('sa-login-btn').addEventListener('click', async () => {
    const password = document.getElementById('sa-password').value;
    try {
      const result = await callFunction('verifySuperadminPassword', { password });
      setSession({ token: result.token, expiresAt: result.expiresAt, role: 'superadmin', tripId: null, tripSlug: null, memberId: null });
      renderDashboard(root);
    } catch (err) {
      document.getElementById('sa-error').textContent = err.message;
    }
  });
}

async function renderDashboard(root) {
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>여행 목록</h2>
        <div>
          <button type="button" class="btn btn-primary" id="sa-new-trip">새 여행 만들기</button>
          <button type="button" class="btn btn-secondary" id="sa-logout">로그아웃</button>
        </div>
      </div>
      <div id="sa-trip-list"></div>
    </div>`;

  document.getElementById('sa-new-trip').addEventListener('click', () => openCreateTripModal(root));
  document.getElementById('sa-logout').addEventListener('click', logout);
  await loadTrips(root);
}

async function loadTrips(root) {
  const trips = await callFunction('listTrips', {});
  const listEl = root.querySelector('#sa-trip-list');
  if (trips.length === 0) {
    listEl.innerHTML = '<p class="muted" style="margin-top:1rem">아직 생성된 여행이 없습니다.</p>';
    return;
  }
  listEl.innerHTML = `
    <table style="width:100%;margin-top:1rem;border-collapse:collapse">
      <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)">
        <th style="padding:0.5rem">이름</th><th>slug</th><th>그룹</th><th>상태</th><th></th>
      </tr></thead>
      <tbody>
        ${trips.map((t) => `
          <tr style="border-top:1px solid var(--rule)" data-trip-id="${t.id}">
            <td style="padding:0.6rem 0.5rem">${t.name}</td>
            <td class="mono">${t.slug}</td>
            <td>${t.group}</td>
            <td>${t.status}</td>
            <td><button type="button" class="btn btn-secondary sa-reissue" data-trip-id="${t.id}">PIN 재발급</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  listEl.querySelectorAll('.sa-reissue').forEach((btn) => {
    btn.addEventListener('click', () => openReissueModal(root, btn.dataset.tripId));
  });
}

function openCreateTripModal(root) {
  openModal('새 여행 만들기', `
    <div class="field"><label class="label">여행 이름</label><input class="input" id="ct-name"></div>
    <div class="field"><label class="label">slug (URL용)</label><input class="input" id="ct-slug"></div>
    <div class="field"><label class="label">그룹명</label><input class="input" id="ct-group"></div>
    <div class="field"><label class="label">관리자 PIN</label><input class="input" id="ct-admin-pin"></div>
    <div class="field"><label class="label">일반 PIN</label><input class="input" id="ct-member-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="ct-submit">생성</button>
    <p class="muted" id="ct-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  document.getElementById('ct-submit').addEventListener('click', async () => {
    try {
      await callFunction('createTrip', {
        name: document.getElementById('ct-name').value,
        slug: document.getElementById('ct-slug').value,
        group: document.getElementById('ct-group').value,
        adminPin: document.getElementById('ct-admin-pin').value,
        memberPin: document.getElementById('ct-member-pin').value,
      });
      closeModal();
      showToast('여행이 생성되었습니다', 'success');
      await loadTrips(root);
    } catch (err) {
      document.getElementById('ct-error').textContent = err.message;
    }
  });
}

function openReissueModal(root, tripId) {
  openModal('PIN 재발급', `
    <div class="field"><label class="label">새 관리자 PIN (선택)</label><input class="input" id="ri-admin-pin"></div>
    <div class="field"><label class="label">새 일반 PIN (선택)</label><input class="input" id="ri-member-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="ri-submit">저장</button>
    <p class="muted" id="ri-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  document.getElementById('ri-submit').addEventListener('click', async () => {
    const patch = {};
    const adminPin = document.getElementById('ri-admin-pin').value;
    const memberPin = document.getElementById('ri-member-pin').value;
    if (adminPin) patch.adminPin = adminPin;
    if (memberPin) patch.memberPin = memberPin;

    try {
      await callFunction('updateTrip', { tripId, patch });
      closeModal();
      showToast('PIN이 재발급되었습니다. 기존 세션은 모두 로그아웃됩니다.', 'success');
      await loadTrips(root);
    } catch (err) {
      document.getElementById('ri-error').textContent = err.message;
    }
  });
}

export { mount };
```

- [ ] **Step 2: Commit**

```bash
git add public/views/superadmin.js
git commit -m "feat(frontend): add superadmin login and trip management view"
```

---

### Task 9: Login view (`views/login.js`)

**Files:**
- Create: `public/views/login.js`

**Interfaces:**
- Consumes: `callFunction`, `setSession`.
- Produces: `mount(root, params: {slug}) => void`.

No automated test (DOM/network glue) — verified manually in Task 13.

- [ ] **Step 1: Write `public/views/login.js`**

```js
import { callFunction } from '../api.js';
import { setSession } from '../session.js';

let currentTab = 'admin';

function mount(root, { slug }) {
  render(root, slug);
}

function render(root, slug) {
  root.innerHTML = `
    <div class="container" style="max-width:360px;padding-top:4rem">
      <h2>여행 로그인</h2>
      <div class="tabs">
        <button type="button" class="tab ${currentTab === 'admin' ? 'active' : ''}" data-tab="admin">관리자로 입장</button>
        <button type="button" class="tab ${currentTab === 'member' ? 'active' : ''}" data-tab="member">참가자로 입장</button>
      </div>
      <div id="login-form"></div>
      <p class="muted" id="login-error" style="margin-top:0.75rem;font-size:13px"></p>
    </div>`;

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      render(root, slug);
    });
  });

  if (currentTab === 'admin') renderAdminForm(root, slug);
  else renderMemberForm(root, slug);
}

function renderAdminForm(root, slug) {
  root.querySelector('#login-form').innerHTML = `
    <div class="field"><label class="label">관리자 PIN</label><input type="password" class="input" id="login-admin-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="login-admin-submit">입장</button>`;

  document.getElementById('login-admin-submit').addEventListener('click', async () => {
    try {
      const result = await callFunction('verifyAdminPin', { slug, pin: document.getElementById('login-admin-pin').value });
      setSession({ token: result.token, expiresAt: result.expiresAt, role: 'admin', tripId: result.tripId ?? null, tripSlug: slug, memberId: null });
      location.href = `/t/${slug}/admin`;
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  });
}

async function renderMemberForm(root, slug) {
  const formEl = root.querySelector('#login-form');
  formEl.innerHTML = `<p class="muted">구성원 목록을 불러오는 중...</p>`;

  let members = [];
  try {
    members = await callFunction('listMembersForLogin', { slug });
  } catch (err) {
    formEl.innerHTML = `<p class="muted">${err.message}</p>`;
    return;
  }

  formEl.innerHTML = `
    <div class="field">
      <label class="label">이름</label>
      <select class="input" id="login-member-select">
        <option value="">선택하세요</option>
        ${members.map((m) => `<option value="${m.id}" data-name="${m.name}">${m.name}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label class="label">일반 PIN</label><input type="password" class="input" id="login-member-pin"></div>
    <button type="button" class="btn btn-primary btn-block" id="login-member-submit">입장</button>`;

  document.getElementById('login-member-submit').addEventListener('click', async () => {
    const select = document.getElementById('login-member-select');
    const name = select.selectedOptions[0]?.dataset.name;
    if (!name) {
      document.getElementById('login-error').textContent = '이름을 선택해주세요.';
      return;
    }
    try {
      const result = await callFunction('verifyMemberPin', { slug, name, pin: document.getElementById('login-member-pin').value });
      setSession({ token: result.token, expiresAt: result.expiresAt, role: 'member', tripId: result.tripId ?? null, tripSlug: slug, memberId: result.memberId ?? null });
      location.href = `/t/${slug}`;
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  });
}

export { mount };
```

This relies on Task 7 (Gap B) having already changed `createSession` — and therefore `verifyAdminPin`/`verifyMemberPin`'s response, since both return its result directly — to include `tripId`/`memberId`. Task 7 must be completed before this task.

- [ ] **Step 2: Commit**

```bash
git add public/views/login.js
git commit -m "feat(frontend): add trip login view with admin/member tabs"
```

---

### Task 10: Admin console (`views/admin.js`)

**Files:**
- Create: `public/views/admin.js`

**Interfaces:**
- Consumes: `callFunction`/`logout`, `getSession`, `openModal`/`closeModal`/`showToast`/`renderChipGroup`.
- Produces: `mount(root, params: {slug}) => void`.

No automated test (DOM/network glue) — verified manually in Task 13.

- [ ] **Step 1: Write `public/views/admin.js`**

```js
import { callFunction, logout } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, renderChipGroup } from '../ui.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비'];
let currentTab = 'setup';
let membersCache = [];

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.role !== 'admin' || session.tripSlug !== slug) {
    location.href = `/t/${slug}`;
    return;
  }
  render(root, slug);
}

function render(root, slug) {
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>관리자 콘솔</h2>
        <button type="button" class="btn btn-secondary" id="admin-logout">로그아웃</button>
      </div>
      <div class="tabs">
        <button type="button" class="tab ${currentTab === 'setup' ? 'active' : ''}" data-tab="setup">여행정보</button>
        <button type="button" class="tab ${currentTab === 'members' ? 'active' : ''}" data-tab="members">구성원</button>
        <button type="button" class="tab ${currentTab === 'expenses' ? 'active' : ''}" data-tab="expenses">경비확인</button>
        <button type="button" class="tab" data-tab="report">리포트</button>
      </div>
      <div id="admin-tab-body"></div>
    </div>`;

  document.getElementById('admin-logout').addEventListener('click', logout);

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'report') { location.href = `/t/${slug}/report`; return; }
      currentTab = tab.dataset.tab;
      render(root, slug);
    });
  });

  const body = root.querySelector('#admin-tab-body');
  if (currentTab === 'setup') renderSetupTab(body, slug);
  else if (currentTab === 'members') renderMembersTab(body, slug);
  else renderExpensesTab(body, slug);
}

async function renderSetupTab(body, slug) {
  const session = getSession();
  const trip = await callFunction('getTripSetup', { tripId: session.tripId });
  body.innerHTML = `
    <div class="field"><label class="label">기간 시작</label><input type="date" class="input" id="setup-start" value="${trip.period?.start || ''}"></div>
    <div class="field"><label class="label">기간 종료</label><input type="date" class="input" id="setup-end" value="${trip.period?.end || ''}"></div>
    <div class="field"><label class="label">장소</label><input class="input" id="setup-location" value="${trip.location || ''}"></div>
    <div class="field"><label class="label">숙박지</label><input class="input" id="setup-lodging" value="${trip.lodging || ''}"></div>
    <button type="button" class="btn btn-primary" id="setup-save">저장</button>`;

  document.getElementById('setup-save').addEventListener('click', async () => {
    try {
      await callFunction('updateTripSetup', {
        tripId: session.tripId,
        patch: {
          period: { start: document.getElementById('setup-start').value, end: document.getElementById('setup-end').value },
          location: document.getElementById('setup-location').value,
          lodging: document.getElementById('setup-lodging').value,
        },
      });
      showToast('저장되었습니다', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function renderMembersTab(body, slug) {
  const session = getSession();
  membersCache = await callFunction('listMembers', { tripId: session.tripId });

  body.innerHTML = `
    <button type="button" class="btn btn-primary" id="members-add" style="margin-bottom:1rem">구성원 추가</button>
    <div id="members-list"></div>`;

  document.getElementById('members-add').addEventListener('click', () => openMemberModal(body, slug, null));
  renderMembersList(body, slug);
}

function renderMembersList(body, slug) {
  body.querySelector('#members-list').innerHTML = membersCache.map((m) => `
    <div class="card" style="margin-bottom:0.6rem;display:flex;justify-content:space-between;align-items:center">
      <div>
        <strong>${m.name}</strong>
        <span class="muted" style="font-size:12px;margin-left:0.5rem">가중치 ${m.weight}${m.excludedCategories.length ? ' · 제외: ' + m.excludedCategories.join(', ') : ''}</span>
      </div>
      <button type="button" class="btn btn-secondary member-edit" data-id="${m.id}">수정</button>
    </div>`).join('');

  body.querySelectorAll('.member-edit').forEach((btn) => {
    btn.addEventListener('click', () => openMemberModal(body, slug, membersCache.find((m) => m.id === btn.dataset.id)));
  });
}

function openMemberModal(body, slug, member) {
  const isEdit = !!member;
  openModal(isEdit ? '구성원 수정' : '구성원 추가', `
    <div class="field"><label class="label">이름</label><input class="input" id="mm-name" value="${member?.name || ''}"></div>
    <div class="field"><label class="label">정산 가중치</label><input type="number" step="0.1" class="input" id="mm-weight" value="${member?.weight ?? 1}"></div>
    <div class="field">
      <label class="label">제외 카테고리</label>
      <div id="mm-excluded"></div>
    </div>
    <button type="button" class="btn btn-primary btn-block" id="mm-submit">${isEdit ? '저장' : '추가'}</button>
    <p class="muted" id="mm-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  let excluded = new Set(member?.excludedCategories || []);
  function renderExcludedChips() {
    document.querySelectorAll('#mm-excluded .chip').forEach((chip) => {
      chip.classList.toggle('chip-selected', excluded.has(chip.textContent));
    });
  }
  renderChipGroup(document.getElementById('mm-excluded'), CATEGORIES, null, (category) => {
    if (excluded.has(category)) excluded.delete(category); else excluded.add(category);
    renderExcludedChips();
  });
  renderExcludedChips();

  document.getElementById('mm-submit').addEventListener('click', async () => {
    const session = getSession();
    const name = document.getElementById('mm-name').value;
    const weight = Number(document.getElementById('mm-weight').value);
    try {
      if (isEdit) {
        await callFunction('updateMember', { tripId: session.tripId, memberId: member.id, patch: { name, weight, excludedCategories: [...excluded] } });
      } else {
        await callFunction('addMember', { tripId: session.tripId, name, weight, excludedCategories: [...excluded] });
      }
      closeModal();
      membersCache = await callFunction('listMembers', { tripId: session.tripId });
      renderMembersList(body, slug);
    } catch (err) {
      document.getElementById('mm-error').textContent = err.message;
    }
  });
}

async function renderExpensesTab(body, slug) {
  const session = getSession();
  const [expenses, members] = await Promise.all([
    callFunction('listExpenses', { tripId: session.tripId }),
    callFunction('listMembersForLogin', { slug }),
  ]);
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  body.innerHTML = `
    <button type="button" class="btn btn-primary" id="expense-add" style="margin-bottom:1rem">경비 입력</button>
    <div id="expenses-list"></div>`;

  document.getElementById('expenses-list').innerHTML = expenses.map((e) => `
    <div class="card" style="margin-bottom:0.6rem">
      <div style="display:flex;justify-content:space-between">
        <div>
          <span class="tag">${e.category}</span>
          <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
          <span class="muted" style="font-size:12px;margin-left:0.5rem">${e.date} · ${nameById[e.enteredBy] || '?'}</span>
          ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">컴펌됨</span>' : ''}
        </div>
        <div>
          <button type="button" class="btn btn-secondary expense-confirm" data-id="${e.id}" data-confirmed="${e.confirmed}">${e.confirmed ? '컴펌 해제' : '컴펌'}</button>
          <button type="button" class="btn btn-danger expense-delete" data-id="${e.id}">삭제</button>
        </div>
      </div>
      <p class="muted" style="font-size:13px;margin-top:0.4rem">${e.merchant || ''} ${e.detail || ''}</p>
    </div>`).join('');

  body.querySelectorAll('.expense-confirm').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await callFunction('confirmExpense', { tripId: session.tripId, expenseId: btn.dataset.id, confirmed: btn.dataset.confirmed !== 'true' });
      renderExpensesTab(body, slug);
    });
  });
  body.querySelectorAll('.expense-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await callFunction('deleteExpense', { tripId: session.tripId, expenseId: btn.dataset.id });
      renderExpensesTab(body, slug);
    });
  });
  document.getElementById('expense-add').addEventListener('click', () => openAdminExpenseModal(body, slug, members));
}

function openAdminExpenseModal(body, slug, members) {
  let category = CATEGORIES[1];
  let photoBase64 = null;
  let mimeType = null;

  openModal('경비 입력', `
    <div class="field"><label class="label">사진</label><input type="file" accept="image/*" capture="environment" id="ae-photo"></div>
    <div id="ae-photo-preview"></div>
    <div class="field"><label class="label">입력 귀속 대상</label>
      <select class="input" id="ae-member">${members.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select>
    </div>
    <div class="field"><label class="label">카테고리</label><div id="ae-category"></div></div>
    <div class="field"><label class="label">날짜</label><input type="date" class="input" id="ae-date"></div>
    <div class="field"><label class="label">금액</label><input type="number" class="input" id="ae-amount"></div>
    <div class="field"><label class="label">상호명</label><input class="input" id="ae-merchant"></div>
    <div class="field"><label class="label">세부사항</label><input class="input" id="ae-detail"></div>
    <button type="button" class="btn btn-primary btn-block" id="ae-submit">입력 완료</button>
    <p class="muted" id="ae-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  function rerenderCategoryChips() {
    renderChipGroup(document.getElementById('ae-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderCategoryChips();
    });
  }
  rerenderCategoryChips();

  document.getElementById('ae-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    mimeType = file.type;
    photoBase64 = await fileToBase64(file);
    document.getElementById('ae-photo-preview').innerHTML = `<img src="data:${mimeType};base64,${photoBase64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`;

    try {
      const session = getSession();
      const classification = await callFunction('classifyReceipt', { tripId: session.tripId, photoBase64, mimeType });
      if (classification.category) { category = classification.category; rerenderCategoryChips(); }
      if (classification.date) document.getElementById('ae-date').value = classification.date;
      if (classification.amount) document.getElementById('ae-amount').value = classification.amount;
      if (classification.merchant) document.getElementById('ae-merchant').value = classification.merchant;
      if (classification.detail) document.getElementById('ae-detail').value = classification.detail;
      document.getElementById('ae-photo').dataset.photoUrl = classification.photoUrl;
    } catch (err) {
      showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
    }
  });

  document.getElementById('ae-submit').addEventListener('click', async () => {
    const session = getSession();
    try {
      await callFunction('addExpense', {
        tripId: session.tripId,
        enteredBy: document.getElementById('ae-member').value,
        category,
        date: document.getElementById('ae-date').value,
        amount: Number(document.getElementById('ae-amount').value),
        merchant: document.getElementById('ae-merchant').value,
        detail: document.getElementById('ae-detail').value,
        photoUrl: document.getElementById('ae-photo').dataset.photoUrl || null,
      });
      closeModal();
      renderExpensesTab(body, slug);
    } catch (err) {
      document.getElementById('ae-error').textContent = err.message;
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export { mount };
```

- [ ] **Step 2: Commit**

```bash
git add public/views/admin.js
git commit -m "feat(frontend): add tabbed admin console (setup, members, expenses)"
```

---

### Task 11: Member view (`views/member.js`)

**Files:**
- Create: `public/views/member.js`

**Interfaces:**
- Consumes: `callFunction`/`logout`, `getSession`, `openModal`/`closeModal`/`showToast`/`renderChipGroup`.
- Produces: `mount(root, params: {slug}) => void`.

No automated test (DOM/network glue) — verified manually in Task 13.

- [ ] **Step 1: Write `public/views/member.js`**

Reuse the exact `openExpenseModal`/`fileToBase64` pattern from Task 10's admin expense-entry modal, with two differences: no "입력 귀속 대상" field (the member's own `session.memberId` is used as `enteredBy` automatically — the backend already forces this for `member`-role sessions regardless of what's sent, so the field can be omitted from the payload entirely), and the edit/delete permission check is client-side UI only (hide edit/delete controls on expenses not owned by the current member or already confirmed — the backend is the actual enforcement boundary per Plan 1, this is purely so the member doesn't see controls that would just error).

```js
import { callFunction, logout } from '../api.js';
import { getSession } from '../session.js';
import { openModal, closeModal, showToast, renderChipGroup } from '../ui.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비'];

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) {
    location.href = `/t/${slug}`;
    return;
  }
  render(root, slug);
}

async function render(root, slug) {
  const session = getSession();
  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>경비 목록</h2>
        <div>
          <button type="button" class="btn btn-primary" id="member-add-expense">경비 입력</button>
          <button type="button" class="btn btn-secondary" id="member-logout">로그아웃</button>
        </div>
      </div>
      <div id="member-expenses-list" style="margin-top:1rem"></div>
      <p class="center" style="margin-top:2rem"><a href="/t/${slug}/report">리포트 보기 →</a></p>
    </div>`;

  document.getElementById('member-add-expense').addEventListener('click', () => openExpenseModal(root, slug));
  document.getElementById('member-logout').addEventListener('click', logout);
  await loadExpenses(root, slug);
}

async function loadExpenses(root, slug) {
  const session = getSession();
  const [expenses, members] = await Promise.all([
    callFunction('listExpenses', { tripId: session.tripId }),
    callFunction('listMembersForLogin', { slug }),
  ]);
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  root.querySelector('#member-expenses-list').innerHTML = expenses.map((e) => {
    const isMine = e.enteredBy === session.memberId;
    const canEdit = isMine && !e.confirmed;
    return `
      <div class="card" style="margin-bottom:0.6rem;${e.confirmed ? 'opacity:0.7' : ''}">
        <div style="display:flex;justify-content:space-between">
          <div>
            <span class="tag">${e.category}</span>
            <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
            <span class="muted" style="font-size:12px;margin-left:0.5rem">${e.date} · ${nameById[e.enteredBy] || '?'}</span>
            ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">🔒 컴펌됨</span>' : ''}
          </div>
          ${canEdit ? `<button type="button" class="btn btn-secondary member-delete" data-id="${e.id}">삭제</button>` : ''}
        </div>
        <p class="muted" style="font-size:13px;margin-top:0.4rem">${e.merchant || ''} ${e.detail || ''}</p>
      </div>`;
  }).join('');

  root.querySelectorAll('.member-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await callFunction('deleteExpense', { tripId: session.tripId, expenseId: btn.dataset.id });
        await loadExpenses(root, slug);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function openExpenseModal(root, slug) {
  let category = CATEGORIES[1];
  let photoUrl = null;

  openModal('경비 입력', `
    <div class="field"><label class="label">사진</label><input type="file" accept="image/*" capture="environment" id="me-photo"></div>
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

  document.getElementById('me-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const mimeType = file.type;
    const photoBase64 = await fileToBase64(file);
    document.getElementById('me-photo-preview').innerHTML = `<img src="data:${mimeType};base64,${photoBase64}" style="width:100%;border-radius:4px;margin:0.5rem 0">`;

    try {
      const session = getSession();
      const classification = await callFunction('classifyReceipt', { tripId: session.tripId, photoBase64, mimeType });
      photoUrl = classification.photoUrl;
      if (classification.category) { category = classification.category; rerenderCategoryChips(); }
      if (classification.date) document.getElementById('me-date').value = classification.date;
      if (classification.amount) document.getElementById('me-amount').value = classification.amount;
      if (classification.merchant) document.getElementById('me-merchant').value = classification.merchant;
      if (classification.detail) document.getElementById('me-detail').value = classification.detail;
    } catch (err) {
      showToast('자동 인식 실패 — 직접 입력해주세요', 'error');
    }
  });

  document.getElementById('me-submit').addEventListener('click', async () => {
    const session = getSession();
    try {
      await callFunction('addExpense', {
        tripId: session.tripId,
        category,
        date: document.getElementById('me-date').value,
        amount: Number(document.getElementById('me-amount').value),
        merchant: document.getElementById('me-merchant').value,
        detail: document.getElementById('me-detail').value,
        photoUrl,
      });
      closeModal();
      await loadExpenses(document.getElementById('app'), slug);
    } catch (err) {
      document.getElementById('me-error').textContent = err.message;
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export { mount };
```

- [ ] **Step 2: Commit**

```bash
git add public/views/member.js
git commit -m "feat(frontend): add member expense list and photo-first entry flow"
```

---

### Task 12: Report view (`views/report.js`)

**Files:**
- Create: `public/views/report.js`

**Interfaces:**
- Consumes: `callFunction`, `getSession`.
- Produces: `mount(root, params: {slug}) => void`.

No automated test (DOM/network glue) — verified manually in Task 13.

- [ ] **Step 1: Write `public/views/report.js`**

```js
import { callFunction } from '../api.js';
import { getSession } from '../session.js';

const CATEGORY_COLORS = {
  숙박: '#1a4a6b',
  식비: '#2d7aaa',
  장보기: '#c4874a',
  교통비: '#8a3a1a',
};

function mount(root, { slug }) {
  const session = getSession();
  if (!session || session.tripSlug !== slug) {
    location.href = `/t/${slug}`;
    return;
  }
  render(root, slug);
}

async function render(root, slug) {
  const session = getSession();
  root.innerHTML = '<div class="container center" style="padding-top:4rem"><p class="muted">불러오는 중...</p></div>';

  const data = await callFunction('getReportData', { tripId: session.tripId });
  const { trip, members, expenses, settlement, currentCategoryAverages, groupCategoryAverages, tripsInComparison } = data;
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const confirmedExpenses = expenses.filter((e) => e.confirmed);
  const backHref = session.role === 'admin' ? `/t/${slug}/admin` : `/t/${slug}`;

  root.innerHTML = `
    <div class="container" style="padding-top:2rem">
      <p class="center"><a href="${backHref}">← 돌아가기</a></p>
      <p class="label">Travel Expense Report</p>
      <h1>${trip.name}</h1>
      <p class="muted">${trip.period?.start || ''} — ${trip.period?.end || ''} · ${trip.location || ''} · ${trip.lodging || ''}</p>

      <div class="section">
        <h2>전체 지출 내역</h2>
        ${renderExpenseTable(confirmedExpenses, nameById)}
      </div>

      <div class="section">
        <h2>카테고리 분석</h2>
        ${renderDonutChart(settlement.categoryTotals)}
        ${tripsInComparison > 0 ? renderComparisonBars(currentCategoryAverages, groupCategoryAverages) : '<p class="muted">비교할 과거 여행이 아직 없습니다.</p>'}
      </div>

      <div class="section">
        <h2>결제자별 지출</h2>
        ${renderPayerSummary(settlement.perMember)}
      </div>

      <div class="section">
        <h2>최종 정산</h2>
        ${renderSettlement(settlement.perMember)}
      </div>
    </div>`;
}

function renderExpenseTable(expenses, nameById) {
  return `
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="text-align:left;font-size:11px;color:var(--ink-3)">
        <th style="padding:0.5rem">날짜</th><th>카테고리</th><th>내용</th><th>결제자</th><th style="text-align:right">금액</th>
      </tr></thead>
      <tbody>
        ${expenses.map((e) => `
          <tr style="border-top:1px solid var(--rule)">
            <td style="padding:0.6rem 0.5rem">${e.date}</td>
            <td><span class="tag">${e.category}</span></td>
            <td>${e.merchant || ''} ${e.detail || ''}</td>
            <td>${nameById[e.enteredBy] || '?'}</td>
            <td style="text-align:right" class="mono">${Number(e.amount).toLocaleString()}원</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderDonutChart(categoryTotals) {
  const total = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  if (total <= 0) return '<p class="muted">지출 내역이 없습니다.</p>';

  const r = 40;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const circles = Object.entries(categoryTotals).map(([category, amount]) => {
    const fraction = amount / total;
    const dash = fraction * circumference;
    const circle = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${CATEGORY_COLORS[category] || '#999'}" stroke-width="16" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"></circle>`;
    offset += dash;
    return circle;
  }).join('');

  const legend = Object.entries(categoryTotals).map(([category, amount]) => `
    <div style="display:flex;align-items:center;gap:0.4rem;font-size:12px;margin-bottom:0.3rem">
      <span style="width:10px;height:10px;border-radius:50%;background:${CATEGORY_COLORS[category] || '#999'};display:inline-block"></span>
      ${category} · ${Number(amount).toLocaleString()}원
    </div>`).join('');

  return `
    <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem">
      <svg viewBox="0 0 100 100" width="140" height="140">${circles}</svg>
      <div>${legend}</div>
    </div>`;
}

function renderComparisonBars(currentAverages, groupAverages) {
  return Object.keys(currentAverages).map((category) => {
    const current = currentAverages[category];
    const group = groupAverages[category];
    if (group == null) return '';
    const pct = Math.round(((current - group) / group) * 100);
    const sign = pct >= 0 ? '+' : '';
    const cls = pct >= 0 ? 'pay' : 'receive';
    return `
      <div style="margin-bottom:0.6rem">
        <span class="label">${category}</span>
        <p style="font-size:13px">1인 ${Number(current).toLocaleString()}원 · 그룹 평균 대비
          <strong style="color:var(--${cls})">${sign}${pct}%</strong>
        </p>
      </div>`;
  }).join('');
}

function renderPayerSummary(perMember) {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)">
      ${perMember.map((m) => `
        <div style="background:var(--paper);padding:1rem">
          <p class="label">${m.name}</p>
          <p class="mono" style="font-family:var(--f-display);font-size:1.3rem;font-weight:700">${m.paid.toLocaleString()}</p>
        </div>`).join('')}
    </div>`;
}

function renderSettlement(perMember) {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)">
      ${perMember.map((m) => `
        <div style="background:var(--paper);padding:1rem">
          <p style="font-family:var(--f-kr);font-weight:500">${m.name}</p>
          <p class="muted" style="font-size:12px">내야 할 금액 ${m.due.toLocaleString()}원 · 실제 지출 ${m.paid.toLocaleString()}원</p>
          <p class="mono" style="font-family:var(--f-display);font-weight:700;color:var(--${m.net >= 0 ? 'receive' : 'pay'})">${m.net >= 0 ? '+' : ''}${m.net.toLocaleString()}원</p>
        </div>`).join('')}
    </div>`;
}

export { mount };
```

- [ ] **Step 2: Commit**

```bash
git add public/views/report.js
git commit -m "feat(frontend): add report view with category donut chart and group comparison"
```

---

### Task 13: Manual end-to-end verification

**Files:** none created — this task verifies the previous 12 tasks work together in a real browser against the real emulator.

- [ ] **Step 1: Run the full frontend test suite**

Run: `node --test public/test/`
Expected: all tests across `session.test.js`, `api.test.js`, `ui.test.js`, `router.test.js` pass.

- [ ] **Step 2: Run the full backend test suite** (confirm Task 7's addition didn't regress anything)

Run: `cd functions && npm test`
Expected: all suites pass.

- [ ] **Step 3: Start the full emulator suite including Hosting**

```bash
export PATH="/c/Users/croon/java-portable/jdk-17.0.19+10-jre/bin:$PATH"
npx firebase-tools@14 emulators:start --only functions,firestore,storage,hosting --project demo-sfayw
```

(Use `firebase-tools@14` per Plan 1's finding that `@latest`/v15+ requires Java 21+, which this machine doesn't have. Adjust the Java PATH export to whatever the actual current portable JRE path is if it has changed.)

Expected: "All emulators ready!", with Hosting serving on port 5000 per the `firebase.json` config from Task 1.

- [ ] **Step 4: Use the `run` skill to drive the app in an actual browser**

Invoke the project's `run` skill (or equivalent browser-driving tool available in this environment) pointed at `http://127.0.0.1:5000`, and manually walk the golden path:

1. Navigate to `/sa/anything` → log in with the superadmin password → create a test trip (note the slug).
2. Navigate to `/t/<slug>` → log in as admin → fill in 여행정보 tab → add 2-3 members in 구성원 탭.
3. Log out (clear localStorage or open an incognito-equivalent) → navigate to `/t/<slug>` → log in as a participant using the member tab (confirm the name dropdown is populated) → add an expense with a real or sample photo → confirm the review form is stacked photo-on-top-form-below and shows category chips.
4. Log back in as admin → 경비확인 탭 → confirm the new expense appears → click 컴펌.
5. Navigate to `/t/<slug>/report` → confirm the report renders all sections including the new 카테고리 분석 section with a visible donut chart (even with only one category populated, the chart should render without throwing).

- [ ] **Step 5: Fix anything broken during the manual walkthrough**

This is expected — treat any bug found here as a normal fix, following the same file/commit conventions as earlier tasks. Do not skip re-testing after each fix.

- [ ] **Step 6: Stop the emulator cleanly**

Confirm no orphaned `node`/`java` processes remain (same check Plan 1's Task 14 used).

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "fix(frontend): address issues found during manual end-to-end verification"
```

(Only if Step 5 produced changes — if the walkthrough was clean, skip this commit.)

---

## Plan-Level Verification

```bash
node --test public/test/
cd functions && npm test
```

Expected: every automated test across both the frontend and backend passes, plus the manual walkthrough in Task 13 confirms the actual golden path works end-to-end in a browser against the real (emulated) backend.

## What This Plan Does Not Cover (deferred to Plan 3)

- Migrating the existing `travel_report.html` data and Realtime Database `accounts`/`paid` records into Firestore.
- Deploying to a real Firebase project (real project id replacing `sfayw-prod` in `public/api.js`, real Blaze billing, real secrets, custom domain).
- Choosing and hardening the actual `/sa/<secret-path>` value used in production (any string works functionally; picking one that isn't linked from anywhere is the only requirement).
