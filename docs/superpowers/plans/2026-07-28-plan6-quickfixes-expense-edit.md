# Quick Fixes + Expense Edit Implementation Plan (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Task 6 (E2E + deploy) is controller-run.

**Goal:** Keep the report in place when marking 입금완료; open receipts by clicking the expense item (no separate link); tidy expense-card buttons for mobile portrait; add an expense-edit UI; explain the settlement weight. Frontend-only.

**Architecture:** No backend change — `updateExpense` and `setMemberSettled` already exist. `#1` updates the settlement card DOM in place instead of a full report re-render. Shared card-action styling goes in `style.css`.

**Spec:** `docs/superpowers/specs/2026-07-28-plan6-quickfixes-expense-edit-design.md`

## Global Constraints

- No backend/deploy of functions. Frontend `npm test` green at every commit.
- Receipt viewing is triggered by clicking the expense row/card (when it has `photoPath`) — the separate "영수증" button/link is removed in report.js, admin.js, and member.js. Action buttons on a clickable card MUST call `e.stopPropagation()` so they don't also open the receipt.
- Expense edit uses the existing `updateExpense({tripId, expenseId, patch})`. The 수정 button is shown to admin always, and to a member only for their OWN, UNCONFIRMED expense (mirror the backend `FORBIDDEN`/`EXPENSE_LOCKED` rules so it's never offered when it would fail).
- 입금완료 toggle must NOT re-fetch/re-render the whole report (no scroll-to-top, no `listReceiptUrls` re-sign) — update only the toggled member's settlement card.
- Category list stays `['숙박','식비','장보기','교통비']`; error messages already Korean (Plan 5).

## File Structure

```
public/views/report.js   # MODIFY Task 1 — settle-in-place, report-table row-click receipt
public/style.css         # MODIFY Task 2 — .card-actions compact/nowrap
public/views/admin.js    # MODIFY Task 3 (card receipt-click + layout + weight help), Task 4 (edit UI)
public/views/member.js   # MODIFY Task 5 — receipt-click, layout, edit UI
```

---

### Task 1: report.js — settle-in-place + report-table receipt on row click

**Files:** Modify `public/views/report.js`

**Interfaces:** Consumes `getReceiptUrl`, `setMemberSettled`, `openModal`, `showToast`, `escapeHtml`. No new exports.

- [ ] **Step 1: Settlement card gets a stable id + the toggle updates in place.** In `renderSettlement(perMember, isAdmin)`, give each member card a `data-member-id` and wrap the badge slot + toggle button so they can be swapped. Replace `renderSettlement` with:

```js
function renderSettlement(perMember, isAdmin) {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)">
      ${perMember.map((m) => `
        <div style="background:var(--paper);padding:1rem" data-member-id="${m.id}">
          <p style="font-family:var(--f-kr);font-weight:500">${escapeHtml(m.name)}
            <span class="settle-badge">${m.settled ? '<span class="badge badge-locked" style="margin-left:0.4rem">입금완료</span>' : ''}</span></p>
          <p class="muted" style="font-size:12px">내야 할 금액 ${m.due.toLocaleString()}원 · 실제 지출 ${m.paid.toLocaleString()}원</p>
          <p class="mono" style="font-family:var(--f-display);font-weight:700;color:var(--${m.net >= 0 ? 'receive' : 'pay'})">${m.net >= 0 ? '+' : ''}${m.net.toLocaleString()}원</p>
          ${m.account ? `<p class="muted" style="font-size:12px">계좌 ${escapeHtml(m.account)}</p>` : ''}
          ${isAdmin ? `<button type="button" class="btn btn-secondary settle-toggle" data-id="${m.id}" data-settled="${m.settled}" style="margin-top:0.4rem">${m.settled ? '입금완료 해제' : '입금완료 표시'}</button>` : ''}
        </div>`).join('')}
    </div>`;
}
```

- [ ] **Step 2: Replace the settle-toggle handler** (lines ~59-66) so it updates only that card instead of `renderReportInto`:

```js
  container.querySelectorAll('.settle-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const next = btn.dataset.settled !== 'true';
      btn.disabled = true;
      try {
        await callFunction('setMemberSettled', { tripId: session.tripId, memberId: btn.dataset.id, settled: next });
        const card = btn.closest('[data-member-id]');
        card.querySelector('.settle-badge').innerHTML = next ? '<span class="badge badge-locked" style="margin-left:0.4rem">입금완료</span>' : '';
        btn.dataset.settled = String(next);
        btn.textContent = next ? '입금완료 해제' : '입금완료 표시';
        btn.disabled = false;
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });
```

- [ ] **Step 3: Report table — row click opens receipt; remove the inline 영수증 button.** In `renderExpenseTable`, remove the `report-receipt` button, and make the whole `<tr>` clickable when the expense has a photo (add a class + `data-id` + `cursor:pointer` and a small 📷 hint). Replace the row template:

```js
        ${expenses.map((e) => `
          <tr style="border-top:1px solid var(--rule)${e.photoPath ? ';cursor:pointer' : ''}" ${e.photoPath ? `class="report-receipt-row" data-id="${e.id}"` : ''}>
            <td style="padding:0.6rem 0.5rem">${escapeHtml(e.date)}</td>
            <td><span class="tag">${e.category}</span></td>
            <td>${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}
              ${e.excludedMembers && e.excludedMembers.length ? `<span class="muted" style="font-size:11px">· 제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</span>` : ''}
              ${e.photoPath ? '<span class="muted" style="font-size:11px">· 📷</span>' : ''}
            </td>
            <td>${escapeHtml(nameById[e.enteredBy] || '?')}</td>
            <td style="text-align:right" class="mono">${Number(e.amount).toLocaleString()}원</td>
          </tr>`).join('')}
