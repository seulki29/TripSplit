# Plan 10 — 카테고리 비교 산출 근거 모달 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카테고리 비교 표의 행을 누르면 그 카테고리의 산출 과정을 보여주고, 표 아래에 컬럼 정의와 해석을 접이식으로 제공한다.

**Architecture:** `public/charts.js`에 순수 문자열 함수 `renderComparisonDetail`을 추가하고, `renderCategoryComparison`은 행/셀에 `data-` 속성만 단다. DOM 접근과 클릭 바인딩은 `public/views/report.js`에만 둔다 — `.settle-card`가 이미 쓰는 패턴이며 charts.js가 순수하게 남아 단위 테스트가 가능하다. 백엔드는 건드리지 않는다.

**Tech Stack:** 빌드 없는 바닐라 ESM 프론트엔드, `node:test` + `node:assert/strict`

## Global Constraints

- 프론트엔드는 ESM(`import`/`export`). 빌드 단계 없음, 새 의존성 없음.
- **백엔드는 이 계획에서 변경하지 않는다.** `functions/` 아래 어떤 파일도 수정하지 않는다.
- 프론트 테스트는 `node:test` + `node:assert/strict`. 실행: `node --test public/test/*.test.js` (루트 `npm test`는 Node 24에서 깨져 있으므로 쓰지 않는다).
- 사용자에게 보이는 문자열은 한국어.
- HTML 문자열에 삽입되는 모든 사용자/DB 유래 값은 `escapeHtml`을 통과해야 한다.
- `charts.js`의 `renderCategoryComparison`과 `renderComparisonDetail`은 **순수 문자열 함수**로 유지한다. `document`, 이벤트 리스너, 전역 상태를 쓰지 않는다.
- **소수 표기는 하루 1인 값(`이번`/`그룹평균`/`차이`)에만** 적용한다. 최대 2자리, 뒤따르는 0 제거. 카테고리 총액·인원·일수·편차 %·`여행 전체` 결과값은 정수.
- `여행 전체`와 `편차`는 **반올림 전** 하루 값으로 계산한 뒤 마지막에 한 번만 반올림한다. 표시된 정수끼리 다시 계산하지 않는다.
- 카테고리 색상 팔레트와 슬롯 순서는 색각안전성 검증을 거친 값이다. 건드리지 않는다.

---

### Task 1: 모달 본문 렌더러 `renderComparisonDetail`

**Files:**
- Modify: `public/charts.js`
- Test: `public/test/charts.test.js`

**Interfaces:**
- Consumes: `escapeHtml` from `./ui.js` (charts.js가 이미 import 중)
- Produces:
  ```
  renderComparisonDetail({
    category: string,
    categoryTotal: number,        // 확정 지출 카테고리 총액
    headcount: number,            // 여행 전체 분담 인원
    tripDays: number,
    currentPerDay: number,        // 반올림 전
    groupPerDay: number|undefined,// 반올림 전, 기준 없으면 undefined
    tripsInComparison: number,
    focus: 'current'|'group'|'cmp'|'delta'|null,
  }) => string   // 모달 body HTML
  ```

- [ ] **Step 1: Write the failing test**

`public/test/charts.test.js` 맨 아래에 추가한다. 파일 상단 import도 함께 고친다:

```js
import { renderDonutChart, renderCategoryComparison, renderComparisonDetail } from '../charts.js';
```

