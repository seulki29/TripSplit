# Public Trip Index + Superadmin Trip Delete: Design

Date: 2026-07-30
Status: approved in brainstorming.

## Goal

Two owner requests:
- A public index page at `tripsplit-opal.vercel.app/` listing every trip (name, period, location, group, status), so anyone — including an admin who forgot their trip's URL — can browse and click through to `/t/{slug}`, where login is still required to see anything beyond the card.
- Let superadmin delete a trip from the `/sa/superadmin` dashboard.

## Backend reality (verified)
- `superadmin.js`'s `archiveTrip(db, data)` already exists, is superadmin-gated, already registered in `functions/index.js`, and already does a full `db.recursiveDelete(...)` plus `revokeTripSessions` — despite its name, it is a permanent hard delete, not a soft archive. No backend work needed for the delete request; only frontend wiring.
- `listTrips` (superadmin-only) returns every field except the two PIN hashes. There is no unauthenticated trip-listing endpoint today.
- `listMembersForLogin` (`tripAuth.js`) is the codebase's only precedent for an unauthenticated public read; it applies `checkLoginThrottle` per-slug because it exists to gate PIN-guessing traffic. A public trip index has no such threat model (nothing sensitive is returned) and `checkLoginThrottle`'s counter is a single global key per throttle key — sharing one key across every visitor would rate-limit the whole homepage together, which is wrong for a public read endpoint. No throttle is applied here.
- `app.js`'s `matchRoute` has no case for `/` (empty path) today — it falls through to `notfound`.

## Owner-confirmed decisions
- **All trip statuses are shown**, including `setup` (not yet fully configured) — the admin uses the public index as a convenience to find and click into their own trip's login page.
- **Sort:** flat list, newest-first (`createdAt` descending). No grouping by `group`.
- **Card fields:** name, period (start–end), location, group (shown as a tag), and a status badge.
- **Delete confirmation:** no native `confirm()`/`alert()` (project-wide constraint) — an `openModal` confirmation naming the trip, consistent with how every other destructive-feeling action in this app already confirms in-place.

## Items

### #1 Public trip index page

**Backend** — new `functions/src/functions/publicTrips.js`:
- `listPublicTrips(db, data)` — no `requireSession` call (fully public). Queries `trips`, sorts by `createdAt` descending, returns `[{name, slug, group, period, location, status}]`. No `id`, no PIN hashes, no `createdAt` in the response (sort is applied server-side; the client doesn't need the raw timestamp).
- Registered in `functions/index.js` as a plain `onCall(wrap(publicTrips.listPublicTrips))` — same shape as any other `wrap`-based callable, just never calls `requireSession`.

**Frontend**:
- `public/app.js` `matchRoute`: when `parts.length === 0` (path is `/`), return `{ view: 'index', params: {} }`.
- `mount()`: add a branch for `view === 'index'` that dynamically imports and mounts a new `public/views/index.js`.
- New `public/views/index.js`: `mount(root)` calls `listPublicTrips`, renders a card per trip (name as heading, `period.start–period.end · location` line, `group` as a `.tag`, a status badge), each card wrapped in an `<a href="/t/{slug}">` (or a click handler doing `location.href`). Empty state ("아직 생성된 여행이 없습니다") when the list is empty. Load-failure state with a retry button, matching the pattern already used in `report.js`/`member.js`.
- Status badge uses the existing `.badge`/`.badge-locked` classes (already in `style.css`, used by `admin.js`). `admin.js`'s own 여행정보 tab only ever distinguishes completed-vs-not (it shows "진행 중" for both `setup` and `active`), so there is no existing 3-way label to reuse verbatim — the index page adds its own three: `설정중` (setup, plain `.badge`), `진행 중` (active, plain `.badge`), `완료됨` (completed, `.badge-locked`). This is more informative here since `setup` trips are intentionally listed (per the owner's decision above) and a visitor benefits from knowing one isn't ready yet.

### #2 Superadmin trip delete

**Frontend only** — `public/views/superadmin.js`:
- Add a "삭제" button to each row in `loadTrips`'s table, next to the existing "PIN 재발급" button.
- Clicking it opens a confirmation via `openModal`: trip name, a warning that this permanently deletes the trip and all its data and cannot be undone, and a "삭제" confirm button (styled `btn-danger`, matching the pattern already used for delete actions elsewhere in the app, e.g. member/expense delete buttons).
- Confirm → `callFunction('archiveTrip', { tripId })` → `closeModal()` → toast → `loadTrips(root)` to refresh.

## Not included
- Any change to `archiveTrip`'s backend behavior or its name (out of scope; it already does what's needed).
- Pagination or search on the public index (trip count is expected to stay small for a friend-group app).
- Rate limiting on `listPublicTrips` (see Backend reality above for why).

## Testing
- **Backend Jest**: `publicTrips.test.js` — `listPublicTrips` requires no session and succeeds with `sessionToken: undefined`/absent; returns PIN-hash-free, `id`-free records; sorts newest-first; includes `setup`-status trips.
- **Frontend**: no unit-test harness for either new/changed view file (view-layer code, consistent with the rest of `public/views/`); verified by `npm test` staying green plus manual E2E (index page loads and links work; superadmin delete removes a trip and its data).
- **Deploy**: backend changed (`listPublicTrips` is new) → `firebase deploy --only functions`; frontend auto-deploys via Vercel from `main`.
