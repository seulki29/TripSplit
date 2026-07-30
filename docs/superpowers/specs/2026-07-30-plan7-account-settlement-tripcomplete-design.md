# Plan 7 Design: Classify Indicator + Member Account + Settlement Breakdown + Trip Complete

Date: 2026-07-30
Status: approved in brainstorming. Second of three plans splitting an 11-item owner request (Plan 6 = quick fixes + expense edit [shipped]; Plan 7 = this doc; Plan 8 = trip photo gallery + member tabs).

## Goal

Four owner requests:
- **#2** During receipt classification (~3s), show a "문자 추출 중…" indicator with a "건너뛰고 직접 입력" (skip → manual) button so the user isn't forced to wait.
- **#6** Let a member enter/edit their own bank account by clicking their own card in the report's 최종 정산.
- **#7** Between 결제자별 지출 and 최종 정산, show a settlement summary; and let clicking any settlement card reveal that member's per-expense breakdown (how their 내야 할 금액 is derived).
- **#11** Add a "여행 완료" (trip complete) admin action so the cross-trip comparison (which already only counts `status == 'completed'` trips) has data; completing a trip locks editing (reversible).

## Backend reality (verified)
- `classifyReceipt` (receipts.js) uploads AND classifies in one call, returning `{ photoPath, classified, ...fields }`; a classification failure still returns `photoPath` (photo kept). → #2 needs no backend change.
- No member-self account callable exists; `updateMember` is admin-only. → #6 needs a new callable.
- `computeSettlement` (settlement.js) has members (with weight) + confirmed expenses (with `excludedMembers`) and already computes `due` via `allocateInteger` (largest-remainder). → #7 breakdown reuses this.
- `getReportData` (report.js) already queries `.where('group','==',trip.group).where('status','==','completed')` for comparison. Trip status lifecycle today is only `setup → active` (updateTripSetup). → #11 needs a `completed` transition + edit-lock.

## Owner-confirmed decisions
- **#11 completion = edit-lock, reversible.** In `completed` state the app blocks expense/member/trip-info edits; admin can 완료 해제 back to `active`.
- **#7 detail = full per-expense breakdown** (each included expense's share reflecting weight + exclusion; total = 내야 할 금액; plus 결제/차액).
- **#6/#7 click conflict resolved:** a settlement card click opens the **detail modal** (everyone). The detail modal shows the account line; when it is the viewer's **own** card, it additionally offers an [내 계좌 입력/수정] control. Admin's 입금완료 button stays on the card face and must `stopPropagation`.

## Items

### #2 Classify indicator + skip (frontend only)
Both expense-entry modals (`admin.js` openAdminExpenseModal, `member.js` openExpenseModal):
- On photo select, render under the preview: **"🔍 문자 추출 중…"** text + a **[건너뛰고 직접 입력]** button. Disable/gray nothing else — the user can start typing immediately.
- Keep the `classifyReceipt` promise in a variable (`classifyPromise`) and a `skipped` flag.
  - On resolve, if **not skipped**: fill category/date/amount/merchant/detail from the result and set `photoPath`; remove the indicator. If `classified === false`, show the existing "자동 인식 실패 — 직접 입력" toast but still set `photoPath`.
  - On resolve, if **skipped**: set only `photoPath` (never overwrite fields the user may have typed); indicator already gone.
  - On reject: existing "사진 업로드 실패 — 사진 없이 저장됩니다" toast.
- **[건너뛰고 직접 입력]** click: set `skipped = true`, remove the indicator immediately. The promise keeps running in the background.
- **Submit**: if `classifyPromise` is still pending, `await` it first with the submit button showing "사진 저장 중…" so `photoPath` is attached; then proceed with `addExpense`. (If it rejected, save without photo — unchanged behavior.)
- No backend change.

### #6 Member self-account (one new callable)
- **Backend** `members.js`: `setMyAccount(db, data)` — `requireSession(['admin','member'])`; resolves the caller's own `memberId` from the session (NOT from client input); updates only that member doc's `account` (string, trimmed; empty → null). Not gated by trip completion (accounts are entered after settlement). Registered in `functions/index.js`.
- **Frontend** report.js settlement detail modal: when `session.memberId === m.id`, show an account input pre-filled with `m.account` + [저장] → `setMyAccount({tripId, account})` → on success update the card's account line and the modal in place; toast on error.
- Admins keep editing any account via the existing 구성원 modal; the own-card control is the member path.

