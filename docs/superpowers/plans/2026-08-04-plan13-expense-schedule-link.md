# 경비 ↔ 일정 연계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네 개 경비 모달에서 분담 인원을 직접 지정하고, 일정을 고르면 그 일정의 참여자·카테고리·날짜가 채워지게 한다.

**Architecture:** 일정 선택 `<select>`와 분담 인원 체크리스트를 `public/views/expenseSplit.js` 위젯 하나로 만들어 네 모달이 공유한다. 그 안의 계산 두 개(`excludedFrom`, `groupSchedulesForPicker`)는 순수 함수로 분리해 단위 테스트한다. 화면은 "누가 분담하나"(포함)를 보여주고 저장 직전에 `excludedMembers`(제외)로 뒤집으므로 백엔드 스키마와 정산 로직은 그대로다.

**Tech Stack:** 빌드 없는 바닐라 ES 모듈, Firebase Cloud Functions (CommonJS, Node 20). 프론트 테스트는 `node --test`, 백엔드는 jest.

**Spec:** `docs/superpowers/specs/2026-08-04-plan13-expense-schedule-link-design.md`

## Global Constraints

- **프레임워크·빌드 도구·신규 npm 의존성을 추가하지 않는다.** 이 프로젝트는 빌드 단계가 없다.
- 프론트엔드는 ES 모듈(`import`/`export`), 백엔드는 CommonJS(`require`/`module.exports`). 섞지 않는다.
- 사용자에게 보이는 모든 문자열은 한국어.
- **코드 주석은 영어로 쓴다.** 이 저장소는 전부 영어 주석이고 한국어는 사용자에게 보이는 문자열에만 쓴다.
- **사용자 입력을 HTML에 넣을 때는 반드시 `escapeHtml()`을 거친다.** (`public/ui.js`)
- **화면은 포함(분담) 기준, 저장은 제외 기준이다.** `excludedMembers = 전체 − 체크됨`. 백엔드 스키마는 건드리지 않는다.
- **신규 에러 코드가 없다.** `SCHEDULE_NOT_FOUND`는 Plan 11에서 이미 `public/errorMessages.js`에 있고 `httpsErrors.js`의 `_NOT_FOUND` 규칙에 걸린다. 새 코드가 필요해지면 멈추고 보고할 것 — `errorMessages.js`와 `httpsErrors.js`의 `DOMAIN_ERROR_CODES` **두 곳 모두**에 등록해야 하며, 하나만 하면 조용히 `INTERNAL_ERROR`가 된다.
- 프론트엔드 파일을 건드리면 `public/sw.js`의 `CACHE_NAME`을 범프한다. 현재 `tripsplit-shell-v6` → `tripsplit-shell-v7`. (Task 6에서 한 번만)
- 커밋 규약: `feat(frontend):`, `feat(functions):`, `fix(...)`, `refactor(...)`.
- 테스트: 프론트 `npm test`(루트, 현재 **184** 통과), 백엔드 `npm test`(`functions/` 안에서, 현재 **334** 통과).
- **리포트에 터미널 출력을 그대로 붙여넣는다.** 다시 쳐서 만들지 말 것.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `public/views/expenseSplit.js` | 신규 | 순수 계산 2개 + 위젯 `mountExpenseSplit` |
| `public/test/expenseSplit.test.js` | 신규 | 순수 계산 테스트 |
| `functions/src/functions/expenses.js` | 수정 | `scheduleId` 검증·저장 |
| `functions/test/functions/expenses.test.js` | 수정 | 검증 테스트 |
| `public/views/member.js` | 수정 | 입력·수정 모달 2개 |
| `public/views/admin.js` | 수정 | 입력·수정 모달 2개 |
| `public/views/schedule.js` | 수정 | `listExpenses` 병렬 로드, 일정별 합계 |
| `public/views/scheduleForm.js` | 수정 | 합계 줄 |
| `public/style.css` | 수정 | 위젯 스타일 |
| `public/sw.js` | 수정 | `CACHE_NAME` 범프 |

**태스크 순서 근거:** 순수 계산(1) → 위젯(2) → 백엔드(3) → 배선(4, 5) → 합계와 마무리(6).

---

## Task 1: 순수 계산 두 개

**Files:**
- Create: `public/views/expenseSplit.js`
- Test: `public/test/expenseSplit.test.js`

