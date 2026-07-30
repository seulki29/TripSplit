# Plan 8 Design: Trip Photo Gallery + Member Tabbed View

Date: 2026-07-30
Status: approved in brainstorming. Third and last of three plans splitting an 11-item owner request (Plan 6 = quick fixes + expense edit [shipped]; Plan 7 = classify indicator/member account/settlement breakdown/trip-complete [shipped]; Plan 8 = this doc).

## Goal

Two owner requests:
- **#8** Replace the report's 영수증 갤러리 (receipt gallery) with a **여행사진** (trip photo) gallery — photos unrelated to expense receipts, uploaded by anyone on the trip, viewed with a lightbox (prev/next). The old receipt gallery is redundant since Plan 6 made every receipt clickable from its expense card/row.
- **#9** Give the member view the same tab-bar structure the admin view already has, instead of a single flat expense list with a "리포트 보기 →" button swap. Tabs: 경비목록 / 구성원(읽기전용) / 리포트.

## Backend reality (verified)
- `report.js` `listReceiptUrls` queries expenses with `photoPath` and returns signed URLs, backing the 영수증 갤러리 section being removed. Once the frontend no longer calls it, the callable becomes dead code — remove it (backend function, `functions/index.js` export, and its test) rather than leave it unused. See Items below.
- `functions/src/lib/storage.js` `uploadReceiptImage`/`getReceiptReadUrl` take a `bucket` + path; the path is the only receipt-specific part (`receipts/${tripId}/...`). Trip photos reuse the same primitives with a different path prefix.
- `functions/src/functions/members.js` `listMembers` is `requireSession(db, token, ['admin'], tripId)` only. Member-visible account numbers already exist elsewhere (a member's own settlement detail modal shows other members' `account` field from `computeSettlement`'s `perMember`), so exposing the full roster (name/weight/account) to `member` sessions is not a new disclosure.
- `requireTripEditable` (Plan 7) currently guards `addExpense/updateExpense/deleteExpense/confirmExpense/setExpenseExclusions/addMember/updateMember/updateTripSetup`. Trip photos intentionally do **not** get this guard (owner-confirmed: photos are memories, often added after the trip's expenses are finalized and the trip is marked complete).

## Owner-confirmed decisions
- **#8 is a new, separate photo feature**, not a re-skin of the receipt gallery. Receipts stay attached to expenses only.
- **Upload permission**: admin + every member (session-authenticated `['admin','member']`, like `addExpense`).
- **Placement**: a 여행사진 section inside the existing 리포트 tab (both admin and member views render the same `report.js`), not a brand-new top-level tab.
- **Trip-complete lock**: trip photos are exempt from `requireTripEditable` — upload/delete works even when `status === 'completed'`.
- **Delete permission**: the uploader or an admin (mirrors `deleteExpense`'s member-owns-it-or-admin rule; trip photos have no "confirmed" state, so there's no lock window — the uploader can always delete their own).
- **Member tab set**: 경비목록 / 구성원(읽기전용) / 리포트 — no 여행정보 tab for members (they can't edit trip setup).
- **구성원 tab reuse**: a small new read-only render in `member.js`, not a call into `admin.js`'s `renderMembersTab`. Admin's version is parameterized by `locked` (trip-complete) and owns a module-scoped `membersCache` used by its own add/edit modal wiring; forcing member.js's always-read-only case through it would couple two views that should stay independent for different reasons (one is "read-only because completed", the other is "read-only because you're a member").

## Items

### #8 Trip photo gallery + lightbox

**Backend** — new `functions/src/functions/tripPhotos.js`:
- `addTripPhoto(db, bucket, data)` — `data = {sessionToken, tripId, photoBase64, mimeType}`. `requireSession(['admin','member'])`. Validates `mimeType` against the existing `ALLOWED_MIME_TYPES` (reuse/export from `receipts.js`, or duplicate the same list — reuse via import). Uploads via a new `uploadTripPhotoImage(bucket, tripId, base64, mimeType)` in `storage.js` (same body as `uploadReceiptImage` but path `tripPhotos/${tripId}/${random}.${ext}`). Writes a doc to `trips/{tripId}/photos/{photoId}`: `{photoPath, uploadedBy: session.memberId ?? 'admin', createdAt: FieldValue.serverTimestamp()}`. Returns `{id, photoPath}`.
- `listTripPhotos(db, bucket, data)` — `data = {sessionToken, tripId}`. `requireSession(['admin','member'])`. Reads the `photos` subcollection ordered by `createdAt` ascending, resolves each `photoPath` to a read URL via the existing `getReceiptReadUrl(bucket, path)` (generic despite the name — no rename needed, it just signs a path). Returns `[{id, url, uploadedBy, createdAt}]`.
- `deleteTripPhoto(db, bucket, data)` — `data = {sessionToken, tripId, photoId}`. `requireSession(['admin','member'])`. Loads the doc (`PHOTO_NOT_FOUND` if missing); if `session.role === 'member'` and `doc.uploadedBy !== session.memberId`, throw `FORBIDDEN`. Deletes the Storage object (best-effort, same try/catch pattern as `deleteExpense`) then the Firestore doc.
- Register in `functions/index.js` (bucket-wrapped, alongside the receipts exports): `addTripPhoto`, `listTripPhotos`, `deleteTripPhoto`.
- **Remove** `listReceiptUrls` (report.js backend function + its `functions/index.js` export + its test) since the frontend gallery that called it is gone and nothing else uses it.

**Frontend** — `public/views/report.js`:
- Replace the 영수증 갤러리 section with:
  ```html
  <div class="section"><h2>여행사진</h2>
    <input type="file" id="tp-upload" accept="image/jpeg,image/png" style="display:none">
    <button type="button" class="btn btn-secondary" id="tp-upload-btn" style="margin-bottom:0.6rem">사진 추가</button>
    <div id="tp-gallery"><p class="muted">불러오는 중...</p></div>
  </div>
  ```
- On mount, `listTripPhotos` → render a thumbnail grid (same grid style the old gallery used: `repeat(auto-fill,minmax(90px,1fr))`, `object-fit:cover`, `cursor:pointer`), each thumb `data-index`.
- Upload button → hidden file input → `fileToBase64` (existing helper, currently local to `member.js`/`admin.js`; move it to a shared spot — simplest is a small export from `ui.js` since three views now need it) → `addTripPhoto` → prepend/append the new thumb without a full refetch.
- Thumbnail click → **lightbox**: `openModal('여행사진', renderLightbox(photos, index))` where `renderLightbox` renders the current image plus ◀ ▶ buttons (disabled/hidden at the ends) and, when the viewer is the uploader or an admin, a 삭제 button. Clicking ◀/▶ re-renders the modal body in place (update `index`, re-call `renderLightbox`, no re-open animation) rather than closing/reopening. Left/Right arrow keys also step through — reuse the modal's existing Escape-to-close keydown listener spot in `ui.js` to add arrow-key delegation scoped to the open lightbox only. Delete → `deleteTripPhoto` → close modal, remove the thumb, toast.
- No changes to `admin.js`/`member.js` needed for this part — both already render `report.js` inside their 리포트 tab.

### #9 Member tabbed view

**Backend**: `members.js` `listMembers` — change `requireSession(db, data.sessionToken, ['admin'], data.tripId)` to `['admin', 'member']`. No response-shape change (still id/name/weight/account); the 구성원 read-only tab will render the same fields the admin's 구성원 tab already renders (minus the 수정 button).

**Frontend** — restructure `public/views/member.js`:
- Replace the current single `render()` body with a tab bar mirroring `admin.js`'s pattern: three buttons (`경비목록`/`구성원`/`리포트`) with `data-tab`, a `currentTab` module-level-ish variable (or closure, matching however `admin.js` scopes it), and a `body` div that the active tab renders into.
- `renderExpensesTab(body, slug, token)` — the existing `loadExpenses` body, unchanged logic, just relocated/renamed to fit the tab-render signature.
- `renderMembersTab(body, slug)` (new, member.js-local) — `listMembers` → render name + 가중치 + (계좌 있으면) 계좌, no add/edit affordances, no `membersCache`/modal wiring at all.
- `renderReportTab(body, slug)` — calls the existing `renderReportInto(body, slug)` (this replaces today's "리포트 보기 →" button-swap flow; the ← back navigation admin.js uses for tabs applies here as "switch tab" instead of "go back").
- Keep `openExpenseModal`/`openMemberExpenseEditModal` as-is; they're invoked from the 경비목록 tab exactly like today.

## Not included
- A dedicated top-level "사진" tab (photos live inside 리포트 instead, per the owner's placement choice).
- Reworking `admin.js`'s tab architecture or its `renderMembersTab` (member.js gets its own small read-only render instead of sharing).
- Any change to receipt (expense-photo) storage, classification, or the Plan 6 click-to-view-receipt behavior.

## Testing
- **Backend Jest**: `tripPhotos.test.js` — `addTripPhoto` uploads + creates a doc for admin and member; `listTripPhotos` returns URLs ordered by `createdAt`; `deleteTripPhoto` allows the uploader and an admin, rejects a different member with `FORBIDDEN`, throws `PHOTO_NOT_FOUND` for a missing id; a photo action succeeds even when the trip's `status === 'completed'` (no `requireTripEditable` call). `members.test.js` — `listMembers` now resolves for a `member` session (previously only tested/allowed for `admin`).
- **Frontend node:test**: existing suite stays green; these are view-layer changes with no new pure helpers expected (lightbox index math is trivial enough to stay inline, matching how `report.js`'s other modal helpers are untested view code today).
- **Emulator E2E / prod smoke**: upload a trip photo as admin and as a member, confirm both appear in the shared gallery for both roles; open the lightbox, step ◀/▶ and via arrow keys, confirm delete only shows for the uploader/admin and removes the thumb; mark a trip completed and confirm photo upload/delete still work while 경비/구성원 edits stay locked; log in as a member and confirm the 경비목록/구성원/리포트 tab bar renders, 구성원 tab shows the roster with no edit controls, switching tabs preserves session.
- **Deploy**: backend changed → `firebase deploy --only functions` (owner-run if needed) + Vercel auto from `main`.
