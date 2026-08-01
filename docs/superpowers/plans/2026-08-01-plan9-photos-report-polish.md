# Plan 9 — 여행사진 개선 + 리포트 밀도/카테고리 색상/그룹 비교 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행사진에 다중 업로드·클라이언트 리사이즈·고정 프레임을 넣고, 리포트의 경비 날짜/카테고리 색상/모바일 밀도를 정리하며, 그룹 평균 비교를 1인·하루 기준 표로 재설계한다.

**Architecture:** `views/report.js`(18KB)에서 순수 로직을 작은 ESM 모듈로 뽑아낸다 — `categories.js`(카테고리 메타/렌더), `format.js`(날짜), `imageResize.js`(캔버스 리사이즈), `charts.js`(도넛+비교표), `views/tripPhotos.js`(갤러리). 백엔드는 `getReportData`가 여행 일수로 정규화한 카테고리 평균을 내보내도록 바꾼다. 스타일은 인라인 style에서 `public/style.css` 클래스로 이관한다.

**Tech Stack:** 빌드 없는 바닐라 ESM 프론트엔드, `node:test` + jsdom(프론트 테스트), Firebase Functions(CommonJS) + Jest(백엔드 테스트)

## Global Constraints

- 프론트엔드는 ESM(`import`/`export`), 백엔드는 CommonJS(`require`/`module.exports`). 섞지 않는다.
- 프론트 테스트는 `node:test` + `node:assert/strict`. 백엔드 테스트는 Jest(`describe`/`test`/`expect`).
- 프론트 테스트 실행: `node --test public/test/<file>` (루트 `npm test` 스크립트는 Node 24에서 깨져 있으므로 파일을 직접 지정한다). 백엔드: `npm --prefix functions test`.
- 사용자에게 보이는 문자열은 한국어.
- HTML 문자열에 삽입되는 모든 사용자/DB 유래 값은 `escapeHtml`을 통과해야 한다.
- 카테고리 mark 색상은 정확히 이 값 — `숙박 #2a78d6`, `식비 #eb6834`, `장보기 #1baf7a`, `교통비 #eda100`, `놀이 #e87ba4`, `기타 #4a3aa7`. **이 순서가 색각이상 안전장치이므로 임의로 바꾸지 않는다.**
- 태그 tint/ink 색상도 스펙의 확정값을 그대로 쓴다 (Task 2 표 참조).
- 영수증(`classifyReceipt`, `uploadReceiptImage`) 경로는 이 계획에서 건드리지 않는다.
- 이미지 리사이즈 상한은 긴 변 1024px, 출력 MIME은 항상 `image/jpeg`, 품질 0.85.

---

### Task 1: 경비 날짜 포맷 (`formatDate`)

**Files:**
- Create: `public/format.js`
- Create: `public/test/format.test.js`
- Modify: `public/views/report.js:234`
- Modify: `public/views/member.js:86`
- Modify: `public/views/admin.js:246`

**Interfaces:**
- Consumes: 없음
- Produces: `formatDate(iso: string) => string` — `'2026-07-30'` → `'7.30'`

- [ ] **Step 1: Write the failing test**

`public/test/format.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from '../format.js';

describe('formatDate', () => {
  test('drops the year and renders month.day', () => {
    assert.equal(formatDate('2026-07-30'), '7.30');
  });

  test('strips leading zeros from both month and day', () => {
    assert.equal(formatDate('2026-07-05'), '7.5');
    assert.equal(formatDate('2026-01-01'), '1.1');
  });

  test('keeps two-digit months and days intact', () => {
    assert.equal(formatDate('2026-12-25'), '12.25');
  });

  test('returns an empty string for falsy input', () => {
    assert.equal(formatDate(''), '');
    assert.equal(formatDate(null), '');
    assert.equal(formatDate(undefined), '');
  });

  test('passes through anything that is not a YYYY-MM-DD date', () => {
    assert.equal(formatDate('30/07/2026'), '30/07/2026');
    assert.equal(formatDate('2026-7-3'), '2026-7-3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/test/format.test.js`
Expected: FAIL — `Cannot find module .../public/format.js`

- [ ] **Step 3: Write minimal implementation**

`public/format.js`:

```js
// Expense dates are always within one trip, so the year is noise. '2026-07-30' -> '7.30'
function formatDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  return `${Number(m[2])}.${Number(m[3])}`;
}

export { formatDate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test public/test/format.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Apply to the three expense-date render sites**

`public/views/report.js` — add to the imports at the top of the file:

```js
import { formatDate } from '../format.js';
```

Replace line 234:

```js
            <td style="padding:0.6rem 0.5rem">${escapeHtml(e.date)}</td>
```

with:

```js
            <td style="padding:0.6rem 0.5rem">${escapeHtml(formatDate(e.date))}</td>
```

`public/views/member.js` — add the same import, then replace line 86:

```js
            <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(e.date)} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
```

with:

```js
            <span class="muted" style="font-size:12px;margin-left:0.5rem">${escapeHtml(formatDate(e.date))} · ${escapeHtml(nameById[e.enteredBy] || '?')}</span>
```

`public/views/admin.js` — add the same import, then apply the identical replacement at line 246 (the markup on that line is the same as member.js:86).

**Do not touch** `document.getElementById('me-date').value = classification.date` (member.js:214) or the admin equivalent (admin.js:427) — `<input type="date">` requires ISO format.

- [ ] **Step 6: Verify no expense-date site was missed**

Run: `git grep -n "escapeHtml(e.date)"`
Expected: no output (all three call sites converted)

- [ ] **Step 7: Commit**

```bash
git add public/format.js public/test/format.test.js public/views/report.js public/views/member.js public/views/admin.js
git commit -m "feat(frontend): drop the year from expense dates (7.30)"
```

---

### Task 2: 카테고리 색상 시스템 (`categories.js` + CSS)

**Files:**
- Create: `public/categories.js`
- Create: `public/test/categories.test.js`
- Modify: `public/style.css` (BADGES / TAGS 섹션, 현재 106-110행 근처)
- Modify: `public/views/report.js` (지출 표 카테고리 셀, 정산 상세 모달)
- Modify: `public/views/member.js` (경비 카드, `CATEGORIES` 중복 선언 제거)
- Modify: `public/views/admin.js` (경비 카드, `CATEGORIES` 중복 선언 제거)

**Interfaces:**
- Consumes: `escapeHtml` from `public/ui.js`
- Produces:
  - `CATEGORIES: string[]` — `['숙박','식비','장보기','교통비','놀이','기타']`
  - `categorySlug(category: string) => string` — 미등록은 `'etc'`
  - `categoryMark(category: string) => string` — hex 문자열, 미등록은 기타 색
  - `categoryTag(category: string) => string` — `'<span class="tag" data-cat="food">식비</span>'`
  - `categoryDot(category: string) => string` — `'<span class="cat-dot" style="background:#eb6834"></span>'`

- [ ] **Step 1: Write the failing test**

`public/test/categories.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, categorySlug, categoryMark, categoryTag, categoryDot,
} from '../categories.js';

