# Plan 4 Design: Per-Expense Member Exclusion + Report Completion

Date: 2026-07-27
Status: approved in brainstorming (decisions recorded below)

## Goal

Replace the coarse per-member category-exclusion model with precise per-expense member exclusion, and complete the report page to the sections the Plan 2 design specified but Task 12 did not build (조건 summary, receipt-click modal, account + payment-done tracking, gallery).

## Owner-confirmed decisions

| Decision | Choice |
|---|---|
| Exclusion granularity | Per-**expense** exclusion of specific members. Remove per-member `excludedCategories` entirely. |
| Bulk-apply semantics | In 경비확인, "제외설정" mode → check multiple expenses → pick members → **apply overwrites (set)** each selected expense's excluded list with the chosen members. Selecting a single expense pre-fills its current exclusions for editing. |
| Settlement/payment | Full: admin sets each member's bank `account`; report 최종 정산 shows account + an **입금완료** toggle (admin toggles, persisted, everyone sees; members read-only). |
| Scope split | This is Plan 4 (features/data). UX polish is a separate Plan 5. |

## Part C — Per-expense member exclusion (settlement engine change)

### Data model
- **Expense** gains `excludedMembers: string[]` (member doc IDs excluded from *this* expense's split). Defaults to `[]`.
- **Member** loses `excludedCategories`. Keeps `weight` and `account`.

### Settlement algorithm (rewrite `functions/src/lib/settlement.js`)
For each **confirmed** expense:
- `included` = members whose id is NOT in the expense's `excludedMembers` **and** whose `weight > 0`.
- The expense `amount` is divided among `included` proportional to `weight`, using **largest-remainder rounding** so the shares sum exactly to `amount` (integer 원).
- If `included` is empty (everyone excluded, or all included weights are 0), the expense contributes 0 to everyone's due (its cost is unallocated — surfaced as a note, not an error).

Per member:
- `due` = sum of that member's shares across all confirmed expenses.
- `paid` = sum of `amount` for confirmed expenses where `enteredBy === member.id`.
- `net` = `paid − due`.

The return shape `computeSettlement(members, expenses) => { categoryTotals, totalConfirmed, perMember }` is preserved; `perMember` entries keep `{ id, name, due, paid, net }` and gain `account` and `settled` (see Part B). `categoryTotals` (sum of confirmed amounts per category) stays for the donut chart.

### Category comparison under the new model
`getReportData`'s `currentCategoryAverages` / `groupCategoryAverages` continue to express **per-person category spend** for the group-average bars. Redefine `currentCategoryAverages[category]` = (sum of confirmed `due` shares attributed to that category) ÷ (number of members with any due), computed from the same per-expense split so exclusions are reflected. Group averages aggregate the same metric across the group's completed trips (unchanged storage/flow). Empty-comparison behavior (hide/placeholder when `tripsInComparison === 0`) is unchanged.

### Endpoints
- `addExpense` / `updateExpense`: accept `excludedMembers` (validated: an array of member IDs that exist in the trip; reject `INVALID_EXCLUDED_MEMBERS` otherwise). `updateExpense` allowlist adds `excludedMembers`.
- **New `setExpenseExclusions(tripId, expenseIds, excludedMemberIds)`** (admin only): validates all ids, then **sets** each listed expense's `excludedMembers` to `excludedMemberIds`. One callable so the bulk UI is a single atomic-ish call. Errors: `EXPENSE_NOT_FOUND` (any id missing), `INVALID_EXCLUDED_MEMBERS`.
- `addMember` / `updateMember`: stop writing/accepting `excludedCategories`.

### Frontend
- **구성원 add/edit modal** (`admin.js`): remove the excluded-category chip UI and its payload.
- **경비확인 탭** (`admin.js`): add a **제외설정** toggle. In that mode each expense row shows a checkbox; a "제외 구성원 지정" action opens a modal listing members as checkboxes (pre-checked from the single selected expense's current exclusions; empty when multiple are selected) → 적용 calls `setExpenseExclusions` → refresh. A way to exit the mode.
- **Expense cards** (`admin.js` 경비확인, `member.js` 경비목록): when `excludedMembers` is non-empty, show "제외: 이름1, 이름2" (names via the member map, escaped).
- **Report expense table** (`report.js`): show excluded member names in the row (compact).

## Part B — Report completion

### 01 조건 (settlement-rules summary)
A static section above 지출내역 summarizing the rule in Korean: "확정된 지출만 집계 · 각 지출을 제외되지 않은 구성원끼리 가중치 비율로 분담 · 실제 결제액과 비교해 정산." Include the member weights table (name · 가중치) so readers see the weighting. Pure display from `trip`/`members`.

### Receipt-click modal in the report expense table
Rows whose expense has a `photoPath` get a clickable "영수증" affordance → `getReceiptUrl` → existing `openModal` image view (same pattern as admin 경비확인). Needs `getReportData` to include `photoPath` (and `id`) per expense.

### Account + payment-done (입금완료)
- Backend: `updateMember` allowlist adds `account` (string, trimmed, may be empty). Member gains `settled: boolean` (default false). **New `setMemberSettled(tripId, memberId, settled)`** (admin only) toggles it. `getReportData` `perMember` includes `account` and `settled`.
- Frontend: 구성원 add/edit modal gains a **계좌** text input (→ `account`). Report 최종 정산 card shows each member's account (when set) and an **입금완료** control: for admin sessions a toggle that calls `setMemberSettled` and re-renders; for members a read-only badge (입금완료 / 미완료).

### 05 갤러리
- Backend: **New `listReceiptUrls(tripId)`** (admin + member): returns `[{ expenseId, url }]` — a 15-min signed URL for every confirmed expense that has a `photoPath`. (N signed URLs per call; acceptable at trip scale, optimizable later.)
- Frontend: a 갤러리 section at the end of the report renders the returned images in a responsive grid; clicking one opens it in `openModal`.

## Part D — Report navigation & tab bar (added during brainstorming)

### Report as an in-frame admin tab (not a separate page)
Today the admin console's 리포트 tab does `location.href = /t/<slug>/report`, loading a separate page with a "← 돌아가기" link. Change it so the report renders **inside the tab body** like the other tabs, keeping the tab bar visible:
- Refactor `report.js` to expose `renderReportInto(container, slug)` that renders only the report sections (no outer page chrome, no 돌아가기). The standalone `mount(root, {slug})` for the `/t/<slug>/report` route wraps it with the container (and, for direct/bookmarked access, a minimal back link).
- `admin.js`: the 리포트 tab becomes `renderReportTab(body, slug)` calling `renderReportInto(body, slug)` — no navigation away, tab bar stays.
- Member view (`member.js`): keep the report reachable, rendered in-frame within the member screen (header stays, content swaps between 경비목록 and 리포트 with a "← 경비 목록" link) rather than a separate page. The `/t/<slug>/report` route keeps working for direct access.

### Tab bar scrollbar
The `.tabs` element (`overflow-x: auto`) renders a visible scrollbar chrome that looks bad. Remove the visible scrollbar while keeping horizontal scrollability on very narrow widths — hide scrollbar chrome (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) or otherwise eliminate the scroll indicator. Confirm the exact cause against computed styles during implementation.

## File impact
- Backend: `settlement.js` (rewrite), `expenses.js` (excludedMembers + setExpenseExclusions), `members.js` (drop excludedCategories, allow account, settled default), `report.js` (return photoPath/id/account/settled + redefined averages), `receipts.js` or a new module for `listReceiptUrls`, `index.js` (wire `setExpenseExclusions`, `setMemberSettled`, `listReceiptUrls`). Tests for each.
- Frontend: `admin.js` (member modal, 경비확인 제외설정 mode + cards, 계좌 input, 리포트 in-frame tab), `member.js` (cards show exclusions, in-frame report toggle), `report.js` (조건, receipt modal, account+입금완료, 갤러리, `renderReportInto` refactor), `style.css` (`.tabs` scrollbar), `api.js` unchanged.

## Testing
- Backend Jest: per-expense settlement (weights, single/multi exclusion, all-excluded edge, rounding sums exactly); `setExpenseExclusions` (set semantics, validation, admin-only, missing ids); `updateMember` account allow + rejects unknown fields still; `setMemberSettled` (admin-only, toggle); `listReceiptUrls` (only confirmed+photo, authorization); `getReportData` returns the new fields.
- Frontend node:test where feasible; views verified by emulator E2E.
- Final: emulator golden path exercising 제외설정 → settlement reflects it → cards show excluded names → report 조건/영수증모달/계좌+입금완료/갤러리; then production smoke.

## Out of scope (Plan 5)
Korean error-message map, initial-load failure handling, submit in-flight states, Enter-key submit, modal accessibility, '컴펌'→'확정' rename, PIN `type="password"`.

## Migration note
Production has only throwaway smoke-test data, so dropping `excludedCategories` and adding `excludedMembers`/`settled` needs no data migration. The legacy `travel_report.html`/RTDB import remains a separate future effort.