```

Then replace the old `.report-receipt` handler (lines ~50-57) with a `.report-receipt-row` handler:

```js
  container.querySelectorAll('.report-receipt-row').forEach((row) => {
    row.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: row.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증">`);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
```

- [ ] **Step 4: Run `npm test` → 45/45 (logic tests unaffected). Commit.**

```bash
git add public/views/report.js
git commit -m "feat(frontend): settle toggle updates in place; report row click opens receipt"
```

---

### Task 2: style.css — compact, no-wrap card actions

**Files:** Modify `public/style.css`

**Interfaces:** Produces `.card-actions` (flex row, right-aligned, `flex-wrap:nowrap`, small gap) and a compact button variant usable by admin/member expense cards so 확정/수정/삭제 fit on one line at ~360px.

- [ ] **Step 1: Add styles.** Append to `style.css`:

```css
/* ── EXPENSE CARD ACTIONS (compact, no-wrap on mobile) ── */
.card-actions { display: flex; flex-wrap: nowrap; justify-content: flex-end; gap: 0.35rem; }
.card-actions .btn { padding: 0.35rem 0.6rem; font-size: 12px; white-space: nowrap; }
@media (max-width: 480px) {
  .card-actions .btn { padding: 0.3rem 0.5rem; font-size: 11px; }
}
```

- [ ] **Step 2: Run `npm test` → 45/45. Commit.**

```bash
git add public/style.css
git commit -m "feat(frontend): compact no-wrap .card-actions for expense cards"
```

---

### Task 3: admin.js — card-click receipt, compact actions, weight help

**Files:** Modify `public/views/admin.js`

**Interfaces:** Consumes `getReceiptUrl`, `.card-actions` from Task 2. The card body (info) becomes the receipt-open trigger; action buttons stopPropagation.

- [ ] **Step 1: Restructure the 경비확인 card** (`renderExpensesTab`, the `expenses.map` template): remove the `expense-receipt` button; make the card clickable for receipt when `e.photoPath`; put 확정/삭제 in a `.card-actions` row. Replace the card template:

```js
  document.getElementById('expenses-list').innerHTML = expenses.map((e) => `
    <div class="card${e.photoPath ? ' expense-card-receipt' : ''}" data-id="${e.id}" style="margin-bottom:0.6rem${e.photoPath ? ';cursor:pointer' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
        <div style="min-width:0">
          ${exclusionMode ? `<input type="checkbox" class="excl-check" data-id="${e.id}" style="margin-right:0.5rem">` : ''}
          <span class="tag">${e.category}</span>
          <strong style="margin-left:0.5rem">${Number(e.amount).toLocaleString()}원</strong>
          <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(e.date)} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
          ${e.confirmed ? '<span class="badge badge-locked" style="margin-left:0.5rem">확정됨</span>' : ''}
          ${e.photoPath ? '<span class="muted" style="font-size:11px;margin-left:0.4rem">📷</span>' : ''}
        </div>
        <div class="card-actions">
          <button type="button" class="btn btn-secondary expense-confirm" data-id="${e.id}" data-confirmed="${e.confirmed}">${e.confirmed ? '확정 해제' : '확정'}</button>
          <button type="button" class="btn btn-danger expense-delete" data-id="${e.id}">삭제</button>
        </div>
      </div>
      <p class="muted" style="font-size:13px;margin-top:0.4rem">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}</p>
      ${e.excludedMembers && e.excludedMembers.length ? `<p class="muted" style="font-size:12px">제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</p>` : ''}
    </div>`).join('');
```

- [ ] **Step 2: Card-click receipt handler + stopPropagation on the action buttons.** Remove the old `.expense-receipt` handler block. Add a `.expense-card-receipt` click handler. In the existing `.expense-confirm` / `.expense-delete` (and the exclusion `.excl-check`) handlers, add `ev.stopPropagation()` as the first line of the listener so a button click doesn't bubble to the card. For confirm/delete, the listener signature becomes `(ev) => { ev.stopPropagation(); ... }`.

```js
  body.querySelectorAll('.expense-card-receipt').forEach((card) => {
    card.addEventListener('click', async () => {
      try {
        const { url } = await callFunction('getReceiptUrl', { tripId: session.tripId, expenseId: card.dataset.id });
        openModal('영수증', `<img src="${escapeHtml(url)}" style="width:100%;border-radius:4px" alt="영수증 사진">`);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
```

(Also give the `.excl-check` checkbox an `ev.stopPropagation()` on click so toggling it in exclusion mode doesn't open the receipt.)

- [ ] **Step 3: Weight help text (#10).** In `openMemberModal`, under the 정산 가중치 input, add:

```js
    <p class="muted" style="font-size:12px;margin-top:-0.3rem;margin-bottom:0.6rem">정산 시 부담하는 비율입니다. 기본 1. 예: 자녀 2명과 함께 참여하면 3으로 설정.</p>
```

- [ ] **Step 4: Run `npm test` → 45/45. Commit.**

```bash
git add public/views/admin.js
git commit -m "feat(frontend): admin card-click receipt, compact actions, weight help"
```

---

### Task 4: admin.js — expense edit UI (#5)

**Files:** Modify `public/views/admin.js`

**Interfaces:** Consumes `updateExpense`. Adds a 수정 button to the 경비확인 card actions and an edit modal.

- [ ] **Step 1: Add a 수정 button** to the `.card-actions` row in `renderExpensesTab` (between 확정 and 삭제), always shown for admin:

```js
          <button type="button" class="btn btn-secondary expense-edit" data-id="${e.id}">수정</button>
```

- [ ] **Step 2: Wire the edit handler** (with `ev.stopPropagation()`), passing the full expense object. After the delete handler block:

```js
  body.querySelectorAll('.expense-edit').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const exp = expenses.find((x) => x.id === btn.dataset.id);
      openAdminExpenseEditModal(body, slug, members, exp);
    });
  });
```

- [ ] **Step 3: Add `openAdminExpenseEditModal`.** Model it on `openAdminExpenseModal` but pre-filled and calling `updateExpense` (no photo classification). NOTE (already verified): `updateExpense`'s allowlist in `functions/src/functions/expenses.js` accepts `date/category/amount/merchant/detail/photoPath/excludedMembers` but **NOT `enteredBy`** — so the edit modal does NOT include a payer/귀속대상 field (to change the payer, admin deletes and re-adds). Do not send `enteredBy`. Full function:

```js
function openAdminExpenseEditModal(body, slug, exp) {
  let category = exp.category;
  openModal('경비 수정', `
    <div class="field"><label class="label">카테고리</label><div id="ee-category"></div></div>
    <div class="field"><label class="label">날짜</label><input type="date" class="input" id="ee-date" value="${escapeHtml(exp.date || '')}"></div>
    <div class="field"><label class="label">금액</label><input type="number" class="input" id="ee-amount" value="${Number(exp.amount) || ''}"></div>
    <div class="field"><label class="label">상호명</label><input class="input" id="ee-merchant" value="${escapeHtml(exp.merchant || '')}"></div>
    <div class="field"><label class="label">세부사항</label><input class="input" id="ee-detail" value="${escapeHtml(exp.detail || '')}"></div>
    <button type="button" class="btn btn-primary btn-block" id="ee-submit">저장</button>
    <p class="muted" id="ee-error" style="margin-top:0.5rem;font-size:13px"></p>
  `);

  function rerenderChips() {
    renderChipGroup(document.getElementById('ee-category'), CATEGORIES, category, (c) => { category = c; rerenderChips(); });
  }
  rerenderChips();

  ['ee-amount', 'ee-merchant', 'ee-detail'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('ee-submit').click(); });
  });

  document.getElementById('ee-submit').addEventListener('click', async () => {
    const btn = document.getElementById('ee-submit');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      await callFunction('updateExpense', {
        tripId: getSession().tripId,
        expenseId: exp.id,
        patch: {
          category,
          date: document.getElementById('ee-date').value,
          amount: Number(document.getElementById('ee-amount').value),
          merchant: document.getElementById('ee-merchant').value,
          detail: document.getElementById('ee-detail').value,
        },
      });
      closeModal();
      await renderExpensesTab(body, slug, renderToken);
    } catch (err) {
      btn.disabled = false; btn.textContent = '저장';
      document.getElementById('ee-error').textContent = err.message;
    }
  });
}
```

(Update the Step 2 call site accordingly: `openAdminExpenseEditModal(body, slug, exp)` — no `members` arg.)

- [ ] **Step 4: Run `npm test` → 45/45. Commit.**

```bash
git add public/views/admin.js
git commit -m "feat(frontend): admin expense edit modal via updateExpense"
```

---

### Task 5: member.js — card-click receipt, compact actions, edit UI

**Files:** Modify `public/views/member.js`

**Interfaces:** Consumes `getReceiptUrl`, `updateExpense`, `.card-actions`. Member edits only OWN + UNCONFIRMED.

- [ ] **Step 1: Restructure the member expense card** in `loadExpenses`: make the card clickable for receipt when `e.photoPath`; put actions (수정 for own+unconfirmed, 삭제 for own+unconfirmed) in a `.card-actions` row. `canEdit = isMine && !e.confirmed` (same rule as the existing 삭제). Add a `📷` hint when a photo exists. Update the card template accordingly, and give the card `class="card expense-card-receipt"` + `data-id` + `cursor:pointer` when `e.photoPath`.

- [ ] **Step 2: Handlers.** Add a `.expense-card-receipt` click → `getReceiptUrl` → `openModal` (same as admin). Add `ev.stopPropagation()` to the `.member-delete` handler and the new `.member-edit` handler. Add `.member-edit` → `openMemberExpenseEditModal(root, slug, exp)`.

- [ ] **Step 3: Add `openMemberExpenseEditModal`** — like the member add-expense modal but pre-filled and calling `updateExpense` (no photo classify, no enteredBy — members can't reassign). Fields: category chips, date, amount, merchant, detail. Submit disable+progress ('저장 중...' → restore '저장' on error), Enter-to-submit on amount/merchant/detail, on success closeModal + `loadExpenses(root, slug)`. On error show `err.message` (already Korean; e.g. EXPENSE_LOCKED → "확정된 항목은 수정할 수 없습니다.").

- [ ] **Step 4: Run `npm test` → 45/45. `grep -n 영수증 public/views/member.js` may be zero (member cards had no receipt button before). Commit.**

```bash
git add public/views/member.js
git commit -m "feat(frontend): member card-click receipt, compact actions, own-expense edit"
```

---

### Task 6: E2E + deploy (controller-run)

**Files:** none.

- [ ] Frontend suite green (`npm test`).
- [ ] Emulator E2E at `http://127.0.0.1:5000`:
  1. Report → toggle 입금완료 → **page stays at the same scroll position**, badge flips; toggle back works.
  2. Report 전체 지출 내역 → click a row with 📷 → receipt modal; a row without a photo isn't clickable.
  3. Admin 경비확인 → click a card with 📷 (not on a button) → receipt modal; clicking 확정/삭제/수정 does NOT open the receipt.
  4. Admin edit an expense (수정 → change amount/merchant → 저장) → list reflects it.
  5. Member: own unconfirmed expense shows 수정 → edit works; a confirmed or others' expense shows no 수정 (and edit would be blocked).
  6. 구성원 modal shows the weight help text.
  7. At mobile-portrait width (~360px), the card action row does not wrap/overflow.
- [ ] Stop emulator; ports free; no orphaned node/java.
- [ ] Deploy: Vercel auto-deploys from `main` on push (no functions change); confirm prod updated + quick smoke (toggle 입금완료 stays in place; edit works).

---

## Plan-Level Verification

```bash
npm test    # frontend, all green
```

Plus Task 6 emulator E2E and production smoke.

## What This Plan Does Not Cover
- Plan 7: #2 (classify indicator + skip/manual), #6 (member self-account on card click), #7 (settlement calc breakdown), #11 (trip-complete UI + comparison).
- Plan 8: #8 (trip-photo gallery + lightbox), #9 (member tabbed view).