### #7 Settlement breakdown (backend breakdown + frontend summary/detail)
- **Backend** `settlement.js` `computeSettlement`: for each member add `breakdown: [{ expenseId, category, merchant, share }]` — one entry per confirmed expense the member is **not excluded** from, `share` = that member's `allocateInteger` amount for the expense. `sum(share) === due` (asserted by a new unit test). `perMember` keeps id/name/due/paid/net and gains `breakdown`.
- **Frontend** report.js:
  - New **정산 요약** section between 결제자별 지출 and 최종 정산: total confirmed spend (`settlement.totalConfirmed`) + a one-line method note ("확정 지출을 제외되지 않은 구성원끼리 가중치 비율로 나눠 각자 '내야 할 금액'을 구하고, 실제 결제액과 비교해 차액을 계산합니다.").
  - 최종 정산 card → clickable (cursor:pointer). Click opens a **detail modal**: member name, a table of `breakdown` rows (카테고리 · 상호 · 내 분담액), a divider, then 내야 할 금액(=due) · 실제 결제(paid) · 차액(net), the account line, and — for the own card — the #6 account editor.
  - The admin 입금완료 toggle button (`settle-toggle`) gets `ev.stopPropagation()` so it doesn't open the detail modal (it keeps its Plan-6 in-place update).

### #11 Trip complete + edit-lock (state transition + comparison)
- **Backend**:
  - New `tripSetup.js` (or tripStatus) callable `setTripStatus(db, data)` — admin only; accepts `status ∈ {active, completed}`; loads trip; writes `status`. (Refuses other values / `setup`.)
  - New helper `requireTripEditable(db, tripId)` (in a small `lib/tripStatus.js`) — reads the trip; throws `TRIP_COMPLETED` when `status === 'completed'`.
  - Call `requireTripEditable` after `requireSession` in: `addExpense`, `updateExpense`, `deleteExpense`, `confirmExpense`, `setExpenseExclusions` (expenses.js); `addMember`, `updateMember` (members.js); `updateTripSetup` (tripSetup.js).
  - Do **not** gate: `setMemberSettled`, `setMyAccount`, `setTripStatus`, and all reads (`getReportData`, `getReceiptUrl`, `listReceiptUrls`, `getTripSetup`, `listMembers`, `listExpenses`).
- **Frontend**:
  - `errorMessages.js`: `TRIP_COMPLETED` → "완료된 여행이라 수정할 수 없습니다. 여행 완료를 해제한 뒤 다시 시도해주세요."
  - admin.js 여행정보 tab: show a status badge; add **[여행 완료 처리]** (when active) / **[여행 완료 해제]** (when completed) → `setTripStatus` → re-render tab.
  - When completed: show a banner ("이 여행은 완료 처리되어 편집이 잠겼습니다.") on the 경비확인 and 구성원 tabs, and hide the primary mutating controls (경비 입력, 구성원 추가, 제외설정, and per-card 확정/수정/삭제). Backend enforces regardless (defense in depth).
  - Comparison already renders when ≥1 other completed trip in the group produces category averages; no report change needed beyond it now having data.

## Not included
- Plan 8: #8 (trip-photo gallery + lightbox, remove receipt gallery), #9 (member tabbed view).
- Changing the weight/exclusion model, receipt storage, or session/auth.

## Testing
- **Backend Jest**: `setMyAccount` (updates own doc; ignores/forbids other memberId; empty→null); `setTripStatus` (active↔completed, admin-only, rejects bad status); `requireTripEditable` (throws TRIP_COMPLETED when completed, passes when active/setup); `computeSettlement` breakdown (sum(share)===due; excluded member absent from another's… i.e. excluded expense not in that member's breakdown).
- **Frontend node:test**: existing suite stays green; add a pure-helper test only if a testable helper is extracted (e.g., breakdown row formatting), otherwise E2E.
- **Emulator E2E / prod smoke**: #2 indicator + skip (type while extracting, submit attaches photo); #6 member sets own account from own card; #7 summary shows, card click shows breakdown summing to due; #11 complete → edits blocked + banner, un-complete restores; comparison bars appear once a second trip in the group is completed.
- **Deploy**: backend changed → `firebase deploy --only functions` (owner-run if needed) + Vercel auto from main.