describe('categories.js', () => {
  test('the category list matches the backend list in functions/src/lib/categories.js', () => {
    // Hardcoded on purpose: the frontend (ESM) and backend (CJS) cannot share a
    // module without a build step, so this test is the drift alarm. If it fails,
    // reconcile both files -- do not just edit the expectation.
    assert.deepEqual(CATEGORIES, ['숙박', '식비', '장보기', '교통비', '놀이', '기타']);
  });

  test('every category maps to its own slug and mark colour', () => {
    assert.deepEqual(CATEGORIES.map(categorySlug),
      ['lodging', 'food', 'grocery', 'transport', 'play', 'etc']);
    assert.deepEqual(CATEGORIES.map(categoryMark),
      ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7']);
  });

  test('marks are unique -- no two categories share a colour', () => {
    const marks = CATEGORIES.map(categoryMark);
    assert.equal(new Set(marks).size, marks.length);
  });

  test('an unknown category falls back to the etc slot instead of throwing', () => {
    assert.equal(categorySlug('항공료'), 'etc');
    assert.equal(categoryMark('항공료'), '#4a3aa7');
    assert.equal(categorySlug(undefined), 'etc');
  });

  test('categoryTag emits a tag carrying the slug as a data attribute', () => {
    assert.equal(categoryTag('식비'), '<span class="tag" data-cat="food">식비</span>');
  });

  test('categoryTag escapes the label so stored data cannot inject markup', () => {
    assert.equal(categoryTag('<img src=x>'),
      '<span class="tag" data-cat="etc">&lt;img src=x&gt;</span>');
  });

  test('categoryDot emits a dot carrying the mark colour', () => {
    assert.equal(categoryDot('숙박'), '<span class="cat-dot" style="background:#2a78d6"></span>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/test/categories.test.js`
Expected: FAIL — `Cannot find module .../public/categories.js`

- [ ] **Step 3: Write minimal implementation**

`public/categories.js`:

```js
import { escapeHtml } from './ui.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비', '놀이', '기타'];

// Slot ORDER is the colourblind-safety mechanism, not decoration: this sequence
// was validated (adjacent-pair CVD dE 9.1, normal-vision dE 19.6) against the
// #fafaf8 page surface. Re-run the dataviz validator before reordering or adding.
const CATEGORY_META = {
  숙박: { slug: 'lodging', mark: '#2a78d6' },
  식비: { slug: 'food', mark: '#eb6834' },
  장보기: { slug: 'grocery', mark: '#1baf7a' },
  교통비: { slug: 'transport', mark: '#eda100' },
  놀이: { slug: 'play', mark: '#e87ba4' },
  기타: { slug: 'etc', mark: '#4a3aa7' },
};

// Older trips may hold a category no longer in the list; render it, don't crash.
function categoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META['기타'];
}

function categorySlug(category) {
  return categoryMeta(category).slug;
}

function categoryMark(category) {
  return categoryMeta(category).mark;
}

function categoryTag(category) {
  return `<span class="tag" data-cat="${categorySlug(category)}">${escapeHtml(category)}</span>`;
}

function categoryDot(category) {
  return `<span class="cat-dot" style="background:${categoryMark(category)}"></span>`;
}

export {
  CATEGORIES, categorySlug, categoryMark, categoryTag, categoryDot,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test public/test/categories.test.js`
Expected: PASS — 7 tests

- [ ] **Step 5: Add the tag colours to `public/style.css`**

In the `/* ── BADGES / TAGS ── */` section, immediately after the existing `.tag { ... }` rule, add:

```css
/* Per-category tint + ink. Tint/ink hold the mark hue but shift lightness so the
   label clears 4.5:1 on its own chip -- the saturated marks are for chart marks
   only, where a text label always sits beside them. */
.tag[data-cat="lodging"]   { background: #e5f1ff; color: #0052ac; }
.tag[data-cat="food"]      { background: #ffeae2; color: #9e1c00; }
.tag[data-cat="grocery"]   { background: #e4f5ec; color: #006b3c; }
.tag[data-cat="transport"] { background: #fbeede; color: #864100; }
.tag[data-cat="play"]      { background: #feeaf0; color: #8e2956; }
.tag[data-cat="etc"]       { background: #edeeff; color: #4e3fad; }

.cat-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; }
```

- [ ] **Step 6: Swap the four `<span class="tag">` call sites to `categoryTag`**

`public/views/report.js` — add to imports:

```js
import { categoryTag } from '../categories.js';
```

Replace line 235:

```js
            <td><span class="tag">${e.category}</span></td>
```

with:

```js
            <td>${categoryTag(e.category)}</td>
```

Replace line 308 (inside `renderSettlementDetail`):

```js
      <td style="padding:0.4rem"><span class="tag">${b.category}</span></td>
```

with:

```js
      <td style="padding:0.4rem">${categoryTag(b.category)}</td>
```

**Leave `CATEGORY_COLORS` (report.js:5-12) in place for now.** Its remaining consumer is `renderDonutChart`, which Task 8 moves to `charts.js`; Task 8 deletes the const at that point.

`public/views/member.js` — replace the local `CATEGORIES` declaration at line 6:

```js
const CATEGORIES = ['숙박', '식비', '장보기', '교통비', '놀이', '기타'];
```

with an import alongside the existing ones:

```js
import { CATEGORIES, categoryTag } from '../categories.js';
```

Replace line 84:

```js
            <span class="tag">${e.category}</span>
```

with:

```js
            ${categoryTag(e.category)}
```

`public/views/admin.js` — apply the identical treatment: delete its local `CATEGORIES` declaration, import `{ CATEGORIES, categoryTag }` from `../categories.js`, and replace line 244's `<span class="tag">${e.category}</span>` with `${categoryTag(e.category)}`.

**Leave `public/views/index.js:43` alone** — that tag holds a trip group name, not a category.

- [ ] **Step 7: Verify no category tag site was missed and nothing else broke**

Run: `git grep -n 'class="tag">\${e.category}\|class="tag">\${b.category}'`
Expected: no output

Run: `git grep -n "^const CATEGORIES" public/views/`
Expected: no output (both duplicates removed)

Run: `node --test public/test/*.test.js`
Expected: PASS — all suites

- [ ] **Step 8: Commit**

```bash
git add public/categories.js public/test/categories.test.js public/style.css public/views/report.js public/views/member.js public/views/admin.js
git commit -m "feat(frontend): per-category tag colours from a CVD-validated palette"
```

---

### Task 3: 카테고리 선택 칩에 색 점 추가

**Files:**
- Modify: `public/ui.js:64-75` (`renderChipGroup`)
- Modify: `public/style.css` (CHIPS 섹션, 현재 89-96행)
- Modify: `public/views/member.js:174, 273`
- Modify: `public/views/admin.js:387, 489`
- Test: `public/test/ui.test.js`

**Interfaces:**
- Consumes: `categoryMark` from Task 2
- Produces: `renderChipGroup(container, options, selected, onSelect, { dotColor } = {})` — `dotColor`는 **옵션 하나를 받아 색 문자열 또는 falsy를 반환하는 함수**. 생략하면 기존 동작(텍스트만)이 그대로 유지된다.

- [ ] **Step 1: Write the failing test**

Append these tests inside the existing `describe('ui.js', ...)` block in `public/test/ui.test.js`, next to the other `renderChipGroup` tests:

```js
  test('renderChipGroup renders no dot when dotColor is omitted (existing callers unchanged)', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비'], '숙박', () => {});
    assert.equal(container.querySelectorAll('.cat-dot').length, 0);
    assert.equal(container.querySelectorAll('.chip')[0].textContent, '숙박');
  });

  test('renderChipGroup prepends a coloured dot when dotColor returns a colour', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비'], '숙박', () => {}, {
      dotColor: (opt) => (opt === '숙박' ? '#2a78d6' : '#eb6834'),
    });
    const dots = container.querySelectorAll('.cat-dot');
    assert.equal(dots.length, 2);
    // jsdom may serialise the colour as hex or as rgb() -- accept either.
    assert.match(dots[0].getAttribute('style'), /#2a78d6|rgb\(42,\s*120,\s*214\)/);
    // The label still reads as plain text -- the dot contributes none.
    assert.equal(container.querySelectorAll('.chip')[0].textContent, '숙박');
  });

  test('renderChipGroup skips the dot for an option whose dotColor is falsy', () => {
    const container = document.createElement('div');
    renderChipGroup(container, ['숙박', '식비'], '숙박', () => {}, {
      dotColor: (opt) => (opt === '숙박' ? '#2a78d6' : null),
    });
    assert.equal(container.querySelectorAll('.cat-dot').length, 1);
  });

  test('renderChipGroup still fires onSelect when dots are enabled', () => {
    const container = document.createElement('div');
    let selected = null;
    renderChipGroup(container, ['숙박', '식비'], '숙박', (opt) => { selected = opt; }, {
      dotColor: () => '#2a78d6',
    });
    container.querySelectorAll('.chip')[1].click();
    assert.equal(selected, '식비');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/test/ui.test.js`
Expected: FAIL — the dot tests report `0 !== 2` (no `.cat-dot` elements rendered)

- [ ] **Step 3: Write minimal implementation**

Replace `public/ui.js:64-75` entirely:

```js
// dotColor is a function (option) => colour|null, so this stays generic -- the
// category mapping lives in categories.js, not here.
function renderChipGroup(container, options, selected, onSelect, { dotColor } = {}) {
  container.innerHTML = '';
  container.className = 'chip-group';
  options.forEach((opt) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (opt === selected ? ' chip-selected' : '');
    const color = dotColor ? dotColor(opt) : null;
    if (color) {
      const dot = document.createElement('span');
      dot.className = 'cat-dot';
      dot.style.background = color;
      chip.appendChild(dot);
    }
    chip.appendChild(document.createTextNode(opt));
    chip.addEventListener('click', () => onSelect(opt));
    container.appendChild(chip);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test public/test/ui.test.js`
Expected: PASS — all suites including the 4 new tests

- [ ] **Step 5: Let the chip lay out its dot**

In `public/style.css`, replace the existing `.chip { ... }` rule's opening declarations so the chip becomes a flex row. The full replacement rule:

```css
.chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.4rem 0.8rem; border: 1px solid var(--rule); border-radius: 999px;
  font-size: 12px; font-family: var(--f-kr); background: var(--paper); color: var(--ink-2);
  cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s;
}
```

- [ ] **Step 6: Wire the four category chip call sites**

`public/views/member.js` — extend the import from Task 2 to include `categoryMark`:

```js
import { CATEGORIES, categoryTag, categoryMark } from '../categories.js';
```

Line 174 becomes:

```js
    renderChipGroup(document.getElementById('me-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderCategoryChips();
    }, { dotColor: categoryMark });
```

Line 273 becomes:

```js
    renderChipGroup(document.getElementById('mee-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderChips();
    }, { dotColor: categoryMark });
```

`public/views/admin.js` — extend its import the same way, then add `, { dotColor: categoryMark }` as the fifth argument to the `renderChipGroup` calls at lines 387 and 489.

- [ ] **Step 7: Verify**

Run: `git grep -c "dotColor: categoryMark" public/views/`
Expected: `public/views/admin.js:2` and `public/views/member.js:2`

Run: `node --test public/test/*.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add public/ui.js public/style.css public/test/ui.test.js public/views/member.js public/views/admin.js
git commit -m "feat(frontend): colour dot on category selector chips"
```

---

### Task 4: 지출 표 밀도/줄바꿈 (`.expense-table`)

**Files:**
- Modify: `public/style.css` (파일 끝, EXPENSE CARD ACTIONS 섹션 뒤)
- Modify: `public/views/report.js:224-246` (`renderExpenseTable`)

**Interfaces:**
- Consumes: `formatDate` (Task 1), `categoryTag` (Task 2)
- Produces: 없음 (렌더 전용)

- [ ] **Step 1: Add the table styles to `public/style.css`**

Append at the end of the file:

```css
/* ── EXPENSE TABLE ── */
/* Date / payer / amount are nowrap so a 3-glyph name never folds and the '원'
   never drops to its own line; the description column is the only flexible one,
   so it absorbs the squeeze. No ellipsis on the payer -- truncating '홍길동…'
   is worse than the wrap it replaces. */
.expense-table { width: 100%; border-collapse: collapse; }
.expense-table thead th {
  text-align: left; font-size: 11px; font-weight: 500;
  color: var(--ink-3); padding: 0.5rem 0.4rem;
}
.expense-table td { padding: 0.55rem 0.4rem; border-top: 1px solid var(--rule); vertical-align: top; }
.expense-table .col-date,
.expense-table .col-payer,
.expense-table .col-amount { white-space: nowrap; }
.expense-table .col-amount { text-align: right; }
.expense-table .col-desc { word-break: break-word; }

@media (max-width: 480px) {
  .expense-table { font-size: 12px; }
  .expense-table thead th { font-size: 10px; padding: 0.4rem 0.3rem; }
  .expense-table td { padding: 0.45rem 0.3rem; }
}
```

- [ ] **Step 2: Rewrite `renderExpenseTable`**

Replace `public/views/report.js:224-246` entirely:

```js
function renderExpenseTable(expenses, nameById) {
  return `
    <div style="overflow-x:auto">
    <table class="expense-table">
      <thead><tr>
        <th class="col-date">날짜</th><th>카테고리</th><th>내용</th>
        <th class="col-payer">결제자</th><th class="col-amount">금액</th>
      </tr></thead>
      <tbody>
        ${expenses.map((e) => `
          <tr${e.photoPath ? ' class="report-receipt-row" style="cursor:pointer" data-id="' + e.id + '"' : ''}>
            <td class="col-date">${escapeHtml(formatDate(e.date))}</td>
            <td>${categoryTag(e.category)}</td>
            <td class="col-desc">${escapeHtml(e.merchant || '')} ${escapeHtml(e.detail || '')}
              ${e.excludedMembers && e.excludedMembers.length ? `<span class="muted" style="font-size:11px">· 제외: ${escapeHtml(e.excludedMembers.map((id) => nameById[id] || '?').join(', '))}</span>` : ''}
              ${e.photoPath ? '<span class="muted" style="font-size:11px">· 📷</span>' : ''}
            </td>
            <td class="col-payer">${escapeHtml(nameById[e.enteredBy] || '?')}</td>
            <td class="col-amount mono">${Number(e.amount).toLocaleString()}원</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}
```

Note the row border moved from an inline `style` to the `.expense-table td` rule, so the `<tr>` now only carries the receipt-click attributes.

- [ ] **Step 3: Verify the receipt click handler still binds**

The handler at `report.js:60` selects `.report-receipt-row` and reads `row.dataset.id`. Both are preserved above.

Run: `git grep -n "report-receipt-row" public/views/report.js`
Expected: two hits — one in `renderExpenseTable`, one in the `querySelectorAll` handler

- [ ] **Step 4: Run the full frontend suite**

Run: `node --test public/test/*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/style.css public/views/report.js
git commit -m "fix(frontend): expense table density and no-wrap payer/amount on mobile"
```

---

### Task 5: 이미지 리사이즈 모듈 (`imageResize.js`)

**Files:**
- Create: `public/imageResize.js`
- Create: `public/test/imageResize.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `fitWithin(width: number, height: number, maxEdge?: number) => { width: number, height: number }`
  - `resizeImageFile(file: File, maxEdge?: number) => Promise<{ base64: string, mimeType: 'image/jpeg' }>`
  - `MAX_EDGE: 1024`

- [ ] **Step 1: Write the failing test**

`public/test/imageResize.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, MAX_EDGE } from '../imageResize.js';

describe('fitWithin', () => {
  test('the default max edge is 1024', () => {
    assert.equal(MAX_EDGE, 1024);
  });

  test('scales a landscape photo down so its long edge is exactly the max', () => {
    assert.deepEqual(fitWithin(2048, 1536, 1024), { width: 1024, height: 768 });
  });

  test('scales a portrait photo down on its height', () => {
    assert.deepEqual(fitWithin(1536, 2048, 1024), { width: 768, height: 1024 });
  });

  test('never upscales an image that already fits', () => {
    assert.deepEqual(fitWithin(800, 600, 1024), { width: 800, height: 600 });
    assert.deepEqual(fitWithin(1024, 1024, 1024), { width: 1024, height: 1024 });
  });

  test('rounds the short edge rather than truncating it', () => {
    // 100 * 1024 / 3000 = 34.13
    assert.deepEqual(fitWithin(3000, 100, 1024), { width: 1024, height: 34 });
  });

  test('keeps the short edge at a minimum of 1px on an extreme ratio', () => {
    // 5 * 1024 / 10000 = 0.512, which must not round down to a zero-height canvas
    assert.deepEqual(fitWithin(10000, 5, 1024), { width: 1024, height: 1 });
  });

  test('defends against zero or garbage dimensions instead of returning NaN', () => {
    assert.deepEqual(fitWithin(0, 0, 1024), { width: 1, height: 1 });
    assert.deepEqual(fitWithin(NaN, NaN, 1024), { width: 1, height: 1 });
  });

  test('uses the default max edge when none is passed', () => {
    assert.deepEqual(fitWithin(4096, 4096), { width: 1024, height: 1024 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test public/test/imageResize.test.js`
Expected: FAIL — `Cannot find module .../public/imageResize.js`

- [ ] **Step 3: Write the implementation**

`public/imageResize.js`:

```js
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

// Pure geometry, split out so it is testable without a canvas.
function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const w = Math.max(1, Math.floor(Number(width) || 0));
  const h = Math.max(1, Math.floor(Number(height) || 0));
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// createImageBitmap applies EXIF orientation, so portrait phone photos don't
// come out lying on their side. The <img> path is the fallback for browsers
// without it.
async function loadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => { if (bitmap.close) bitmap.close(); },
    };
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      release: () => URL.revokeObjectURL(url),
    });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_DECODE_FAILED')); };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Always re-encodes to JPEG, even when the source already fits: one code path
// and one predictable output type beats a branch, and q0.85 on an
// already-small JPEG is not visible.
async function resizeImageFile(file, maxEdge = MAX_EDGE) {
  const image = await loadImageSource(file);
  const { width, height } = fitWithin(image.width, image.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image.source, 0, 0, width, height);
  image.release();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('IMAGE_ENCODE_FAILED');
  return { base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
}

export { fitWithin, resizeImageFile, MAX_EDGE };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test public/test/imageResize.test.js`
Expected: PASS — 8 tests

`resizeImageFile` is deliberately untested: canvas and ImageBitmap do not exist in jsdom, and the function is a thin adapter over `fitWithin` plus browser APIs. It is exercised by hand in Task 6's verification step.

- [ ] **Step 5: Commit**

```bash
git add public/imageResize.js public/test/imageResize.test.js
git commit -m "feat(frontend): client-side image downscale to a 1024px long edge"
```

---

### Task 6: 여행사진 — 다중 업로드 + 고정 프레임 (`views/tripPhotos.js`)

**Files:**
- Create: `public/views/tripPhotos.js`
- Modify: `public/views/report.js` (사진 섹션 마크업/핸들러/`tripPhotosCache` 제거, 54-58행·119-139행·142-210행)
- Modify: `public/style.css` (파일 끝)

**Interfaces:**
- Consumes: `resizeImageFile` (Task 5), `callFunction`, `getSession`, `openModal`, `closeModal`, `showToast`, `escapeHtml`
- Produces: `renderTripPhotosInto(container: HTMLElement, tripId: string) => Promise<void>`

- [ ] **Step 1: Add the photo styles to `public/style.css`**

Append at the end of the file:

```css
/* ── TRIP PHOTOS ── */
.tp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 6px; }
.tp-thumb { width: 100%; height: 90px; object-fit: cover; border-radius: var(--radius); cursor: pointer; }

/* A square frame with object-fit:contain pins the image box regardless of
   orientation, so the prev/next/delete buttons below never shift. Square beats
   4/3 here: a 3:4 portrait renders 293x390 instead of 220x293. */
.tp-frame {
  aspect-ratio: 1 / 1; width: 100%;
  background: var(--paper-2); border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.tp-frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
```

- [ ] **Step 2: Create `public/views/tripPhotos.js`**

```js
import { callFunction } from '../api.js';
import { getSession } from '../session.js';
import {
  openModal, closeModal, showToast, escapeHtml,
} from '../ui.js';
import { resizeImageFile } from '../imageResize.js';

const UPLOAD_LABEL = '사진 추가';

// The photo list is held in this closure rather than at module scope so two
// mounted views can never read each other's cache.
async function renderTripPhotosInto(container, tripId) {
  container.innerHTML = `
    <input type="file" accept="image/jpeg,image/png" id="tp-upload" multiple style="display:none">
    <button type="button" class="btn btn-secondary" id="tp-upload-btn" style="margin-bottom:0.6rem">${UPLOAD_LABEL}</button>
    <div id="tp-gallery"><p class="muted">불러오는 중...</p></div>`;

  const gallery = container.querySelector('#tp-gallery');
  const button = container.querySelector('#tp-upload-btn');
  const input = container.querySelector('#tp-upload');
  let photos = [];

  async function load() {
    try {
      const result = await callFunction('listTripPhotos', { tripId });
      photos = result.photos;
    } catch (err) {
      gallery.innerHTML = '<p class="muted">사진을 불러오지 못했습니다.</p>';
      return;
    }
    gallery.innerHTML = photos.length
      ? `<div class="tp-grid">${photos.map((p, i) => `<img src="${escapeHtml(p.url)}" data-index="${i}" class="tp-thumb" alt="여행사진">`).join('')}</div>`
      : '<p class="muted">여행사진이 없습니다.</p>';
    gallery.querySelectorAll('.tp-thumb').forEach((img) => {
      img.addEventListener('click', () => openAt(Number(img.dataset.index)));
    });
  }

  function openAt(index) {
    const photo = photos[index];
    if (!photo) return;
    const session = getSession();
    const canDelete = session.role === 'admin' || photo.uploadedBy === session.memberId;

    const step = (next) => { if (next >= 0 && next < photos.length) openAt(next); };

    openModal('여행사진', `
      <div class="tp-frame"><img src="${escapeHtml(photo.url)}" alt="여행사진"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.6rem">
        <button type="button" class="btn btn-secondary" id="tp-prev" ${index === 0 ? 'disabled' : ''}>◀ 이전</button>
        <span class="muted" style="font-size:12px">${index + 1} / ${photos.length}</span>
        <button type="button" class="btn btn-secondary" id="tp-next" ${index === photos.length - 1 ? 'disabled' : ''}>다음 ▶</button>
      </div>
      ${canDelete ? '<button type="button" class="btn btn-danger btn-block" id="tp-delete" style="margin-top:0.6rem">삭제</button>' : ''}`, {
      onKeydown: (e) => {
        if (e.key === 'ArrowLeft') step(index - 1);
        if (e.key === 'ArrowRight') step(index + 1);
      },
    });

    document.getElementById('tp-prev').addEventListener('click', () => step(index - 1));
    document.getElementById('tp-next').addEventListener('click', () => step(index + 1));

    const deleteButton = document.getElementById('tp-delete');
    if (!deleteButton) return;
    deleteButton.addEventListener('click', async () => {
      deleteButton.disabled = true;
      deleteButton.textContent = '삭제 중...';
      try {
        await callFunction('deleteTripPhoto', { tripId, photoId: photo.id });
        closeModal();
        await load();
        showToast('사진이 삭제되었습니다', 'success');
      } catch (err) {
        deleteButton.disabled = false;
        deleteButton.textContent = '삭제';
        showToast(err.message, 'error');
      }
    });
  }

  // Sequential, not parallel: a phone uploading eight full-size photos at once
  // runs out of memory and sockets. One failure must not abandon the rest.
  async function uploadAll(files) {
    button.disabled = true;
    let uploaded = 0;
    let lastError = null;
    for (let i = 0; i < files.length; i += 1) {
      button.textContent = `올리는 중 ${i + 1}/${files.length}...`;
      try {
        const { base64, mimeType } = await resizeImageFile(files[i]);
        await callFunction('addTripPhoto', { tripId, photoBase64: base64, mimeType });
        uploaded += 1;
      } catch (err) {
        lastError = err;
      }
    }
    button.disabled = false;
    button.textContent = UPLOAD_LABEL;
    await load();

    if (uploaded === files.length) showToast(`${uploaded}장이 추가되었습니다`, 'success');
    else if (uploaded > 0) showToast(`${files.length}장 중 ${uploaded}장 업로드 (${files.length - uploaded}장 실패)`, 'error');
    else showToast(lastError ? lastError.message : '업로드에 실패했습니다', 'error');
  }

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    try {
      await uploadAll(files);
    } finally {
      e.target.value = ''; // let the same file be picked again
    }
  });

  await load();
}

export { renderTripPhotosInto };
```

- [ ] **Step 3: Strip the photo code out of `public/views/report.js`**

Add to the imports:

```js
import { renderTripPhotosInto } from './tripPhotos.js';
```

Replace the photo section markup (lines 54-58) with:

```js
    <div class="section"><h2>여행사진</h2><div id="report-photos"></div></div>`;
```

Delete the upload handler block at lines 119-137 (`const upBtn = ...` through the end of the `upInput.addEventListener` call) and replace the trailing `await loadTripPhotos(container, session.tripId);` at line 139 with:

```js
  await renderTripPhotosInto(container.querySelector('#report-photos'), session.tripId);
```

Delete these now-dead top-level members entirely:
- `let tripPhotosCache = [];` (line 142)
- `async function loadTripPhotos(...)` (lines 144-159)
- `function renderLightbox(...)` (lines 161-175)
- `function openTripPhoto(...)` (lines 177-210)

Then remove `fileToBase64` from report.js's `../ui.js` import — nothing in the file uses it any more. Leave `openModal`, `closeModal`, `showToast`, `escapeHtml` in place; the settlement code still needs them.

- [ ] **Step 4: Verify nothing dangles**

Run: `git grep -n "tripPhotosCache\|loadTripPhotos\|openTripPhoto\|renderLightbox" public/`
Expected: no output

Run: `git grep -n "fileToBase64" public/views/report.js`
Expected: no output

Run: `node --test public/test/*.test.js`
Expected: PASS

- [ ] **Step 5: Verify by hand in the browser**

Start the emulator suite, open a trip report, and confirm:
1. 사진 추가 → 파일 선택 대화상자에서 **여러 장 선택 가능**
2. 업로드 중 버튼 텍스트가 `올리는 중 2/5...` 로 진행
3. 업로드된 사진을 열어 개발자도구에서 이미지 크기를 확인 — 긴 변이 1024 이하
4. 가로 사진과 세로 사진을 번갈아 넘길 때 **이전/다음 버튼이 위아래로 움직이지 않음**

- [ ] **Step 6: Commit**

```bash
git add public/views/tripPhotos.js public/views/report.js public/style.css
git commit -m "feat(frontend): multi-select photo upload with resize and a fixed lightbox frame"
```

---

### Task 7: 백엔드 — 1인·하루 기준 카테고리 평균

**Files:**
- Modify: `functions/src/functions/report.js`
- Modify: `functions/test/functions/report.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `getReportData` 반환값에 추가/변경
  - `tripDays: number | null` — 여행 일수(`end - start + 1`), 기간이 유효하지 않으면 `null`
  - `currentCategoryPerDay: { [category: string]: number }` — 1인·하루 분담액
  - `groupCategoryPerDayAverages: { [category: string]: number }` — 과거 완료 여행들의 같은 값 평균
  - `tripsInComparison: number` — **유효한 기간을 가진** 비교 대상 수
  - `currentCategoryAverages` / `groupCategoryAverages` 제거
  - `tripDays` 도 named export로 내보내 테스트에서 직접 호출한다

- [ ] **Step 1: Write the failing tests**

First, `functions/test/functions/report.test.js`의 `seedTrip` 헬퍼가 모든 여행을 `period: { start: null, end: null }` 로 만들고 있다. 기간을 인자로 받도록 바꾼다 — 기존 헬퍼(6-16행)를 교체:

```js
async function seedTrip(db, {
  id, group, status, members, expenses, period = { start: '2026-01-01', end: '2026-01-02' },
}) {
  await db.collection('trips').doc(id).set({
    name: id, group, status, period, location: '', lodging: '',
  });
  for (const m of members) {
    await db.collection('trips').doc(id).collection('members').doc(m.id).set(m);
  }
  for (const e of expenses) {
    await db.collection('trips').doc(id).collection('expenses').add(e);
  }
}
```

기본값은 2일짜리 여행이다(`01-01` ~ `01-02`), 그래야 기존 테스트의 금액이 하루 기준으로 나눠떨어진다.

Update the import on line 3:

```js
const { getReportData, perPersonCategoryAverage, tripDays } = require('../../src/functions/report');
```

Now update the two existing assertions that reference the removed fields.

Line 120 — `'returns settlement and current-trip category averages'`:

```js
    expect(result.currentCategoryAverages['식비']).toBe(20000);
```

becomes:

```js
    // 20000 per person over a 2-day trip
    expect(result.currentCategoryPerDay['식비']).toBe(10000);
    expect(result.tripDays).toBe(2);
```

Line 214 — `'averages the comparison across completed trips in the same group only'`:

```js
    expect(result.groupCategoryAverages['식비']).toBe(30000);
```

becomes:

```js
    // past-sfa: 30000 per person over 2 days
    expect(result.groupCategoryPerDayAverages['식비']).toBe(15000);
```

Then append this new describe block at the end of the file:

```js
describe('tripDays', () => {
  test('counts both endpoints, so a same-day trip is one day', () => {
    expect(tripDays({ start: '2026-07-30', end: '2026-07-30' })).toBe(1);
  });

  test('counts an inclusive multi-day range', () => {
    expect(tripDays({ start: '2026-07-30', end: '2026-08-02' })).toBe(4);
  });

  test('is immune to DST -- the span is measured in UTC', () => {
    expect(tripDays({ start: '2026-03-01', end: '2026-03-31' })).toBe(31);
  });

  test('returns null for a missing, partial, or malformed period', () => {
    expect(tripDays(null)).toBeNull();
    expect(tripDays({})).toBeNull();
    expect(tripDays({ start: null, end: null })).toBeNull();
    expect(tripDays({ start: '2026-07-30', end: null })).toBeNull();
    expect(tripDays({ start: '2026/07/30', end: '2026/08/02' })).toBeNull();
  });

  test('returns null when the end precedes the start', () => {
    expect(tripDays({ start: '2026-08-02', end: '2026-07-30' })).toBeNull();
  });
});

describe('getReportData per-day normalisation', () => {
  test('normalises the current trip by its own length', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-07-01', end: '2026-07-04' }, // 4 days
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 80000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.tripDays).toBe(4);
    expect(result.currentCategoryPerDay['식비']).toBe(20000); // 80000 / 4
  });

  test('compares against past trips on a per-day basis, so trip length does not skew it', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-07-01', end: '2026-07-02' }, // 2 days
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    // A 4-day trip that spent twice as much in total -- but the same per day.
    await seedTrip(db, {
      id: 'past-long',
      group: 'SFA',
      status: 'completed',
      period: { start: '2026-01-01', end: '2026-01-04' },
      members: [{ id: 'x', name: 'X', weight: 1 }],
      expenses: [{
        category: '식비', amount: 80000, enteredBy: 'x', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.currentCategoryPerDay['식비']).toBe(20000);
    expect(result.groupCategoryPerDayAverages['식비']).toBe(20000);
    expect(result.tripsInComparison).toBe(1);
  });

  test('drops a past trip with no usable period from both the average and the count', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: '2026-07-01', end: '2026-07-02' },
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'past-good',
      group: 'SFA',
      status: 'completed',
      period: { start: '2026-01-01', end: '2026-01-02' },
      members: [{ id: 'x', name: 'X', weight: 1 }],
      expenses: [{
        category: '식비', amount: 30000, enteredBy: 'x', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'past-undated',
      group: 'SFA',
      status: 'completed',
      period: { start: null, end: null },
      members: [{ id: 'y', name: 'Y', weight: 1 }],
      expenses: [{
        category: '식비', amount: 999999, enteredBy: 'y', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.groupCategoryPerDayAverages['식비']).toBe(15000); // 30000 / 2, undated one ignored
    expect(result.tripsInComparison).toBe(1);
  });

  test('reports tripDays null and no comparison when the current trip has no period', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      period: { start: null, end: null },
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    await seedTrip(db, {
      id: 'past-good',
      group: 'SFA',
      status: 'completed',
      period: { start: '2026-01-01', end: '2026-01-02' },
      members: [{ id: 'x', name: 'X', weight: 1 }],
      expenses: [{
        category: '식비', amount: 30000, enteredBy: 'x', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.tripDays).toBeNull();
    expect(result.currentCategoryPerDay).toEqual({});
    expect(result.tripsInComparison).toBe(0);
    // The settlement itself is unaffected by a missing period.
    expect(result.settlement.totalConfirmed).toBe(40000);
  });

  test('no longer ships the trip-total category fields', async () => {
    const db = new FakeFirestore();
    await seedTrip(db, {
      id: 'current',
      group: 'SFA',
      status: 'active',
      members: [{ id: 'a', name: 'A', weight: 1 }],
      expenses: [{
        category: '식비', amount: 40000, enteredBy: 'a', confirmed: true, excludedMembers: [],
      }],
    });
    const { token } = await createSession(db, { role: 'admin', tripId: 'current' });

    const result = await getReportData(db, { sessionToken: token, tripId: 'current' });

    expect(result.currentCategoryAverages).toBeUndefined();
    expect(result.groupCategoryAverages).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix functions test -- report.test.js`
Expected: FAIL — `tripDays is not a function`, plus the updated assertions reporting `undefined`

- [ ] **Step 3: Write the implementation**

In `functions/src/functions/report.js`, add these two helpers directly above `getReportData`:

```js
function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

// Inclusive day count. Parsed as UTC so a DST boundary inside the range cannot
// shift the result by a day. null means "cannot be compared on a per-day basis".
function tripDays(period) {
  if (!period) return null;
  const start = parseIsoDate(period.start);
  const end = parseIsoDate(period.end);
  if (start === null || end === null || end < start) return null;
  return Math.round((end - start) / 86400000) + 1;
}
```

Replace line 57 (`const { averages: currentCategoryAverages } = ...`) with:

```js
  const days = tripDays(trip.period);
  const { averages: currentTotals } = perPersonCategoryAverage(members, expenses);
  const currentCategoryPerDay = {};
  if (days) {
    for (const category of Object.keys(currentTotals)) {
      currentCategoryPerDay[category] = currentTotals[category] / days;
    }
  }
```

Replace the comparison loop (lines 65-79) with:

```js
  const perCategorySums = {};
  const perCategoryCounts = {};
  let comparableTrips = 0;
  for (const tripDoc of otherTrips) {
    // A trip with no usable period cannot be put on a per-day axis, so it is
    // excluded from the average and from the count the UI shows.
    const pastDays = tripDays(tripDoc.data().period);
    if (!pastDays) continue;
    comparableTrips += 1;
    const bundle = await loadTripBundle(db, tripDoc.id);
    const { averages } = perPersonCategoryAverage(bundle.members, bundle.expenses);
    for (const category of Object.keys(averages)) {
      perCategorySums[category] = (perCategorySums[category] || 0) + averages[category] / pastDays;
      perCategoryCounts[category] = (perCategoryCounts[category] || 0) + 1;
    }
  }

  const groupCategoryPerDayAverages = {};
  for (const category of Object.keys(perCategorySums)) {
    groupCategoryPerDayAverages[category] = perCategorySums[category] / perCategoryCounts[category];
  }
```

Replace the return statement's last three fields (lines 88-90):

```js
    currentCategoryAverages,
    groupCategoryAverages,
    tripsInComparison: otherTrips.length,
```

with:

```js
    tripDays: days,
    currentCategoryPerDay,
    groupCategoryPerDayAverages,
    tripsInComparison: days ? comparableTrips : 0,
```

Finally, update the export on the last line:

```js
module.exports = { getReportData, perPersonCategoryAverage, tripDays };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix functions test -- report.test.js`
Expected: PASS

- [ ] **Step 5: Run the whole backend suite for regressions**

Run: `npm --prefix functions test`
Expected: PASS — 19 suites

- [ ] **Step 6: Commit**

```bash
git add functions/src/functions/report.js functions/test/functions/report.test.js
git commit -m "feat(functions): normalise category comparison to per-person-per-day"
```

---

### Task 8: 카테고리 분석 — 도넛 정리 + 비교 표 (`charts.js`)

**Files:**
- Create: `public/charts.js`
- Modify: `public/views/report.js` (`CATEGORY_COLORS`·`renderDonutChart`·`renderComparisonBars` 제거, 분석 섹션 재작성)
- Modify: `public/style.css` (파일 끝)

**Interfaces:**
- Consumes: `categoryMark`, `categoryDot` (Task 2), `escapeHtml`; 백엔드의 `tripDays` / `currentCategoryPerDay` / `groupCategoryPerDayAverages` (Task 7)
- Produces:
  - `renderDonutChart(categoryTotals: object) => string`
  - `renderCategoryComparison(currentPerDay: object, groupPerDay: object, tripDays: number) => string`

- [ ] **Step 1: Add the comparison-table styles to `public/style.css`**

Append at the end of the file:

```css
/* ── CATEGORY COMPARISON ── */
.cmp-table { width: 100%; border-collapse: collapse; }
.cmp-table thead th {
  text-align: left; font-size: 11px; font-weight: 500;
  color: var(--ink-3); padding: 0.5rem 0.4rem;
}
.cmp-table td { padding: 0.55rem 0.4rem; border-top: 1px solid var(--rule); vertical-align: middle; }
.cmp-table .cmp-num { text-align: right; white-space: nowrap; }
.cmp-table .cmp-cat { white-space: nowrap; }
.cmp-legend-row { display: flex; align-items: center; gap: 0.4rem; font-size: 12px; margin-bottom: 0.3rem; }

/* Direction from the centre line carries the sign; the bar's colour is the
   category's own identity colour. Green/red and the standard blue/red
   diverging pair both failed CVD separation, so polarity is positional. */
.cmp-bar { position: relative; height: 10px; min-width: 60px; }
.cmp-bar::before {
  content: ''; position: absolute; left: 50%; top: -3px; bottom: -3px;
  width: 1px; background: var(--rule);
}
.cmp-bar-fill { position: absolute; top: 0; height: 10px; border-radius: 2px; min-width: 2px; }
.cmp-bar-pos { left: 50%; }
.cmp-bar-neg { right: 50%; }

@media (max-width: 480px) {
  .cmp-table { font-size: 12px; }
  .cmp-table thead th { font-size: 10px; padding: 0.4rem 0.25rem; }
  .cmp-table td { padding: 0.45rem 0.25rem; }
  .cmp-table .cmp-group { display: none; }
}
```

- [ ] **Step 2: Create `public/charts.js`**

```js
import { escapeHtml } from './ui.js';
import { categoryMark, categoryDot } from './categories.js';

const RADIUS = 40;
const SEGMENT_GAP = 2; // surface gap between donut segments, in path units

function renderDonutChart(categoryTotals) {
  const entries = Object.entries(categoryTotals).filter(([, amount]) => amount > 0);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (total <= 0) return '<p class="muted">지출 내역이 없습니다.</p>';

  const circumference = 2 * Math.PI * RADIUS;
  let offset = 0;
  const circles = entries.map(([category, amount]) => {
    const dash = (amount / total) * circumference;
    const visible = Math.max(0, dash - SEGMENT_GAP);
    const circle = `<circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="${categoryMark(category)}" stroke-width="16" stroke-dasharray="${visible} ${circumference - visible}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"></circle>`;
    offset += dash;
    return circle;
  }).join('');

  const legend = entries.map(([category, amount]) => `
    <div class="cmp-legend-row">${categoryDot(category)}
      <span>${escapeHtml(category)} · ${Math.round(amount).toLocaleString()}원 · ${Math.round((amount / total) * 100)}%</span>
    </div>`).join('');

  return `
    <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem">
      <svg viewBox="0 0 100 100" width="140" height="140">${circles}</svg>
      <div>${legend}</div>
    </div>`;
}

function renderCategoryComparison(currentPerDay, groupPerDay, tripDays) {
  const rows = Object.keys(currentPerDay)
    // A category the group has never spent on has no baseline to divide by.
    .filter((category) => groupPerDay[category] > 0)
    .map((category) => {
      const current = currentPerDay[category];
      const group = groupPerDay[category];
      return {
        category,
        current: Math.round(current),
        group: Math.round(group),
        pct: Math.round(((current - group) / group) * 100),
        delta: Math.round((current - group) * tripDays),
      };
    })
    .sort((a, b) => b.current - a.current);

  if (rows.length === 0) return '<p class="muted">비교할 수 있는 카테고리가 없습니다.</p>';

  // Normalised on the largest |percentage| in the table, not on amounts.
  const maxAbsPct = Math.max(...rows.map((r) => Math.abs(r.pct)), 1);

  const body = rows.map((r) => {
    const width = (Math.abs(r.pct) / maxAbsPct) * 50;
    const bar = r.pct === 0 ? '' : `<div class="cmp-bar-fill ${r.pct > 0 ? 'cmp-bar-pos' : 'cmp-bar-neg'}" style="width:${width}%;background:${categoryMark(r.category)}"></div>`;
    const tone = r.pct >= 0 ? 'pay' : 'receive';
    const sign = r.pct >= 0 ? '+' : '';
    return `
      <tr>
        <td class="cmp-cat">${categoryDot(r.category)} ${escapeHtml(r.category)}</td>
        <td class="cmp-num mono">${r.current.toLocaleString()}</td>
        <td class="cmp-num mono cmp-group">${r.group.toLocaleString()}</td>
        <td><div class="cmp-bar">${bar}</div></td>
        <td class="cmp-num mono" style="color:var(--${tone})">${sign}${r.pct}%</td>
        <td class="cmp-num mono" style="color:var(--${tone})">${sign}${r.delta.toLocaleString()}원</td>
      </tr>`;
  }).join('');

  return `
    <p class="label" style="margin-bottom:0.4rem">카테고리 비교 · 하루 · 1인 기준</p>
    <div style="overflow-x:auto">
    <table class="cmp-table">
      <thead><tr>
        <th class="cmp-cat">카테고리</th>
        <th class="cmp-num">이번</th>
        <th class="cmp-num cmp-group">그룹평균</th>
        <th>편차</th>
        <th class="cmp-num">%</th>
        <th class="cmp-num">여행 전체</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
}

export { renderDonutChart, renderCategoryComparison };
```

- [ ] **Step 3: Wire it into `public/views/report.js`**

Add to the imports:

```js
import { renderDonutChart, renderCategoryComparison } from '../charts.js';
```

Delete `const CATEGORY_COLORS = { ... }` (lines 5-12), `function renderDonutChart(...)` (lines 248-274), and `function renderComparisonBars(...)` (lines 276-292) — all three now live in `charts.js` or are gone.

Update the destructure on line 27 to take the new payload fields:

```js
  const {
    trip, members, expenses, settlement,
    tripDays, currentCategoryPerDay, groupCategoryPerDayAverages, tripsInComparison,
  } = data;
```

Replace the 카테고리 분석 section (lines 44-47) with:

```js
    <div class="section"><h2>카테고리 분석</h2>
      ${renderDonutChart(settlement.categoryTotals)}
      ${renderComparisonSection(tripDays, currentCategoryPerDay, groupCategoryPerDayAverages, tripsInComparison)}
    </div>
```

And add this helper next to the other render functions at the bottom of the file:

```js
function renderComparisonSection(tripDays, currentPerDay, groupPerDay, tripsInComparison) {
  if (!tripDays) return '<p class="muted">여행 기간이 설정되지 않아 하루 기준 비교를 계산할 수 없습니다.</p>';
  if (tripsInComparison === 0) return '<p class="muted">비교할 과거 여행이 아직 없습니다.</p>';
  return renderCategoryComparison(currentPerDay, groupPerDay, tripDays);
}
```

- [ ] **Step 4: Verify nothing dangles**

Run: `git grep -n "CATEGORY_COLORS\|renderComparisonBars"`
Expected: no output

Run: `node --test public/test/*.test.js`
Expected: PASS

- [ ] **Step 5: Verify by hand in the browser**

Open a trip report against the emulator and confirm:
1. 도넛 세그먼트 사이에 얇은 간격이 있고 범례에 `카테고리 · 금액 · %` 가 보인다
2. 비교 표의 모든 금액에 **소수점이 없다**
3. 편차 막대가 중앙선 기준으로 좌/우로 뻗고, 막대 색이 같은 행의 점 색과 일치한다
4. 브라우저 폭을 375px로 줄이면 `그룹평균` 컬럼이 사라지고 표가 가로 스크롤 없이 들어간다
5. 기간이 없는 여행에서는 표 대신 안내 문구가 나온다

- [ ] **Step 6: Commit**

```bash
git add public/charts.js public/views/report.js public/style.css
git commit -m "feat(frontend): per-day category comparison table with diverging bars"
```

---

### Task 9: 전체 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: Run every suite**

Run: `node --test public/test/*.test.js`
Expected: PASS — format, categories, imageResize, ui, api, router, session

Run: `npm --prefix functions test`
Expected: PASS — 19 suites

- [ ] **Step 2: Confirm the payload contract holds end to end**

Run: `git grep -n "currentCategoryAverages\|groupCategoryAverages"`
Expected: no output — the removed fields are gone from both sides

- [ ] **Step 3: Walk the app once against the emulator**

1. 경비 입력 모달 — 카테고리 칩에 색 점이 보이고 선택이 정상 동작
2. 멤버 경비목록 — 태그 색상이 카테고리별로 다르고 날짜가 `7.30` 형태
3. 관리자 경비목록 — 동일
4. 리포트 전체 지출 내역 — 375px 폭에서 결제자가 한 줄, 금액의 `원`이 붙어 있음
5. 리포트 여행사진 — 다중 업로드, 고정 프레임 라이트박스
6. 리포트 카테고리 분석 — 정수 금액, 비교 표, 막대

- [ ] **Step 4: Commit any fixes found, then push the branch**

```bash
git push -u origin plan-9-photos-report-polish
```