**Interfaces:**
- Consumes: `minToLabel` (`../scheduleLayout.js`)
- Produces:
  - `excludedFrom(members, includedIds) => [memberId]`
  - `groupSchedulesForPicker(schedules) => [{ date, items: [{ id, label }] }]`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`public/test/expenseSplit.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { excludedFrom, groupSchedulesForPicker } from '../views/expenseSplit.js';

const members = [
  { id: 'm1', name: '가온' }, { id: 'm2', name: '나린' },
  { id: 'm3', name: '다솜' }, { id: 'm4', name: '라온' },
];

describe('excludedFrom', () => {
  test('전원 포함이면 제외가 없다', () => {
    assert.deepEqual(excludedFrom(members, ['m1', 'm2', 'm3', 'm4']), []);
  });

  test('아무도 포함하지 않으면 전원 제외', () => {
    assert.deepEqual(excludedFrom(members, []), ['m1', 'm2', 'm3', 'm4']);
  });

  test('일부만 포함하면 나머지가 제외된다', () => {
    assert.deepEqual(excludedFrom(members, ['m1', 'm3']), ['m2', 'm4']);
  });

  // 순서를 members 기준으로 고정한다. 체크한 순서에 따라 저장값이 달라지면
  // 같은 선택이 매번 다른 배열로 저장돼 diff가 무의미해진다.
  test('결과 순서는 members 순서를 따른다', () => {
    assert.deepEqual(excludedFrom(members, ['m4', 'm1']), ['m2', 'm3']);
  });

  // 구성원이 삭제된 뒤에도 옛 id가 남아 있을 수 있다.
  test('members에 없는 id가 들어와도 결과에 영향이 없다', () => {
    assert.deepEqual(excludedFrom(members, ['m1', 'ghost']), ['m2', 'm3', 'm4']);
  });

  test('빈 members는 빈 배열', () => {
    assert.deepEqual(excludedFrom([], ['m1']), []);
  });
});

function sched(over = {}) {
  return {
    id: 's1', title: '성산일출봉', category: '놀이',
    date: '2026-08-11', startMin: 660, participants: ['m1'], ...over,
  };
}

describe('groupSchedulesForPicker', () => {
  test('빈 입력은 빈 배열', () => {
    assert.deepEqual(groupSchedulesForPicker([]), []);
  });

  // 경비에는 날짜가 필요한데 "언젠가 갈 곳"에는 채울 날짜가 없다.
  test('date가 없는 일정은 빠진다', () => {
    assert.deepEqual(groupSchedulesForPicker([sched({ date: null })]), []);
  });

  test('날짜 오름차순으로 묶인다', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'b', date: '2026-08-12' }),
      sched({ id: 'a', date: '2026-08-10' }),
      sched({ id: 'c', date: '2026-08-11' }),
    ]);
    assert.deepEqual(groups.map((g) => g.date), ['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  test('같은 날짜는 한 그룹으로 모인다', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'a', startMin: 480 }),
      sched({ id: 'b', startMin: 660 }),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['a', 'b']);
  });

  test('그룹 안은 startMin 오름차순', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'late', startMin: 900 }),
      sched({ id: 'early', startMin: 480 }),
    ]);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['early', 'late']);
  });

  test('시간 미정은 그 날의 맨 뒤', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'none', startMin: null }),
      sched({ id: 'timed', startMin: 900 }),
    ]);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['timed', 'none']);
  });

  test('라벨은 시각과 제목을 붙인다', () => {
    const groups = groupSchedulesForPicker([sched({ startMin: 660, title: '성산일출봉' })]);
    assert.equal(groups[0].items[0].label, '11:00 성산일출봉');
  });

  test('시간 미정 라벨', () => {
    const groups = groupSchedulesForPicker([sched({ startMin: null, title: '기념품' })]);
    assert.equal(groups[0].items[0].label, '시간미정 기념품');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test`
Expected: FAIL. ESM에서는 파일이 없으면 `Cannot find module`, 파일은 있는데 export가 없으면 `SyntaxError: ... does not provide an export named ...`가 난다. **실제로 본 출력을 그대로 리포트에 붙일 것.**

- [ ] **Step 3: 최소 구현을 작성한다**

`public/views/expenseSplit.js`:

```js
import { minToLabel } from '../scheduleLayout.js';

// The backend stores who is EXCLUDED from an expense; the UI shows who is
// SHARING it, because that is how people think about splitting a bill. The
// inversion happens here, once, at the boundary.
//
// Order follows `members` rather than click order so the same selection always
// serialises to the same array -- otherwise two identical splits produce
// different documents and diffs become meaningless.
function excludedFrom(members, includedIds) {
  const included = new Set(includedIds);
  return members.filter((m) => !included.has(m.id)).map((m) => m.id);
}

// Expenses always carry a date, so a schedule with none has nothing to offer
// and is left out of the picker entirely.
function groupSchedulesForPicker(schedules) {
  const byDate = new Map();
  for (const s of schedules) {
    if (!s.date) continue;
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  return [...byDate.keys()].sort().map((date) => ({
    date,
    items: byDate.get(date)
      .slice()
      // Undated entries sort to the end of their day, matching how the
      // timetable's untimed strip sits above the day rather than inside it.
      .sort((a, b) => {
        const am = typeof a.startMin === 'number' ? a.startMin : 1440;
        const bm = typeof b.startMin === 'number' ? b.startMin : 1440;
        return am - bm;
      })
      .map((s) => ({
        id: s.id,
        label: `${typeof s.startMin === 'number' ? minToLabel(s.startMin) : '시간미정'} ${s.title}`,
      })),
  }));
}

export { excludedFrom, groupSchedulesForPicker };
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS — 기존 184 + 신규 14

- [ ] **Step 5: 커밋한다**

```bash
git add public/views/expenseSplit.js public/test/expenseSplit.test.js
git commit -m "feat(frontend): pure helpers for the expense split widget"
```

---

## Task 2: 공유 위젯

**Files:**
- Modify: `public/views/expenseSplit.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `excludedFrom`, `groupSchedulesForPicker` (Task 1), `escapeHtml` (`../ui.js`), `formatDate` (`../format.js`)
- Produces:
  ```js
  mountExpenseSplit(container, { members, schedules, scheduleId, excludedMembers })
    => { getScheduleId(), getExcludedMembers(), onSchedulePick(cb) }
  ```
  - `members`: `[{ id, name }]`
  - `schedules`: `[{ id, title, category, date, startMin, participants }]`
  - `scheduleId`: `string | null` — 초기값
  - `excludedMembers`: `[memberId]` — 초기값 (없으면 `[]` = 전원 체크)
  - `onSchedulePick(cb)`: 일정을 고를 때마다 `cb({ category, date })`. `(연결 안 함)`에는 호출되지 않는다.

