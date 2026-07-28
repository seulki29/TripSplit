# Plan 5 Design: UX Polish

Date: 2026-07-28
Status: scope pre-approved in the Plan 4 brainstorming (owner chose "UX 개선 + 리포트 완성 함께" then a two-plan split: Plan 4 features, **Plan 5 = UX polish**). This spec formalizes the settled items.

## Goal

Make every interaction feel responsive and friendly: replace raw backend error codes with Korean messages, never leave a view stuck on a loading placeholder, give every submit button in-flight feedback, let forms submit on Enter, make modals accessible, and finish small copy fixes.

## Items

### 1. Korean error-message map (centralized)
Today `callFunction` (public/api.js) throws `new Error(body.error.message)` where the message IS the backend code (`INVALID_PIN`, `TOO_MANY_ATTEMPTS`, `SLUG_TAKEN`, …); ~26 call sites display that raw code to the user. Add `public/errorMessages.js` mapping known codes → Korean, and translate in `callFunction` so **every** view improves at once. Unknown codes fall back to a generic "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." (the existing network-error Korean string stays). Codes to cover (from the backend `httpsErrors`/throw sites): `INVALID_PASSWORD`, `INVALID_PIN`, `TOO_MANY_ATTEMPTS`, `MISSING_FIELDS`, `SLUG_TAKEN`, `NAME_REQUIRED`, `NAME_TAKEN`, `INVALID_WEIGHT`, `INVALID_AMOUNT`, `INVALID_CATEGORY`, `INVALID_EXCLUDED_MEMBERS`, `INVALID_PHOTO_PATH`, `INVALID_MIME_TYPE`, `MEMBER_NOT_FOUND`, `EXPENSE_NOT_FOUND`, `TRIP_NOT_FOUND`, `NO_PHOTO`, `EXPENSE_LOCKED`, `ENTERED_BY_REQUIRED`, `FORBIDDEN`, `INVALID_STATUS`, `INTERNAL_ERROR`. `UNAUTHENTICATED`/`PERMISSION_DENIED` already trigger a reload before the throw, so their message is rarely seen, but map them too ("세션이 만료되었습니다. 다시 로그인해주세요.").

### 2. Initial-load failure handling
Wrap each view's first data load so a network/permission failure shows a visible, retryable message instead of a stuck "불러오는 중...":
- `admin.js`: `renderSetupTab`/`renderMembersTab`/`renderExpensesTab` (each awaits `getTripSetup`/`listMembers`/`listExpenses` up front) → try/catch that writes an error + a "다시 시도" button into the tab body.
- `report.js` `renderReportInto`: try/catch around `getReportData` → error message in the container.
- `member.js` `loadExpenses`: try/catch → error in `#member-expenses-list`.
(The `UNAUTHENTICATED` case still self-recovers via api.js's reload; this covers plain network failures.)

### 3. Submit-button in-flight states (finish the set)
Already done: login buttons, member-add modal (`mm-submit`), exclusion apply (`excl-apply`). Add the same disable+progress-text+restore-on-error pattern to the remaining mutating submits:
- `superadmin.js`: create-trip (`생성`), PIN reissue submit.
- `admin.js`: setup save (`저장`), `expense-confirm`/`expense-delete` (disable the clicked button during its await), admin expense submit (`ae-submit`).
- `member.js`: expense submit (`me-submit`), `member-delete`.
Buttons that navigate away or whose modal closes on success don't need restoration; those that re-render in place do.

### 4. Enter-key submission
Let the primary action fire on Enter (keydown Enter on the relevant input triggers the same handler as the button):
- Login: superadmin password, admin PIN, member PIN.
- Superadmin create-trip form and PIN reissue.
- Member add/edit modal, expense entry modals (admin + member) — Enter in a text/number field submits.
Implement via a small shared helper or per-form `keydown` listeners; avoid double-submit by reusing the same disabled-guarded handler.

### 5. Modal accessibility (`ui.js` openModal/closeModal)
- `role="dialog"`, `aria-modal="true"`, `aria-label` from the title on `.modal-box`.
- Escape key closes the modal.
- On open, focus the first focusable field in the body; on close, return focus to the element that had it before open.
- Keep the existing overlay-click-to-close. (A full focus trap is out of scope — the above covers the core a11y wins without the complexity.)

### 6. Copy: 컴펌 → 확정
Rename user-facing "컴펌" to "확정": `admin.js` the 컴펌됨 badge and 컴펌/컴펌 해제 buttons; `member.js` the 🔒 컴펌됨 badge. Backend field names (`confirmed`) and the callable (`confirmExpense`) are unchanged — display only.

## Not included / already done
- PIN `type="password"`: login PIN fields are already `type="password"`; the superadmin trip-create/reissue PIN inputs stay visible on purpose (the superadmin reads them to share with the trip's admin/members). No change.
- Deferred perf/cleanup from Plan 4 (listReceiptUrls re-signing on every report render; admin.js renderToken-snapshot cleanup) are tracked separately — not part of this UX pass, except that item 3's confirm/delete feedback should not introduce new stale-render issues.

## Testing
- `public/test/`: extend `api.test.js`-style coverage for the error-message map (code → Korean, unknown → fallback) since it's pure logic in `errorMessages.js`/`callFunction`. Modal a11y and view changes are verified by the emulator E2E.
- Frontend suite stays green; the map is the main new unit-testable surface.
- Final: emulator E2E spot-check (trigger a wrong-PIN to see the Korean message, Enter-to-login, a load-failure path, Escape-closes-modal, 확정 label), then production deploy + smoke.

## Rollout
Frontend-only (plus no backend change). Vercel auto-deploys from `main`; no Cloud Functions redeploy needed.