```js
describe('charts.js renderComparisonDetail', () => {
  // The real 평창 numbers: 식비 2,494,700원 / 7명 / 3일 -> 118,795.2381원/일,
  // group baseline 49,530원/일 (영월 990,600 / 10명 / 2일).
  const base = {
    category: '식비',
    categoryTotal: 2494700,
    headcount: 7,
    tripDays: 3,
    currentPerDay: 2494700 / 7 / 3,
    groupPerDay: 49530,
    tripsInComparison: 1,
    focus: null,
  };

  test('shows the 이번 line as total / headcount / days', () => {
    const html = renderComparisonDetail(base);
    assert.match(html, /2,494,700원 ÷ 7명 ÷ 3일/);
    assert.match(html, /118,795\.24원\/일/);
  });

  test('drops trailing zeros on a whole-number per-day figure', () => {
    const html = renderComparisonDetail(base);
    // 49,530 exactly -- must not render as 49,530.00
    assert.match(html, /49,530원\/일/);
    assert.doesNotMatch(html, /49,530\.00/);
  });

  test('percentage and trip-total come from the unrounded difference', () => {
    const html = renderComparisonDetail(base);
    // 118,795.2381 - 49,530 = 69,265.2381
    assert.match(html, /69,265\.24원\/일/);
    assert.match(html, /\+140%/);
    // 69,265.2381 x 3 = 207,795.71 -> 207,796.
    // Hand-computing from the rounded table values gives 207,795, which is the
    // discrepancy this modal exists to explain -- so 207,795 must NOT appear.
    assert.match(html, /\+207,796원/);
    assert.doesNotMatch(html, /207,795원/);
  });

  test('states the comparison base trip count', () => {
    assert.match(renderComparisonDetail(base), /과거 완료 여행 1개/);
  });

  test('carries an interpretation line built from this row\'s own figures', () => {
    const html = renderComparisonDetail(base);
    assert.match(html, /148,590원/);  // 49,530 x 3
    assert.match(html, /356,386원/);  // 118,795.2381 x 3, rounded once
  });

  test('notes that the table rounds', () => {
    assert.match(renderComparisonDetail(base), /반올림/);
  });

  test('a category with no group baseline shows — and explains why', () => {
    const html = renderComparisonDetail({
      ...base, category: '놀이', categoryTotal: 210000, groupPerDay: undefined,
      currentPerDay: 210000 / 7 / 3,
    });
    assert.match(html, /210,000원 ÷ 7명 ÷ 3일/);
    assert.match(html, /—/);
    assert.match(html, /비교 기준이 없습니다/);
    // No deviation chain is rendered at all.
    assert.doesNotMatch(html, /%/);
  });

  test('treats a zero group baseline as no baseline', () => {
    const html = renderComparisonDetail({ ...base, groupPerDay: 0 });
    assert.match(html, /비교 기준이 없습니다/);
  });

  test('highlights only the focused line', () => {
    const onDelta = renderComparisonDetail({ ...base, focus: 'delta' });
    assert.equal((onDelta.match(/cmp-focus/g) || []).length, 1);
    assert.match(onDelta, /cmp-focus[^>]*>[\s\S]*?여행 전체/);

    const none = renderComparisonDetail({ ...base, focus: null });
    assert.doesNotMatch(none, /cmp-focus/);
  });

  test('every focus value maps to a line', () => {
    for (const focus of ['current', 'group', 'cmp', 'delta']) {
      const html = renderComparisonDetail({ ...base, focus });
      assert.equal((html.match(/cmp-focus/g) || []).length, 1, `focus=${focus}`);
    }
  });

  test('escapes the category label', () => {
    const html = renderComparisonDetail({ ...base, category: '<img src=x>' });
    assert.match(html, /&lt;img src=x&gt;/);
    assert.doesNotMatch(html, /<img src=x>/);
  });

  test('omits the division line when headcount is zero', () => {
    const html = renderComparisonDetail({ ...base, headcount: 0, currentPerDay: 0 });
    assert.doesNotMatch(html, /÷ 0명/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test public/test/charts.test.js`
Expected: FAIL — `renderComparisonDetail is not a function`

- [ ] **Step 3: Write the implementation**

`public/charts.js`에 추가한다. `renderCategoryComparison` 아래, `export` 위에 둔다.