**이 위젯이 카테고리를 소유하지 않는 이유:** 카테고리 칩 렌더링이 모달마다 변수명과 재렌더 함수가 달라서, 위젯이 카테고리까지 가지면 네 모달의 내부 사정을 알아야 한다. 위젯은 "무엇을 골랐는지"만 알리고 반영은 각 모달이 한다.

- [ ] **Step 1: 위젯을 구현한다**

`public/views/expenseSplit.js`의 import에 추가:

```js
import { escapeHtml } from '../ui.js';
import { formatDate } from '../format.js';
```

파일 아래쪽에 추가:

```js
/**
 * Renders the schedule picker and the share-list into `container`, and returns
 * accessors the host modal reads at submit time.
 *
 * The picker is omitted entirely when the trip has no dated schedules -- an
 * empty dropdown is worse than no dropdown. The share-list always renders.
 */
function mountExpenseSplit(container, {
  members, schedules, scheduleId = null, excludedMembers = [],
}) {
  const groups = groupSchedulesForPicker(schedules);
  const excluded = new Set(excludedMembers);
  const included = new Set(members.filter((m) => !excluded.has(m.id)).map((m) => m.id));
  let currentScheduleId = scheduleId;
  let pickHandler = null;

  container.innerHTML = `
    ${groups.length ? `
    <div class="field"><label class="label">일정</label>
      <select class="input" id="xs-schedule">
        <option value="">(연결 안 함)</option>
        ${groups.map((g) => `<optgroup label="${escapeHtml(formatDate(g.date))}">
          ${g.items.map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.label)}</option>`).join('')}
        </optgroup>`).join('')}
      </select>
    </div>` : ''}
    <div class="field"><label class="label">분담 인원</label><div id="xs-members"></div></div>`;

  function renderMembers() {
    const all = members.length > 0 && members.every((m) => included.has(m.id));
    container.querySelector('#xs-members').innerHTML = `
      <label class="check-inline"><input type="checkbox" id="xs-all" ${all ? 'checked' : ''}> <strong>전체</strong></label>
      ${members.map((m) => `
        <label class="check-inline">
          <input type="checkbox" class="xs-m" data-id="${escapeHtml(m.id)}" ${included.has(m.id) ? 'checked' : ''}>
          ${escapeHtml(m.name)}
        </label>`).join('')}`;

    container.querySelector('#xs-all').addEventListener('change', (ev) => {
      included.clear();
      if (ev.target.checked) members.forEach((m) => included.add(m.id));
      renderMembers();
    });
    container.querySelectorAll('.xs-m').forEach((box) => {
      box.addEventListener('change', () => {
        if (box.checked) included.add(box.dataset.id);
        else included.delete(box.dataset.id);
        renderMembers();
      });
    });
  }
  renderMembers();

  const sel = container.querySelector('#xs-schedule');
  if (sel) {
    // A stored scheduleId can be missing from the picker -- the schedule was
    // deleted, or its date was cleared. Show "(연결 안 함)" but do NOT clear
    // currentScheduleId: opening and closing the modal must not silently drop
    // a link the user never touched.
    const inList = groups.some((g) => g.items.some((it) => it.id === currentScheduleId));
    sel.value = inList ? currentScheduleId : '';

    sel.addEventListener('change', () => {
      currentScheduleId = sel.value || null;
      // Choosing "(연결 안 함)" unlinks but does not undo the fields the
      // previous pick filled in -- silently wiping values the user can see is
      // not what unlinking means.
      if (!sel.value) return;
      const picked = schedules.find((s) => s.id === sel.value);
      if (!picked) return;

      included.clear();
      (picked.participants || []).forEach((id) => {
        // Ignore participants who are no longer members of the trip.
        if (members.some((m) => m.id === id)) included.add(id);
      });
      renderMembers();
      if (pickHandler) pickHandler({ category: picked.category, date: picked.date });
    });
  }

  return {
    getScheduleId: () => currentScheduleId,
    getExcludedMembers: () => excludedFrom(members, [...included]),
    onSchedulePick: (cb) => { pickHandler = cb; },
  };
}
```

맨 아래 export 줄을 교체한다 (추가가 아니라 교체 — 중복 named export는 문법 오류다):

```js
export { excludedFrom, groupSchedulesForPicker, mountExpenseSplit };
```

- [ ] **Step 2: 스타일을 확인한다**

`.check-inline`은 Plan 11에서 이미 `public/style.css`에 있다. 확인만 하고 없으면 추가한다:

```bash
grep -n "check-inline" public/style.css
```

있으면 CSS 변경 없음. `#xs-schedule`은 기존 `.input` 클래스를 쓰므로 새 규칙이 필요 없다.

