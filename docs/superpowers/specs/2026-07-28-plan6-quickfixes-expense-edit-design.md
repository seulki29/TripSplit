# Plan 6 Design: Quick Fixes + Expense Edit

Date: 2026-07-28
Status: approved in brainstorming. First of three plans splitting an 11-item owner request (Plan 6 = quick fixes + expense edit; Plan 7 = classify indicator/member account/settlement breakdown/trip-complete+comparison; Plan 8 = trip photo gallery + member tabs).

## Goal

Five focused frontend improvements: keep the report in place when marking 입금완료; make receipts open by clicking the expense (not a separate link); tidy expense-card action buttons for mobile portrait; add an expense-edit UI; and explain the settlement weight field. No backend change.

## Owner-confirmed decisions
- #3 receipt-on-click applies to BOTH the report 전체 지출 내역 rows AND the admin 경비확인 cards (and member cards) — the separate "영수증" button/link is removed; the whole item is clickable when it has a photo. Action buttons on a card must `stopPropagation` so clicking them doesn't also open the receipt.
- #7/#11/#6/#2 are Plan 7; #8/#9 are Plan 8.

## Items

### 1. 입금완료 toggle keeps the report in place (no scroll-to-top, no re-sign)
Today `setMemberSettled` success calls `renderReportInto(container, slug)` — a full re-fetch that re-renders every section (scrolling to top) and re-signs every gallery URL. Change it to update only the toggled member's settlement card DOM in place:
- Flip the member's `settled` in a local copy, toggle the 입금완료 badge and the button label/`data-*` on that card's element, without re-fetching. Keep the rest of the report untouched.
- This also resolves the Plan-4 perf follow-up (no listReceiptUrls re-sign on toggle).

### 2. Receipt opens by clicking the expense item (#3)
- **Report 전체 지출 내역 table**: a row whose expense has `photoPath` becomes clickable (cursor:pointer, subtle affordance) → `getReceiptUrl` → receipt modal. Remove the inline "영수증" text button. Rows without a photo are not clickable.
- **Admin 경비확인 cards**: clicking the card (its info area) when the expense has `photoPath` → receipt modal. Remove the separate "영수증" action button. The 확정/수정/삭제 buttons call `e.stopPropagation()` so they don't trigger the receipt.
- **Member 경비목록 cards**: same — card click opens the receipt when a photo exists; the 삭제/수정 buttons stopPropagation.
- Reuse the existing `getReceiptUrl` + `openModal` image pattern.

### 3. Mobile-portrait expense-card action buttons (#4)
The admin 경비확인 (and member) expense cards must not wrap or overflow on a narrow phone. Restructure each card so the expense info is on top and the action buttons (확정/확정 해제, 수정, 삭제 — 영수증 removed per #3) sit in a single right-aligned action row that does NOT wrap:
- Compact the buttons for small screens (smaller padding/font via a shared `.btn-compact`/`.card-actions` style in `style.css`, or short labels), `flex-wrap: nowrap`, so all fit on one line at ~360px width.
- Verify visually at mobile-portrait width during E2E.

### 4. Expense edit UI (#5)
Backend `updateExpense` already exists (accepts date/category/amount/merchant/detail/photoPath/excludedMembers; enforces member-can-edit-only-own-and-unconfirmed via `FORBIDDEN`/`EXPENSE_LOCKED`). Add the missing UI:
- A **수정** button on each expense card. Shown to: admin always; a member only for their own unconfirmed expenses (mirror the backend rule so the button isn't offered when it would `FORBIDDEN`/`EXPENSE_LOCKED`).
- Clicking it opens an edit modal pre-filled with the expense's current values (category chips, date, amount, merchant, detail; admin also sees the enteredBy select). On submit → `updateExpense({tripId, expenseId, patch:{...}})` → close + refresh the list.
- The edit modal reuses the add-expense modal's field layout; it does NOT re-run photo classification (editing is for correcting fields). Keep the existing photo untouched (don't require re-upload).
- Applies to both admin 경비확인 and member 경비목록.

### 5. Settlement-weight explanation (#10)
Under the "정산 가중치" input in the 구성원 add/edit modal, add muted help text: e.g. "정산 시 부담하는 비율입니다. 예: 자녀 2명과 함께 참여하면 3으로 설정." (Weight semantics confirmed: a member's share multiplier — default 1.)

## Not included
- Backend changes (none needed).
- Plan 7/8 items.

## Testing
- Frontend `npm test` stays green (these are view changes; the settle-in-place logic is the main new testable surface if any pure helper is extracted, otherwise E2E-verified).
- Emulator E2E: toggle 입금완료 → page does NOT jump to top and the badge flips; click an expense row/card with a photo → receipt modal; edit an expense (admin + member-own) → values change; member cannot edit a confirmed/other's expense (button absent); weight help text visible; check the card action row at mobile-portrait width (no wrap).
- Production deploy (Vercel auto from main) + quick smoke.