```js
// Per-day figures keep up to two decimals here. The table rounds them to won;
// repeating that rounding inside the modal would break the chain -- hand-adding
// the rounded values is exactly the 1-won discrepancy this modal explains.
function perDay(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function detailRow(label, value, isFocus) {
  return `
    <div class="cmp-detail-row${isFocus ? ' cmp-focus' : ''}">
      <span class="label">${label}</span>
      <span class="mono cmp-detail-value">${value}</span>
    </div>`;
}

function renderComparisonDetail({
  category, categoryTotal, headcount, tripDays,
  currentPerDay, groupPerDay, tripsInComparison, focus,
}) {
  const name = escapeHtml(category);
  const currentValue = headcount > 0
    ? `${Number(categoryTotal).toLocaleString()}원 ÷ ${headcount}명 ÷ ${tripDays}일 = ${perDay(currentPerDay)}원/일`
    : `${perDay(currentPerDay)}원/일`;

  const hasGroup = typeof groupPerDay === 'number' && groupPerDay > 0;
  if (!hasGroup) {
    return `
      ${detailRow('이번', currentValue, focus === 'current')}
      ${detailRow('그룹평균', '—', focus === 'group')}
      <p class="muted" style="margin-top:0.8rem;font-size:13px">과거 완료 여행에 '${name}' 지출이 없어 비교 기준이 없습니다.</p>`;
  }

  const diff = currentPerDay - groupPerDay;
  const pct = Math.round((diff / groupPerDay) * 100);
  const delta = Math.round(diff * tripDays);
  const sign = pct >= 0 ? '+' : '';
  const tone = pct >= 0 ? 'pay' : 'receive';

  return `
    ${detailRow('이번', currentValue, focus === 'current')}
    ${detailRow('그룹평균', `${perDay(groupPerDay)}원/일`, focus === 'group')}
    <p class="muted" style="margin:0 0 0.2rem 0.5rem;font-size:12px">과거 완료 여행 ${tripsInComparison}개의 하루 비율 평균</p>
    <div class="cmp-detail-rule"></div>
    ${detailRow('차이', `${perDay(diff)}원/일`, false)}
    ${detailRow('편차', `${perDay(diff)} ÷ ${perDay(groupPerDay)} = <strong style="color:var(--${tone})">${sign}${pct}%</strong>`, focus === 'cmp')}
    ${detailRow('여행 전체', `${perDay(diff)} × ${tripDays}일 = <strong style="color:var(--${tone})">${sign}${delta.toLocaleString()}원</strong>`, focus === 'delta')}
    <p style="margin-top:0.8rem;font-size:13px">평소 페이스대로였다면 ${tripDays}일간 1인당 ${Math.round(groupPerDay * tripDays).toLocaleString()}원. 이번엔 ${Math.round(currentPerDay * tripDays).toLocaleString()}원 들었습니다.</p>
    <p class="muted" style="margin-top:0.5rem;font-size:12px">표의 숫자는 원 단위로 반올림해 표시합니다.</p>`;
}
```

`export` 줄을 고친다:

```js
export { renderDonutChart, renderCategoryComparison, renderComparisonDetail };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test public/test/charts.test.js`
Expected: PASS — 새 describe 블록의 11개 테스트 포함 전부 통과

- [ ] **Step 5: Run the whole frontend suite**

Run: `node --test public/test/*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/charts.js public/test/charts.test.js
git commit -m "feat(frontend): renderComparisonDetail — per-category derivation body"
```

---

### Task 2: 표에 data 속성 · 비교 여행 수 라벨 · 접이식 설명