- [ ] **Step 3: 문법과 기존 테스트를 확인한다**

```bash
node --check public/views/expenseSplit.js
npm test
```

Expected: `--check`는 무출력, `npm test`는 198 통과(184 + Task 1의 14).

> **정정 (실행 중 확인):** 위 문장의 원래 근거 — "이 프로젝트는 프론트 단위 테스트를 순수 모듈에만 매긴다" — 는 **사실이 아니다.** `public/test/ui.test.js`가 이미 jsdom으로 `openModal`/`closeModal`/`renderChipGroup` 같은 DOM 코드를 단위 테스트하고 있고, `jsdom`은 이미 루트 `devDependencies`에 있다. 따라서 `mountExpenseSplit`도 **새 하네스나 새 의존성 없이** `ui.test.js`의 기존 패턴을 따라 테스트할 수 있다. Task 2는 이 잘못된 전제 위에서 테스트 없이 진행됐다.

- [ ] **Step 4: 커밋한다**

```bash
git add public/views/expenseSplit.js public/style.css
git commit -m "feat(frontend): shared schedule picker and share-list widget"
```

---

## Task 3: 백엔드 `scheduleId`

**Files:**
- Modify: `functions/src/functions/expenses.js`
- Test: `functions/test/functions/expenses.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `addExpense`/`updateExpense`가 `scheduleId`를 받고 검증·저장한다.

신규 콜러블은 없다. `SCHEDULE_NOT_FOUND`는 이미 등록된 코드다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`functions/test/functions/expenses.test.js`에 추가한다. 이 파일은 테스트마다 인라인으로 세션을 만들고 여행 문서 없이도 동작한다(`requireTripEditable`은 trip 문서가 없으면 편집 가능으로 본다). 아래 블록은 일정 문서가 필요하므로 자체 헬퍼를 둔다:

```js
describe('expense scheduleId', () => {
  async function setup(db) {
    const tripRef = await db.collection('trips').add({
      slug: 'a', name: 'A', group: 'G', status: 'active', adminPinHash: 'x', memberPinHash: 'y',
    });
    const m1 = await tripRef.collection('members').add({ name: '가', weight: 1 });
    const s1 = await tripRef.collection('schedules').add({
      planId: 'default', title: '성산일출봉', category: '놀이', date: '2026-08-11',
      startMin: 660, endMin: 780, participants: [m1.id],
    });
    const { token } = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m1.id });
    return { tripId: tripRef.id, tripRef, memberId: m1.id, scheduleId: s1.id, token };
  }

  const base = (t, over = {}) => ({
    sessionToken: t.token, tripId: t.tripId,
    date: '2026-08-11', category: '식비', amount: 10000, ...over,
  });

  test('addExpense가 scheduleId를 null로 초기화한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t));
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBeNull();
  });

  test('실재하는 scheduleId를 저장한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t, { scheduleId: t.scheduleId }));
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBe(t.scheduleId);
  });

  test('없는 scheduleId는 SCHEDULE_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(addExpense(db, base(t, { scheduleId: 'nope' }))).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });

  // 다른 여행의 일정에 붙이면 그 여행 구성원이 아닌 사람들의 분담이 섞인다.
  test('다른 여행의 scheduleId는 SCHEDULE_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const other = await setup(db);
    await expect(
      addExpense(db, base(t, { scheduleId: other.scheduleId })),
    ).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });

  test('updateExpense가 scheduleId를 바꾼다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t));
    await updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: t.scheduleId },
    });
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBe(t.scheduleId);
  });

  test('updateExpense가 null로 연결을 해제한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t, { scheduleId: t.scheduleId }));
    await updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: null },
    });
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBeNull();
  });

  test('patch에 scheduleId가 없으면 기존 값이 유지된다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t, { scheduleId: t.scheduleId }));
    await updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { amount: 20000 },
    });
    const snap = await t.tripRef.collection('expenses').doc(expenseId).get();
    expect(snap.data().scheduleId).toBe(t.scheduleId);
  });

  test('updateExpense도 없는 scheduleId를 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { expenseId } = await addExpense(db, base(t));
    await expect(updateExpense(db, {
      sessionToken: t.token, tripId: t.tripId, expenseId, patch: { scheduleId: 'nope' },
    })).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd functions && npm test -- expenses`
Expected: FAIL. CommonJS라 export 누락은 호출 시점의 `TypeError`로, 필드 미구현은 `Expected: null, Received: undefined` 형태로 난다. **실제 출력을 그대로 붙일 것.**

- [ ] **Step 3: 최소 구현을 작성한다**

`functions/src/functions/expenses.js`에 헬퍼를 추가한다 (`isValidPhotoPath` 아래):

```js
/**
 * A linked schedule must belong to this same trip. Accepting another trip's id
 * would let one trip's expense inherit a participant list made of people who
 * are not members here.
 */
async function assertScheduleExists(db, tripId, scheduleId) {
  if (scheduleId === null || scheduleId === undefined) return;
  const snap = await db.collection('trips').doc(tripId)
    .collection('schedules').doc(scheduleId).get();
  if (!snap.exists) throw new Error('SCHEDULE_NOT_FOUND');
}
```

`addExpense`에서 `excludedMembers` 검증 다음에 추가:

```js
  const scheduleId = data.scheduleId ?? null;
  await assertScheduleExists(db, tripId, scheduleId);
```

`.add({ ... })` 객체에 한 줄 추가 (`isWaypoint: false` 옆):

```js
    scheduleId,
```

`updateExpense`의 `if ('excludedMembers' in patch) { ... }` 다음에 추가:

```js
  if ('scheduleId' in patch) {
    const next = patch.scheduleId ?? null;
    await assertScheduleExists(db, tripId, next);
    update.scheduleId = next;
  }
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd functions && npm test`
Expected: PASS — 기존 334 + 신규 8

- [ ] **Step 5: 커밋한다**

```bash
git add functions/src/functions/expenses.js functions/test/functions/expenses.test.js
git commit -m "feat(functions): link an expense to a schedule"
```

---

## Task 4: 멤버 모달 두 개

**Files:**
- Modify: `public/views/member.js`

**Interfaces:**
- Consumes: `mountExpenseSplit` (Task 2), `scheduleId`를 받는 `addExpense`/`updateExpense` (Task 3)
- Produces: 없음

**두 가지 함정이 있다.**

**함정 1 — 리스너 누적.** `renderExpensesTab`이 `경비 입력` 버튼을 한 번 만들고, `loadExpenses`는 `#member-expenses-list`의 `innerHTML`만 갈아끼운다. 즉 **버튼은 재생성되지 않는다.** 데이터를 얻은 뒤 바인딩하려고 `loadExpenses` 안에서 `addEventListener`를 쓰면 저장할 때마다 리스너가 쌓여 모달이 여러 번 열린다. **`.onclick =` 으로 대입할 것.**

**함정 2 — OCR 경합.** 영수증 OCR도 카테고리와 날짜를 채운다. 일정을 고른 뒤 OCR 응답이 늦게 도착하면 고른 카테고리를 덮어쓴다.

- [ ] **Step 1: import와 데이터 로드를 고친다**

`public/views/member.js` 상단 import에 추가:

```js
import { mountExpenseSplit } from './expenseSplit.js';
```

`renderExpensesTab`에서 버튼 바인딩 줄을 **삭제**한다 (`openExpenseModal`을 부르는 `addEventListener` 줄). 버튼 자체는 남기되 `disabled`로 시작한다:

```js
async function renderExpensesTab(body, slug, myToken) {
  body.innerHTML = `
    <div style="margin-bottom:1rem"><button type="button" class="btn btn-primary" id="member-add-expense" disabled>경비 입력</button></div>
    <div id="member-expenses-list"></div>`;
  await loadExpenses(body, slug, myToken);
}
```

`loadExpenses`의 `Promise.all`에 일정을 추가한다:

```js
    [expenses, members, scheduleData] = await Promise.all([
      callFunction('listExpenses', { tripId: session.tripId }),
      callFunction('listMembersForLogin', { slug }),
      // A schedules failure must not take down the expense list; the picker
      // simply does not appear.
      callFunction('listSchedules', { tripId: session.tripId }).catch(() => ({ schedules: [] })),
    ]);
```

선언부 `let expenses, members;`를 `let expenses, members, scheduleData;`로 바꾼다.

`loadExpenses`의 성공 경로 맨 끝(카드 렌더링과 핸들러 바인딩이 끝난 뒤)에 추가:

```js
  // The add button is created once by renderExpensesTab and survives every
  // loadExpenses call, so assignment -- not addEventListener -- is what keeps
  // one handler on it instead of one per reload.
  const addBtn = body.querySelector('#member-add-expense');
  addBtn.disabled = false;
  addBtn.onclick = () => openExpenseModal(body, slug, members, scheduleData.schedules);
```

`openMemberExpenseEditModal` 호출부에 인자를 더한다:

```js
      openMemberExpenseEditModal(body, slug, exp, members, scheduleData.schedules);
```

- [ ] **Step 2: 입력 모달에 위젯을 단다**

`openExpenseModal(body, slug)`의 시그니처를 바꾼다:

```js
function openExpenseModal(body, slug, members, schedules) {
```

`let skipped = false;` 아래에 추가:

```js
  // Set once the user picks a schedule. A late OCR response must not overwrite
  // the category and date that pick just established -- but amount, merchant
  // and detail still come from the receipt and are still applied.
  let scheduleChosen = false;
  let split = null;
```

모달 HTML에서 `세부사항` 필드 **다음**, `입력 완료` 버튼 **앞**에 넣는다:

```html
    <div id="me-split"></div>
```

`rerenderCategoryChips();` 호출 다음에 추가:

```js
  split = mountExpenseSplit(document.getElementById('me-split'), { members, schedules });
  split.onSchedulePick(({ category: c, date }) => {
    scheduleChosen = true;
    if (c) { category = c; rerenderCategoryChips(); }
    if (date) document.getElementById('me-date').value = date;
  });
```

OCR 반영 블록에서 카테고리와 날짜만 플래그로 막는다. 기존:

```js
            if (classification.category) { category = classification.category; rerenderCategoryChips(); }
            if (classification.date) document.getElementById('me-date').value = classification.date;
```

변경 후:

```js
            if (!scheduleChosen && classification.category) { category = classification.category; rerenderCategoryChips(); }
            if (!scheduleChosen && classification.date) document.getElementById('me-date').value = classification.date;
```

`addExpense` 호출에 두 필드를 더한다:

```js
        photoPath,
        scheduleId: split.getScheduleId(),
        excludedMembers: split.getExcludedMembers(),
```

- [ ] **Step 3: 수정 모달에 위젯을 단다**

`openMemberExpenseEditModal(body, slug, exp)`의 시그니처를 바꾼다:

```js
function openMemberExpenseEditModal(body, slug, exp, members, schedules) {
```

모달 HTML에서 `세부사항` 다음, `저장` 버튼 앞에 넣는다:

```html
    <div id="mee-split"></div>
```

`rerenderChips();` 다음에 추가 — 수정은 **저장된 값에서 출발한다**:

```js
  const split = mountExpenseSplit(document.getElementById('mee-split'), {
    members,
    schedules,
    scheduleId: exp.scheduleId || null,
    excludedMembers: exp.excludedMembers || [],
  });
  split.onSchedulePick(({ category: c, date }) => {
    if (c) { category = c; rerenderChips(); }
    if (date) document.getElementById('mee-date').value = date;
  });
```

`updateExpense`의 `patch`에 두 필드를 더한다:

```js
          detail: document.getElementById('mee-detail').value,
          scheduleId: split.getScheduleId(),
          excludedMembers: split.getExcludedMembers(),
```

- [ ] **Step 4: 확인한다**

```bash
node --check public/views/member.js
npm test
```

Expected: `--check` 무출력, `npm test` 198 통과(개수 불변 — 이 태스크는 DOM만 건드린다).

- [ ] **Step 5: 커밋한다**

```bash
git add public/views/member.js
git commit -m "feat(frontend): schedule link and share-list in member expense modals"
```

---

## Task 5: 관리자 모달 두 개

**Files:**
- Modify: `public/views/admin.js`

**Interfaces:**
- Consumes: `mountExpenseSplit` (Task 2)
- Produces: 없음

관리자 쪽은 `renderExpensesTab`이 이미 `members`를 가지고 있어 배선이 더 짧다. 다만 **일정을 새로 불러와야 한다.**

- [ ] **Step 1: import와 데이터 로드를 고친다**

`public/views/admin.js` 상단 import에 추가:

```js
import { mountExpenseSplit } from './expenseSplit.js';
```

`renderExpensesTab`의 `Promise.all`에 일정을 추가한다. 기존은 `[expenses, members, trip]`을 받는다:

```js
    [expenses, members, trip, scheduleData] = await Promise.all([
      callFunction('listExpenses', { tripId: session.tripId }),
      callFunction('listMembers', { tripId: session.tripId }),
      callFunction('getTripSetup', { tripId: session.tripId }),
      // A schedules failure must not take down the expense tab; the picker
      // simply does not appear.
      callFunction('listSchedules', { tripId: session.tripId }).catch(() => ({ schedules: [] })),
    ]);
```

선언부에 `scheduleData`를 더한다.

두 모달 호출부에 인자를 더한다:

```js
      openAdminExpenseEditModal(body, slug, exp, members, scheduleData.schedules);
```

```js
    document.getElementById('expense-add').addEventListener('click', () => openAdminExpenseModal(body, slug, members, scheduleData.schedules));
```

- [ ] **Step 2: 입력 모달에 위젯을 단다**

`openAdminExpenseModal(body, slug, members)`의 시그니처를 바꾼다:

```js
function openAdminExpenseModal(body, slug, members, schedules) {
```

`let skipped = false;`(함수 첫머리 상태 선언 넷 중 마지막) 아래에 추가:

```js
  // Set once the user picks a schedule. A late OCR response must not overwrite
  // the category and date that pick just established.
  let scheduleChosen = false;
  let split = null;
```

모달 HTML에서 `세부사항` 다음, 제출 버튼 앞에 넣는다:

```html
    <div id="ae-split"></div>
```

`rerenderCategoryChips();` 초기 호출 다음에 추가 (이 모달의 칩 재렌더 함수 이름은 `rerenderCategoryChips`다):

```js
  split = mountExpenseSplit(document.getElementById('ae-split'), { members, schedules });
  split.onSchedulePick(({ category: c, date }) => {
    scheduleChosen = true;
    if (c) { category = c; rerenderCategoryChips(); }
    if (date) document.getElementById('ae-date').value = date;
  });
```

OCR 반영 블록의 두 줄을 바꾼다. 기존:

```js
            if (classification.category) { category = classification.category; rerenderCategoryChips(); }
            if (classification.date) document.getElementById('ae-date').value = classification.date;
```

변경 후:

```js
            if (!scheduleChosen && classification.category) { category = classification.category; rerenderCategoryChips(); }
            if (!scheduleChosen && classification.date) document.getElementById('ae-date').value = classification.date;
```

`addExpense` 호출에 추가:

```js
        scheduleId: split.getScheduleId(),
        excludedMembers: split.getExcludedMembers(),
```

- [ ] **Step 3: 수정 모달에 위젯을 단다**

`openAdminExpenseEditModal(body, slug, exp)`의 시그니처를 바꾼다:

```js
function openAdminExpenseEditModal(body, slug, exp, members, schedules) {
```

모달 HTML에서 `세부사항` 다음, `저장` 버튼 앞에 넣는다:

```html
    <div id="ee-split"></div>
```

`rerenderChips();` 초기 호출 다음에 추가 (이 모달의 칩 재렌더 함수 이름은 `rerenderChips`다):

```js
  const split = mountExpenseSplit(document.getElementById('ee-split'), {
    members,
    schedules,
    scheduleId: exp.scheduleId || null,
    excludedMembers: exp.excludedMembers || [],
  });
  split.onSchedulePick(({ category: c, date }) => {
    if (c) { category = c; rerenderChips(); }
    if (date) document.getElementById('ee-date').value = date;
  });
```

`updateExpense`의 `patch`에 추가:

```js
          scheduleId: split.getScheduleId(),
          excludedMembers: split.getExcludedMembers(),
```

- [ ] **Step 4: 확인한다**

```bash
node --check public/views/admin.js
npm test
```

Expected: `--check` 무출력, `npm test` 198 통과.

- [ ] **Step 5: 커밋한다**

```bash
git add public/views/admin.js
git commit -m "feat(frontend): schedule link and share-list in admin expense modals"
```

---

## Task 6: 일정별 합계와 마무리

**Files:**
- Modify: `public/views/schedule.js`
- Modify: `public/views/scheduleForm.js`
- Modify: `public/sw.js:5`

**Interfaces:**
- Consumes: 없음 (Task 3이 저장한 `scheduleId`를 읽는다)
- Produces: 없음 (마지막 태스크)

- [ ] **Step 1: 일정 탭이 경비를 함께 불러오게 한다**

`public/views/schedule.js:76`의 선언을 바꾼다:

```js
  let data, members, trip, expenses;
```

`:78`의 `Promise.all`에 네 번째 호출을 더한다:

```js
    [data, members, trip, expenses] = await Promise.all([
      callFunction('listSchedules', { tripId: session.tripId }),
      callFunction('listMembers', { tripId: session.tripId }),
      callFunction('getTripSetup', { tripId: session.tripId }),
      // Only the spend line depends on this. Failing soft keeps an expenses
      // outage from replacing the whole schedule tab with an error.
      callFunction('listExpenses', { tripId: session.tripId }).catch(() => []),
    ]);
```

`:102`의 캐시 저장에 `expenses`를 더한다:

```js
  cache = { schedules: data.schedules, members, period: trip.period, expenses };
```

`:26`의 캐시 주석도 맞춘다:

```js
let cache = null; // { schedules, members, period, expenses } | null
```

`paintSchedule`은 `cache.expenses`를 직접 읽으므로 구조분해를 따로 바꿀 필요는 없다 — Step 2에서 그렇게 쓴다.

- [ ] **Step 2: 합계를 계산해 모달에 넘긴다**

`public/views/schedule.js`에 헬퍼를 추가한다:

```js
// Not filtered by `confirmed`: this answers "how much did we spend here",
// which is a retrospective question, not a settlement one.
function spendFor(expenses, scheduleId) {
  const linked = expenses.filter((e) => e.scheduleId === scheduleId);
  if (linked.length === 0) return null;
  return {
    total: linked.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    count: linked.length,
  };
}
```

블록 클릭 핸들러의 `openScheduleForm` 호출에 `spend`를 더한다:

```js
      openScheduleForm({
        tripId: session.tripId, members, schedule: found, defaultDate: null,
        spend: spendFor(cache.expenses, found.id),
        onSaved: reload,
      });
```

`일정 추가` 버튼 쪽 호출에는 `spend: null`을 넘긴다 — 아직 존재하지 않는 일정에는 경비가 붙을 수 없다.

- [ ] **Step 3: 모달에 합계 줄을 넣는다**

`public/views/scheduleForm.js`의 시그니처에 `spend`를 더한다:

```js
function openScheduleForm({ tripId, members, schedule, defaultDate, onSaved, spend = null }) {
```

모달 HTML의 `마지막 수정:` 줄 **앞**에 넣는다:

```js
    ${spend ? `<p class="muted" style="margin-top:0.5rem;font-size:12px">이 일정 경비: ${spend.total.toLocaleString()}원 (${spend.count}건)</p>` : ''}
```

`spend`가 `null`이면 줄 자체가 나오지 않는다. `total`과 `count`는 숫자라 이스케이프가 필요 없다.

- [ ] **Step 4: 서비스워커 캐시를 범프한다**

`public/sw.js:5`:

```js
const CACHE_NAME = 'tripsplit-shell-v7';
```

`SHELL_ASSETS`는 바꾸지 않는다 — fetch 핸들러가 동일 출처 GET을 전부 캐시하므로 뷰 모듈은 자동으로 잡힌다.

- [ ] **Step 5: 전체 테스트를 돌린다**

```bash
node --check public/views/schedule.js
node --check public/views/scheduleForm.js
npm test
cd functions && npm test
```

Expected: 프론트 198, 백엔드 342 통과.

- [ ] **Step 6: 커밋한다**

```bash
git add public/views/schedule.js public/views/scheduleForm.js public/sw.js
git commit -m "feat(frontend): per-schedule spend total in the schedule modal"
```

- [ ] **Step 7: 배포 순서를 지킨다**

신규 콜러블은 없지만, **배포 전 백엔드는 `scheduleId`를 무시한다**(검증도 저장도 하지 않음). 프론트를 먼저 병합하면 연결이 조용히 안 되는 상태가 된다.

**백엔드를 먼저 배포한다.** PowerShell에서 실행한다 (Git Bash에서는 exit 127로 죽는다):

```powershell
npx -y firebase-tools@14 deploy --only functions --project prod
```

배포 후 확인 — 신규 함수가 없으므로 404/401 확인 대신 **필드가 실제로 저장되는지**를 본다. 배포 로그에서 `addExpense`와 `updateExpense`가 `Successful update operation`으로 찍혔는지 확인하고, 그 뒤에 병합한다.

---

## 자체 검토 결과

**스펙 커버리지:**

| 스펙 | 태스크 |
|---|---|
| §1.1 `scheduleId` 필드, 마이그레이션 불필요 | Task 3 |
| §1.2 포함/제외 뒤집기, 입력은 전원 체크·수정은 저장값 | Task 1 (`excludedFrom`), Task 2, Task 4·5 |
| §1.3 고른 뒤 링크와 체크박스 독립 | Task 2 (체크 변경이 `currentScheduleId`를 안 건드림) |
| §2.1 프리필 3종, `(연결 안 함)`은 되돌리지 않음 | Task 2 |
| §2.2 상호명 안 채움 | Task 2 (`onSchedulePick`이 category·date만 넘김) |
| §2.3 날짜 없는 일정 제외, 목록에 없는 저장값 처리 | Task 1, Task 2 |
| §2.4 `optgroup`, 일정 없으면 칸 숨김 | Task 2 |
| §3 `scheduleChosen` 플래그 | Task 4, Task 5 |
| §4 위젯 인터페이스 | Task 2 |
| §5 일정별 합계, 조용한 실패 | Task 6 |
| §6 백엔드 검증 | Task 3 |
| §6.4 유령 id는 "연결 없음"으로 취급 | Task 2, Task 6 (`spendFor`가 매칭 안 되면 자연히 0건) |
| §7 파일 목록 | 전체 |
| §8 테스트 | Task 1, Task 3 |
| §10 배포 순서 | Task 6 Step 7 |

**의도한 간극:** 위젯의 DOM 동작(체크 토글, 프리필, OCR 경합)은 단위 테스트가 없다 — 스펙 §8이 육안 확인으로 넘긴 부분이다. 이 프로젝트는 프론트 단위 테스트를 순수 모듈에만 매긴다.

**구현자가 주의할 점:**

- Task 2는 `expenseSplit.js` 맨 아래 `export` 문을 **교체**한다. 추가가 아니다.
- Task 4의 `.onclick =` 은 취향이 아니라 필수다. `addEventListener`면 저장할 때마다 핸들러가 쌓인다.
- Task 5의 칩 재렌더 함수 이름은 `admin.js`의 실제 이름을 보고 맞춘다. 모달마다 다를 수 있다.
- Task 6 Step 7의 배포 순서를 건너뛰면 연결이 조용히 저장되지 않는다.