**Files:**
- Modify: `public/charts.js` (`renderCategoryComparison`)
- Modify: `public/views/report.js` (`renderComparisonSection` 인자 전달)
- Test: `public/test/charts.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `renderCategoryComparison(currentPerDay, groupPerDay, tripDays, tripsInComparison) => string`
  — **네 번째 인자가 추가된다.** 각 `<tr>`에 `class="cmp-row" data-category="<카테고리>"`, 금액 셀 4개에 각각 `data-field="current"|"group"|"cmp"|"delta"`.

- [ ] **Step 1: Fix the existing test helper, which this task's markup breaks**

`public/test/charts.test.js`의 `bodyRows`가 여는 태그를 `<tr>`로 정확히 매칭한다. `<tr>`에 속성이 붙으면 매칭이 0건이 되어 **기존 `renderCategoryComparison` 테스트가 전부 깨진다.** 헬퍼를 먼저 고친다:

```js
function bodyRows(html) {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  // The opening tag carries class/data attributes, so it cannot be matched literally.
  return (tbody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || []);
}
```

- [ ] **Step 2: Write the failing tests**

기존 `describe('charts.js renderCategoryComparison', ...)` 블록 안에 추가한다. 이 블록의 기존 호출은 인자가 3개이므로, 새 인자를 쓰는 테스트는 4번째 인자를 명시한다.

```js
  test('each row carries its category and each figure cell its field name', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays, 2);
    const row = rowFor(html, '숙박');
    assert.match(row, /data-category="숙박"/);
    assert.match(row, /class="cmp-row"/);
    for (const field of ['current', 'group', 'cmp', 'delta']) {
      assert.match(row, new RegExp(`data-field="${field}"`), `missing data-field=${field}`);
    }
  });

  test('the category name cell has no data-field, so tapping it focuses nothing', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays, 2);
    const row = rowFor(html, '숙박');
    const catCell = row.match(/<td class="cmp-cat"[^>]*>/)[0];
    assert.doesNotMatch(catCell, /data-field/);
  });

  test('a row without a group baseline still carries its data-field cells', () => {
    const html = renderCategoryComparison({ 놀이: 5000 }, {}, tripDays, 2);
    const row = rowFor(html, '놀이');
    for (const field of ['current', 'group', 'cmp', 'delta']) {
      assert.match(row, new RegExp(`data-field="${field}"`), `missing data-field=${field}`);
    }
  });

  test('the label states how many past trips the comparison uses', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays, 2);
    assert.match(html, /과거 여행 2개와 비교/);
  });

  test('a collapsed help block explains the columns', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays, 2);
    assert.match(html, /<details class="cmp-help">/);
    assert.match(html, /<summary>이 표 읽는 법<\/summary>/);
    // The two caveats that are easy to misread must be stated.
    assert.match(html, /분담 인원/);
    assert.match(html, /정산/);
    // It must be closed by default -- no `open` attribute.
    assert.doesNotMatch(html, /<details class="cmp-help" open>/);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test public/test/charts.test.js`
Expected: FAIL — `data-category`, `과거 여행 2개와 비교`, `<details class="cmp-help">` 없음

- [ ] **Step 4: Update `renderCategoryComparison`**

`public/charts.js`에서 함수 시그니처와 `body`/반환부를 고친다. 계산 로직(`rows`, `maxAbsPct`)은 그대로 둔다.

시그니처:

```js
function renderCategoryComparison(currentPerDay, groupPerDay, tripDays, tripsInComparison) {
```

`body`의 셀들에 `data-field`를 단다 — 기존 셀 생성부를 다음으로 교체한다:

```js
    const groupCell = r.group === null
      ? '<td class="cmp-num mono cmp-group" data-field="group">—</td>'
      : `<td class="cmp-num mono cmp-group" data-field="group">${r.group.toLocaleString()}</td>`;

    let cmpCell;
    let deltaCell;
    if (r.pct === null) {
      cmpCell = '<td class="cmp-num mono" data-field="cmp">—</td>';
      deltaCell = '<td class="cmp-num mono" data-field="delta">—</td>';
    } else {
      const width = (Math.abs(r.pct) / maxAbsPct) * 50;
      const bar = r.pct === 0 ? '' : `<div class="cmp-bar-fill ${r.pct > 0 ? 'cmp-bar-pos' : 'cmp-bar-neg'}" style="width:${width}%;background:${categoryMark(r.category)}"></div>`;
      const tone = r.pct >= 0 ? 'pay' : 'receive';
      const sign = r.pct >= 0 ? '+' : '';
      cmpCell = `<td data-field="cmp"><div class="cmp-cell"><div class="cmp-bar">${bar}</div><span class="cmp-pct mono" style="color:var(--${tone})">${sign}${r.pct}%</span></div></td>`;
      deltaCell = `<td class="cmp-num mono" data-field="delta" style="color:var(--${tone})">${sign}${r.delta.toLocaleString()}원</td>`;
    }

    return `
      <tr class="cmp-row" data-category="${escapeHtml(r.category)}">
        <td class="cmp-cat">${categoryDot(r.category)} ${escapeHtml(r.category)}</td>
        <td class="cmp-num mono" data-field="current">${r.current.toLocaleString()}</td>
        ${groupCell}
        ${cmpCell}
        ${deltaCell}
      </tr>`;
```

반환부를 교체한다:

```js
  return `
    <p class="label" style="margin-bottom:0.4rem">카테고리 비교 · 하루 · 1인 기준 · 과거 여행 ${tripsInComparison}개와 비교</p>
    <p class="muted" style="font-size:12px;margin-bottom:0.4rem">행을 누르면 산출 근거를 볼 수 있습니다.</p>
    <div style="overflow-x:auto">
    <table class="cmp-table">
      <thead><tr>
        <th class="cmp-cat">카테고리</th>
        <th class="cmp-num">이번</th>
        <th class="cmp-num cmp-group">그룹평균</th>
        <th>편차</th>
        <th class="cmp-num">여행 전체</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>
    <details class="cmp-help">
      <summary>이 표 읽는 법</summary>
      <dl>
        <dt>이번</dt>
        <dd>이 여행에서 이 카테고리에 1인이 하루 평균 얼마나 부담했는지. 확정된 지출만 집계합니다.</dd>
        <dt>그룹평균</dt>
        <dd>같은 그룹의 완료된 과거 여행들에서 같은 값을 구해 평균낸 값. 총액을 합쳐 총일수로 나눈 것이 아니라 여행별 하루 비율의 평균이라, 여행 길이가 달라도 긴 여행이 평균을 끌고 가지 않습니다.</dd>
        <dt>편차</dt>
        <dd>두 값의 차이를 비율로 나타낸 것. 씀씀이가 평소와 얼마나 다른지 보여줍니다.</dd>
        <dt>여행 전체</dt>
        <dd>평소 페이스로 이번 여행 길이만큼 갔다면 나왔을 금액과의 차액입니다. 1인 기준이며, 카테고리끼리 더할 수 있습니다.</dd>
        <dt>분담 인원에 대해</dt>
        <dd>1인 평균의 분모는 여행 전체 분담 인원입니다. 특정 카테고리에서 제외된 구성원이 있어도 같은 분모를 쓰므로, 제외가 걸린 카테고리는 실제 참여자 부담보다 낮게 보입니다.</dd>
        <dt>정산 금액과의 차이</dt>
        <dd>정산은 가중치대로 나누고 이 지표는 인원수로 균등하게 나눕니다. 가중치가 전원 같으면 두 값이 일치합니다.</dd>
      </dl>
    </details>`;
```

- [ ] **Step 5: Pass the new argument from report.js**

`public/views/report.js`의 `renderComparisonSection` 마지막 줄을 고친다:

```js
  return renderCategoryComparison(currentPerDay, groupPerDay, tripDays, tripsInComparison);
```

`renderComparisonSection`의 시그니처와 호출부는 이미 `tripsInComparison`을 받고 있으므로 그대로 둔다.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test public/test/charts.test.js`
Expected: PASS — 새 테스트 5개 포함, 기존 `renderCategoryComparison` 테스트도 전부 통과

- [ ] **Step 7: Verify no other caller was missed**

Run: `git grep -n "renderCategoryComparison" public/`
Expected: 정의 1건(charts.js), export 1건(charts.js), 호출 1건(report.js), 테스트 파일 내 호출들 — report.js 호출이 인자 4개인지 확인

Run: `node --test public/test/*.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add public/charts.js public/views/report.js public/test/charts.test.js
git commit -m "feat(frontend): comparison row data attributes, base-trip count, help block"
```

---

### Task 3: 클릭 바인딩과 스타일

**Files:**
- Modify: `public/views/report.js` (import, 클릭 바인딩)
- Modify: `public/style.css` (파일 끝)

**Interfaces:**
- Consumes: `renderComparisonDetail(...)` (Task 1), `.cmp-row` / `data-category` / `data-field` (Task 2)
- Produces: 없음

- [ ] **Step 1: Add the styles**

`public/style.css` 맨 끝에 추가한다.

```css
/* ── COMPARISON DETAIL ── */
.cmp-row { cursor: pointer; }
.cmp-row:hover { background: var(--paper-2); }

.cmp-detail-row {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 0.75rem; padding: 0.4rem 0.5rem; border-radius: var(--radius);
}
.cmp-detail-row .label { flex: none; }
.cmp-detail-value { text-align: right; font-size: 13px; }
.cmp-focus { background: var(--paper-2); }
.cmp-detail-rule { border-top: 1px solid var(--rule); margin: 0.5rem 0; }

.cmp-help { margin-top: 0.9rem; }
.cmp-help summary {
  cursor: pointer; color: var(--ink-3); font-size: 12px;
  font-family: var(--f-kr); padding: 0.3rem 0;
}
.cmp-help dt { font-weight: 500; font-size: 12px; margin-top: 0.6rem; }
.cmp-help dd { margin: 0.15rem 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.5; }
```

- [ ] **Step 2: Wire the click handler**

`public/views/report.js`의 charts import에 `renderComparisonDetail`을 더한다:

```js
import { renderDonutChart, renderCategoryComparison, renderComparisonDetail } from '../charts.js';
```

`container.querySelectorAll('.settle-card')` 블록 바로 앞에 다음을 추가한다. `settlement`, `tripDays`, `currentCategoryPerDay`, `groupCategoryPerDayAverages`, `tripsInComparison`은 모두 `renderReportInto` 스코프에 이미 있다.

```js
  // Both the numerator and the headcount come from the settlement the server
  // already computed, so the modal's arithmetic cannot drift from the table's.
  const dueHeadcount = settlement.perMember.filter((m) => m.due > 0).length;
  container.querySelectorAll('.cmp-row').forEach((row) => {
    row.addEventListener('click', (ev) => {
      const category = row.dataset.category;
      const cell = ev.target.closest('[data-field]');
      openModal(`${category} 산출 근거`, renderComparisonDetail({
        category,
        categoryTotal: settlement.categoryTotals[category] ?? 0,
        headcount: dueHeadcount,
        tripDays,
        currentPerDay: currentCategoryPerDay[category],
        groupPerDay: groupCategoryPerDayAverages[category],
        tripsInComparison,
        focus: cell ? cell.dataset.field : null,
      }));
    });
  });
```

- [ ] **Step 3: Run the whole frontend suite**

Run: `node --test public/test/*.test.js`
Expected: PASS

- [ ] **Step 4: Verify the wiring reads the right fields**

Run: `git grep -n "renderComparisonDetail\|dueHeadcount\|cmp-row" public/views/report.js`
Expected: import 1건, `dueHeadcount` 정의 1건과 사용 1건, `.cmp-row` 셀렉터 1건

- [ ] **Step 5: Commit**

```bash
git add public/views/report.js public/style.css
git commit -m "feat(frontend): open the derivation modal from a comparison row"
```

---

### Task 4: 브라우저 확인

**Files:** 없음 (검증 전용)

에뮬레이터가 필요하다. 실행 방법은 이 저장소에서 검증된 절차다:

```bash
export PATH="/c/Users/user/java-portable/jdk-17.0.19+10-jre/bin:$PATH"
npx -y firebase-tools@14 emulators:start --only functions,firestore,storage,hosting --project demo-sfayw
```

시드 데이터가 없으면 여행·구성원·경비를 UI로 만들어야 비교 표가 나온다. 비교 표가 뜨려면 같은 그룹에 **기간이 설정된 완료 상태의 과거 여행이 최소 1개** 있어야 한다.

- [ ] **Step 1: 기준이 있는 행 확인**

비교 표에서 값이 있는 행의 **`여행 전체` 셀**을 누른다.
- 모달 제목이 `<카테고리> 산출 근거`
- `여행 전체` 줄에만 배경 강조
- `이번` 줄의 `총액 ÷ 인원 ÷ 일수` 결과가 표의 `이번` 값과 반올림 후 일치
- `편차`·`여행 전체` 결과가 표의 값과 정확히 일치

- [ ] **Step 2: 셀별 강조 확인**

같은 행의 `이번`, `그룹평균`, `편차` 셀을 각각 눌러 강조 줄이 따라 바뀌는지 확인한다. 카테고리 이름을 누르면 아무 줄도 강조되지 않는다.

- [ ] **Step 3: 기준이 없는 행 확인**

`—`가 표시된 행을 누른다. `그룹평균`이 `—`이고 `비교 기준이 없습니다` 문구가 뜨며, 편차/여행 전체 줄이 아예 없다.

- [ ] **Step 4: 접이식 설명과 라벨**

표 아래 `이 표 읽는 법`이 **접힌 상태**로 있고, 눌러서 펼쳐지는지 확인한다. 표 상단 라벨에 `과거 여행 N개와 비교`가 보인다.

- [ ] **Step 5: 375px 확인**

창을 375px로 좁혀서:
- 행 탭이 정상 동작 (셀 경계에서 오탭해도 같은 모달)
- 모달이 화면을 넘지 않고 내부 스크롤됨
- `이 표 읽는 법`이 탭으로 열림

- [ ] **Step 6: 발견한 문제를 고치고 커밋, 브랜치 푸시**

```bash
git push -u origin plan-10-comparison-derivation
```
