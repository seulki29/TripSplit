# 여행 경로 맵 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행에서 거쳐 간 장소를 방문 순서대로 잇는 지그재그 SVG 여정도를 리포트 탭에 넣는다.

**Architecture:** 경유지 병합·좌표 계산·SVG 생성을 전부 `public/routeMap.js`의 순수 함수로 두고(DOM 없음), `report.js`는 문자열을 꽂기만 한다. 경비의 경유지 표시는 `updateExpense`가 아닌 별도 콜러블로 처리해 확정·완료 잠금을 우회한다.

**Tech Stack:** 빌드 없는 바닐라 ES 모듈, Firebase Cloud Functions (CommonJS, Node 20), 인라인 SVG. 프론트 테스트는 `node --test`, 백엔드는 jest.

**Spec:** `docs/superpowers/specs/2026-08-04-plan12-route-map-design.md`

## Global Constraints

- **프레임워크·빌드 도구·신규 npm 의존성을 추가하지 않는다.** 이 프로젝트는 빌드 단계가 없다.
- 프론트엔드는 ES 모듈(`import`/`export`), 백엔드는 CommonJS(`require`/`module.exports`). 섞지 않는다.
- 사용자에게 보이는 모든 문자열은 한국어.
- **코드 주석은 영어로 쓴다.** 이 저장소는 전부 영어 주석이고 한국어는 사용자에게 보이는 문자열에만 쓴다.
- **사용자 입력을 HTML/SVG에 넣을 때는 반드시 `escapeHtml()`을 거친다.** (`public/ui.js`)
- 색은 `public/categories.js`의 `CATEGORY_META.mark`를 쓰고 새로 만들지 않는다. CSS 토큰은 `--ink`(#0e0e0e), `--paper`(#fafaf8), `--rule`(#e4e3df), `--ink-3`(#7a7a7a).
- **노드는 `--paper`로 채우고 카테고리 색은 테두리로 두른다. 번호는 `--ink`.** 카테고리 색으로 채우고 흰 번호를 얹으면 6색 중 5색이 4.5:1에 미달한다 (스펙 §2.6에 측정값 있음).
- 백엔드 에러는 `throw new Error('CODE')`로 던진다. **이번 범위에는 신규 에러 코드가 없다** — 있었다면 `public/errorMessages.js`와 `functions/src/lib/httpsErrors.js`의 `DOMAIN_ERROR_CODES` **두 곳 모두**에 등록해야 한다(Plan 11에서 후자를 빠뜨려 문구가 도달하지 못한 전례).
- 프론트엔드 파일을 건드리면 `public/sw.js`의 `CACHE_NAME`을 범프한다. 현재 `tripsplit-shell-v4` → `tripsplit-shell-v5`. (Task 6에서 한 번만)
- 커밋 규약: `feat(frontend):`, `feat(functions):`, `fix(...)`, `test(...)`.
- 테스트: 프론트 `npm test`(루트, 현재 143 통과), 백엔드 `npm test`(`functions/` 안에서, 현재 325 통과).

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `public/routeMap.js` | 신규 | 경유지 병합 · 좌표 · SVG 생성. 전부 순수, DOM 없음 |
| `public/test/routeMap.test.js` | 신규 | 위 함수들의 테스트 |
| `functions/src/functions/expenses.js` | 수정 | `setExpenseWaypoint`, `addExpense`에 `isWaypoint: false` |
| `functions/index.js` | 수정 | 콜러블 등록 |
| `functions/test/functions/expenses.test.js` | 수정 | 권한 테스트 |
| `public/views/member.js` | 수정 | 경비 카드 경유지 토글 |
| `public/views/admin.js` | 수정 | 경비 카드 경유지 토글 |
| `public/views/report.js` | 수정 | `listSchedules` 병렬 호출 + 경로 맵 섹션 |
| `public/style.css` | 수정 | 경로 맵 · 토글 버튼 |
| `public/sw.js` | 수정 | `CACHE_NAME` 범프 |

**태스크 순서 근거:** 순수 함수(1~3) → 백엔드(4) → UI(5~6). 각 태스크는 자체 테스트 사이클로 끝난다.

---

## Task 1: 경유지 병합과 정렬

**Files:**
- Create: `public/routeMap.js`
- Test: `public/test/routeMap.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `buildWaypoints(schedules, expenses) => [{ label, category, date }]`
  - 반환 배열은 방문 순서다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`public/test/routeMap.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWaypoints } from '../routeMap.js';

function sched(over = {}) {
  return {
    id: 's1', placeName: '성산일출봉', category: '놀이',
    date: '2026-08-11', startMin: 660, endMin: 780, ...over,
  };
}
function exp(over = {}) {
  return {
    id: 'e1', merchant: '동문시장', category: '기타',
    date: '2026-08-11', isWaypoint: true, ...over,
  };
}
const labels = (ws) => ws.map((w) => w.label);

describe('buildWaypoints', () => {
  test('빈 입력은 빈 배열', () => {
    assert.deepEqual(buildWaypoints([], []), []);
  });

  test('일정을 date 그다음 startMin 순으로 낸다', () => {
    const ws = buildWaypoints([
      sched({ id: 'b', placeName: '우도', startMin: 900 }),
      sched({ id: 'a', placeName: '조식', startMin: 480 }),
      sched({ id: 'c', placeName: '공항', date: '2026-08-10', startMin: 600 }),
    ], []);
    assert.deepEqual(labels(ws), ['공항', '조식', '우도']);
  });

  test('경유지 표시된 경비는 같은 날 일정 뒤에 온다', () => {
    // 경비에는 시간 정보가 없으므로 정렬 키를 1440으로 고정해 그 날 맨 뒤에 둔다.
    const ws = buildWaypoints(
      [sched({ placeName: '성산', startMin: 1300 })],
      [exp({ merchant: '동문시장' })],
    );
    assert.deepEqual(labels(ws), ['성산', '동문시장']);
  });

  test('경유지로 표시되지 않은 경비는 제외한다', () => {
    assert.deepEqual(buildWaypoints([], [exp({ isWaypoint: false })]), []);
  });

  // 기존 문서에는 isWaypoint 필드 자체가 없다. 마이그레이션이 불필요하다는
  // 사실을 테스트로 고정한다.
  test('isWaypoint가 undefined인 기존 경비는 제외한다', () => {
    const legacy = exp();
    delete legacy.isWaypoint;
    assert.deepEqual(buildWaypoints([], [legacy]), []);
  });

  test('placeName이 빈 일정은 제외한다', () => {
    assert.deepEqual(buildWaypoints([sched({ placeName: '' })], []), []);
    assert.deepEqual(buildWaypoints([sched({ placeName: '   ' })], []), []);
    assert.deepEqual(buildWaypoints([sched({ placeName: null })], []), []);
  });

  test('date가 없는 일정은 제외한다', () => {
    assert.deepEqual(buildWaypoints([sched({ date: null })], []), []);
  });

  test('merchant가 빈 경비는 제외한다', () => {
    assert.deepEqual(buildWaypoints([], [exp({ merchant: '' })]), []);
  });

  // Plan 11에서 위치 칸에 지도 URL 붙여넣기를 허용했다. URL을 노드 이름으로
  // 찍는 것보다 제외하는 편이 낫다.
  test('placeName이 URL이면 제외한다', () => {
    assert.deepEqual(buildWaypoints([sched({ placeName: 'https://map.kakao.com/?q=x' })], []), []);
    assert.deepEqual(buildWaypoints([sched({ placeName: 'HTTP://map.kakao.com' })], []), []);
  });

  test('같은 날 연속으로 같은 장소면 노드 하나로 접는다', () => {
    const ws = buildWaypoints([], [
      exp({ id: 'a', merchant: 'GS25' }),
      exp({ id: 'b', merchant: 'GS25' }),
      exp({ id: 'c', merchant: 'GS25' }),
    ]);
    assert.deepEqual(labels(ws), ['GS25']);
  });

  // 제주공항이 첫날과 마지막 날에 나오면 노드가 둘이어야 "돌아왔다"가 보인다.
  test('날짜가 다르면 같은 장소라도 접지 않는다', () => {
    const ws = buildWaypoints([
      sched({ placeName: '제주공항', date: '2026-08-10', startMin: 600 }),
      sched({ placeName: '제주공항', date: '2026-08-13', startMin: 600 }),
    ], []);
    assert.deepEqual(labels(ws), ['제주공항', '제주공항']);
  });

  test('사이에 다른 장소가 끼면 접지 않는다', () => {
    const ws = buildWaypoints([
      sched({ placeName: 'A', startMin: 600 }),
      sched({ placeName: 'B', startMin: 700 }),
      sched({ placeName: 'A', startMin: 800 }),
    ], []);
    assert.deepEqual(labels(ws), ['A', 'B', 'A']);
  });

  test('앞뒤 공백을 없애고 접기 판정에 쓴다', () => {
    const ws = buildWaypoints([
      sched({ placeName: '  성산  ', startMin: 600 }),
      sched({ placeName: '성산', startMin: 700 }),
    ], []);
    assert.deepEqual(labels(ws), ['성산']);
  });

  test('카테고리와 날짜를 함께 낸다', () => {
    const ws = buildWaypoints([sched({ placeName: '성산', category: '놀이' })], []);
    assert.deepEqual(ws, [{ label: '성산', category: '놀이', date: '2026-08-11' }]);
  });

  // 날짜만 있고 시간이 없는 일정도 그 날 맨 뒤로 간다. 경비와 키가 같으므로
  // 둘 다 있으면 일정이 먼저다(정렬이 안정적이고 일정을 먼저 넣기 때문).
  test('시간 미정 일정은 그 날 맨 뒤, 경비보다는 앞', () => {
    const ws = buildWaypoints(
      [sched({ placeName: '기념품', startMin: null }), sched({ placeName: '조식', startMin: 480 })],
      [exp({ merchant: '편의점' })],
    );
    assert.deepEqual(labels(ws), ['조식', '기념품', '편의점']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test`
Expected: FAIL — `Cannot find module '../routeMap.js'`

- [ ] **Step 3: 최소 구현을 작성한다**

`public/routeMap.js`:

```js
// The route map is a retrospective diagram, not a navigational one: node
// positions encode visit order only. The app stores no coordinates.

// Plan 11 lets a user paste a map URL into a schedule's place field. Those
// make useless node labels, so they are dropped rather than rendered.
const URL_RE = /^https?:\/\//i;

// Expenses carry a date but no time, so they sort to the end of their day.
// Schedule entries with no time land here too, and stay ahead of expenses
// because they are pushed first and Array#sort is stable.
const END_OF_DAY = 1440;

function buildWaypoints(schedules, expenses) {
  const items = [];

  for (const s of schedules) {
    if (!s.date) continue;
    const label = String(s.placeName ?? '').trim();
    if (!label || URL_RE.test(label)) continue;
    items.push({
      label, category: s.category, date: s.date,
      sortMin: typeof s.startMin === 'number' ? s.startMin : END_OF_DAY,
    });
  }

  for (const e of expenses) {
    if (e.isWaypoint !== true || !e.date) continue;
    const label = String(e.merchant ?? '').trim();
    if (!label) continue;
    items.push({ label, category: e.category, date: e.date, sortMin: END_OF_DAY });
  }

  items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.sortMin - b.sortMin;
  });

  // Collapse a run of stops at the same place on the same day into one node.
  // The date is part of the comparison on purpose: returning to the airport on
  // the last day must show as a second node, or the journey looks one-way.
  const out = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && prev.label === item.label && prev.date === item.date) continue;
    out.push({ label: item.label, category: item.category, date: item.date });
  }
  return out;
}

export { buildWaypoints };
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS — 전체 스위트 (기존 143 + 신규 15)

- [ ] **Step 5: 커밋한다**

```bash
git add public/routeMap.js public/test/routeMap.test.js
git commit -m "feat(frontend): merge schedule places and flagged expenses into waypoints"
```

---

## Task 2: 지그재그 좌표 계산

**Files:**
- Modify: `public/routeMap.js`
- Test: `public/test/routeMap.test.js`

**Interfaces:**
- Consumes: 없음 (독립 함수)
- Produces:
  - `serpentineLayout(waypoints) => { nodes, width, height }`
  - `nodes`는 `[{ waypoint, index, row, col, cx, cy }]`
  - 상수 export: `PER_ROW = 3`, `CELL_W = 100`, `ROW_H = 90`, `NODE_R = 14`, `CANVAS_W = 300`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`public/test/routeMap.test.js`에 추가 (import 줄에 `serpentineLayout`, `NODE_R`을 넣는다):

```js
import { buildWaypoints, serpentineLayout, NODE_R } from '../routeMap.js';

// n개의 더미 경유지. 좌표만 검사하므로 라벨 내용은 중요하지 않다.
function waypoints(n) {
  return Array.from({ length: n }, (_, i) => ({
    label: `P${i}`, category: '기타', date: '2026-08-11',
  }));
}

describe('serpentineLayout', () => {
  test('경유지가 없으면 노드도 없다', () => {
    const { nodes } = serpentineLayout([]);
    assert.deepEqual(nodes, []);
  });

  test('캔버스 폭은 300으로 고정', () => {
    assert.equal(serpentineLayout(waypoints(5)).width, 300);
  });

  test('0행은 좌에서 우로', () => {
    const { nodes } = serpentineLayout(waypoints(3));
    assert.deepEqual(nodes.map((n) => n.cx), [50, 150, 250]);
    assert.deepEqual(nodes.map((n) => n.cy), [45, 45, 45]);
  });

  // 지그재그의 핵심. 1행은 방향이 뒤집혀 오른쪽 끝에서 시작한다.
  test('1행은 우에서 좌로', () => {
    const { nodes } = serpentineLayout(waypoints(6));
    assert.deepEqual(nodes.slice(3).map((n) => n.cx), [250, 150, 50]);
    assert.deepEqual(nodes.slice(3).map((n) => n.cy), [135, 135, 135]);
  });

  test('4번째 노드는 1행 오른쪽 끝, 3번째 바로 아래', () => {
    const { nodes } = serpentineLayout(waypoints(4));
    assert.equal(nodes[3].cx, 250);
    assert.equal(nodes[2].cx, 250);
    assert.equal(nodes[3].row, 1);
  });

  test('7번째 노드는 2행 왼쪽 끝, 6번째 바로 아래', () => {
    const { nodes } = serpentineLayout(waypoints(7));
    assert.equal(nodes[6].cx, 50);
    assert.equal(nodes[5].cx, 50);
    assert.equal(nodes[6].cy, 225);
  });

  test('높이는 행 수에 비례한다', () => {
    assert.equal(serpentineLayout(waypoints(1)).height, 110);
    assert.equal(serpentineLayout(waypoints(3)).height, 110);
    assert.equal(serpentineLayout(waypoints(4)).height, 200);
    assert.equal(serpentineLayout(waypoints(7)).height, 290);
  });

  test('노드가 원래 경유지와 인덱스를 들고 있다', () => {
    const ws = waypoints(2);
    const { nodes } = serpentineLayout(ws);
    assert.equal(nodes[1].waypoint, ws[1]);
    assert.equal(nodes[1].index, 1);
  });

  test('NODE_R을 export한다', () => {
    assert.equal(NODE_R, 14);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test`
Expected: FAIL — `serpentineLayout is not a function` 또는 export 누락 오류

- [ ] **Step 3: 최소 구현을 작성한다**

`public/routeMap.js`에 추가:

```js
// Layout is a boustrophedon: rows alternate direction, so consecutive nodes
// are always adjacent. Because a row change keeps the same column slot, the
// connector between rows is a plain vertical line.
const PER_ROW = 3;
const CELL_W = 100;
const ROW_H = 90;
const NODE_R = 14;
const CANVAS_W = 300;

// Rows per row count is fixed rather than responsive: the SVG is drawn in a
// viewBox and stretched with width:100%, so cells shrink on a phone and grow
// on a desktop without this function ever knowing the viewport.
function serpentineLayout(waypoints) {
  const nodes = waypoints.map((waypoint, index) => {
    const row = Math.floor(index / PER_ROW);
    const col = index % PER_ROW;
    const slot = row % 2 === 0 ? col : PER_ROW - 1 - col;
    return {
      waypoint,
      index,
      row,
      col,
      cx: CELL_W / 2 + slot * CELL_W,
      cy: ROW_H / 2 + row * ROW_H,
    };
  });

  const rows = Math.ceil(waypoints.length / PER_ROW);
  return { nodes, width: CANVAS_W, height: rows * ROW_H + 20 };
}
```

맨 아래 export 줄을 교체한다 (추가가 아니라 교체 — 중복 named export는 문법 오류다):

```js
export {
  buildWaypoints, serpentineLayout,
  PER_ROW, CELL_W, ROW_H, NODE_R, CANVAS_W,
};
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS. `cy` 확인: 0행 = 90/2 = 45, 1행 = 45 + 90 = 135, 2행 = 45 + 180 = 225.

- [ ] **Step 5: 커밋한다**

```bash
git add public/routeMap.js public/test/routeMap.test.js
git commit -m "feat(frontend): serpentine coordinates for the route map"
```

---

## Task 3: SVG 렌더링

**Files:**
- Modify: `public/routeMap.js`
- Test: `public/test/routeMap.test.js`

**Interfaces:**
- Consumes: `serpentineLayout`, `NODE_R`, `CANVAS_W` (Task 2), `categoryMark` (`./categories.js`), `escapeHtml` (`./ui.js`), `formatDate` (`./format.js`)
- Produces:
  - `renderRouteMap(waypoints, { location, period }) => string` — 완성된 HTML 조각(머리말 + SVG). `waypoints`가 비면 안내 문구만 낸다.

**스펙에서 한 가지 정정:** 스펙 §2.3은 행이 바뀔 때 3차 베지어 곡선을 그린다고 했다. 실제로 계산해보면 **행이 바뀌어도 열 슬롯이 그대로라 `cx`가 같다**(index 2는 slot 2, index 3도 slot 2). 즉 곡선의 시작점과 끝점의 x가 동일해서 베지어가 직선으로 퇴화한다. **수직 직선으로 그린다.**

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`public/test/routeMap.test.js`에 추가 (import 줄에 `renderRouteMap`를 넣는다):

```js
describe('renderRouteMap', () => {
  const opts = { location: '제주', period: { start: '2026-08-10', end: '2026-08-13' } };
  const one = [{ label: '성산일출봉', category: '놀이', date: '2026-08-11' }];

  test('경유지가 없으면 SVG 대신 안내 문구', () => {
    const html = renderRouteMap([], opts);
    assert.ok(!html.includes('<svg'));
    assert.ok(html.includes('아직 경로에 표시할 장소가 없습니다'));
    // 무엇을 하면 채워지는지 알려준다 — 두 경로 다 눈에 띄지 않는 기능이다.
    assert.ok(html.includes('일정에 위치'));
    assert.ok(html.includes('경유지로 표시'));
  });

  test('경유지가 있으면 SVG를 낸다', () => {
    const html = renderRouteMap(one, opts);
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('viewBox="0 0 300 110"'));
  });

  test('머리말에 기간·개수·지역이 들어간다', () => {
    const html = renderRouteMap(one, opts);
    assert.ok(html.includes('8.10'));
    assert.ok(html.includes('8.13'));
    assert.ok(html.includes('1곳'));
    assert.ok(html.includes('제주'));
  });

  test('지역이 없으면 생략한다', () => {
    const html = renderRouteMap(one, { location: '', period: opts.period });
    assert.ok(html.includes('1곳'));
    assert.ok(!html.includes('· ·'));
  });

  test('노드 테두리가 카테고리 색이고 채움은 표면색', () => {
    // 카테고리 색으로 채우고 흰 번호를 얹으면 6색 중 5색이 4.5:1에 미달한다.
    const html = renderRouteMap(one, opts);
    assert.ok(html.includes('stroke="#e87ba4"'), '놀이 색이 테두리여야 한다');
    assert.ok(html.includes('fill="var(--paper)"'), '채움은 표면색이어야 한다');
    assert.ok(!html.includes('fill="#e87ba4"'), '카테고리 색으로 채우면 안 된다');
  });

  test('번호가 1부터 매겨진다', () => {
    const html = renderRouteMap([
      { label: 'A', category: '기타', date: '2026-08-10' },
      { label: 'B', category: '기타', date: '2026-08-10' },
    ], opts);
    assert.ok(html.includes('>1</text>'));
    assert.ok(html.includes('>2</text>'));
  });

  test('장소명을 이스케이프한다', () => {
    const html = renderRouteMap([{ label: '<script>x</script>', category: '기타', date: '2026-08-10' }], opts);
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('7자 이하는 한 줄', () => {
    const html = renderRouteMap([{ label: '성산일출봉', category: '기타', date: '2026-08-10' }], opts);
    assert.ok(html.includes('>성산일출봉</tspan>'));
  });

  test('8~14자는 두 줄로 쪼갠다', () => {
    const html = renderRouteMap([{ label: '켄싱턴리조트평창', category: '기타', date: '2026-08-10' }], opts);
    assert.ok(html.includes('>켄싱턴리조트평</tspan>'));
    assert.ok(html.includes('>창</tspan>'));
  });

  test('14자를 넘으면 말줄임표', () => {
    const label = '가나다라마바사아자차카타파하거너';  // 16자
    const html = renderRouteMap([{ label, category: '기타', date: '2026-08-10' }], opts);
    assert.ok(html.includes('…'));
  });

  test('전체 이름이 title 요소에 들어간다', () => {
    const label = '가나다라마바사아자차카타파하거너';
    const html = renderRouteMap([{ label, category: '기타', date: '2026-08-10' }], opts);
    assert.ok(html.includes(`<title>${label}</title>`));
  });

  // 지그재그 배치는 날짜 경계를 잃어버린다. 칩 하나로 "며칠째 어디"가 읽힌다.
  test('날짜가 바뀌는 노드에만 날짜 칩이 붙는다', () => {
    const html = renderRouteMap([
      { label: 'A', category: '기타', date: '2026-08-10' },
      { label: 'B', category: '기타', date: '2026-08-10' },
      { label: 'C', category: '기타', date: '2026-08-11' },
    ], opts);
    const chips = html.match(/class="rm-date"/g) || [];
    assert.equal(chips.length, 2, '첫 노드와 날짜가 바뀐 노드, 둘뿐이어야 한다');
    assert.ok(html.includes('>8.10</text>'));
    assert.ok(html.includes('>8.11</text>'));
  });

  test('연결선이 노드 수보다 하나 적다', () => {
    const html = renderRouteMap([
      { label: 'A', category: '기타', date: '2026-08-10' },
      { label: 'B', category: '기타', date: '2026-08-10' },
      { label: 'C', category: '기타', date: '2026-08-10' },
    ], opts);
    const lines = html.match(/class="rm-link"/g) || [];
    assert.equal(lines.length, 2);
  });

  test('노드가 하나면 연결선이 없다', () => {
    const html = renderRouteMap(one, opts);
    assert.equal((html.match(/class="rm-link"/g) || []).length, 0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test`
Expected: FAIL — `renderRouteMap is not a function`

- [ ] **Step 3: 최소 구현을 작성한다**

`public/routeMap.js` 상단에 import를 추가한다:

```js
import { escapeHtml } from './ui.js';
import { categoryMark } from './categories.js';
import { formatDate } from './format.js';
```

그리고 아래를 추가한다:

```js
const LABEL_LINE = 7;
const LABEL_MAX = 14;

// SVG has no automatic text wrapping, so long place names are split by hand
// into at most two lines. The full name goes in a <title> for desktop hover;
// touch users see only the truncated form, which is accepted -- the untruncated
// name is one tap away in the schedule tab.
function labelLines(label) {
  if (label.length <= LABEL_LINE) return [label];
  if (label.length <= LABEL_MAX) return [label.slice(0, LABEL_LINE), label.slice(LABEL_LINE)];
  return [label.slice(0, LABEL_LINE), `${label.slice(LABEL_LINE, LABEL_MAX - 1)}…`];
}

// A row change keeps the same column slot, so cx is identical either side of
// it and the connector is a plain vertical line. Within a row it is horizontal.
// Both stop at the node edge rather than its centre so the line never shows
// through the circle.
function renderLink(a, b) {
  if (a.cy === b.cy) {
    const dir = b.cx > a.cx ? 1 : -1;
    return `<line class="rm-link" x1="${a.cx + NODE_R * dir}" y1="${a.cy}" x2="${b.cx - NODE_R * dir}" y2="${b.cy}"></line>`;
  }
  return `<line class="rm-link" x1="${a.cx}" y1="${a.cy + NODE_R}" x2="${b.cx}" y2="${b.cy - NODE_R}"></line>`;
}

function renderNode(node, showDate) {
  const { waypoint: w, cx, cy, index } = node;
  const lines = labelLines(w.label);
  const label = lines.map((line, i) => (
    `<tspan x="${cx}" dy="${i === 0 ? 0 : 11}">${escapeHtml(line)}</tspan>`
  )).join('');

  return `<g>
    <title>${escapeHtml(w.label)}</title>
    ${showDate ? `<text class="rm-date" x="${cx}" y="${cy - NODE_R - 6}">${escapeHtml(formatDate(w.date))}</text>` : ''}
    <circle class="rm-node" cx="${cx}" cy="${cy}" r="${NODE_R}" fill="var(--paper)" stroke="${categoryMark(w.category)}"></circle>
    <text class="rm-num" x="${cx}" y="${cy + 4}">${index + 1}</text>
    <text class="rm-label" y="${cy + NODE_R + 13}">${label}</text>
  </g>`;
}

function renderRouteMap(waypoints, { location, period } = {}) {
  if (waypoints.length === 0) {
    return `<p class="muted">아직 경로에 표시할 장소가 없습니다.<br>
      일정에 위치를 적거나, 경비 목록에서 경유지로 표시해보세요.</p>`;
  }

  const { nodes, width, height } = serpentineLayout(waypoints);

  const links = nodes.slice(1).map((n, i) => renderLink(nodes[i], n)).join('');
  const marks = nodes.map((n, i) => (
    renderNode(n, i === 0 || nodes[i - 1].waypoint.date !== n.waypoint.date)
  )).join('');

  const parts = [];
  if (period?.start && period?.end) parts.push(`${formatDate(period.start)} – ${formatDate(period.end)}`);
  parts.push(`${waypoints.length}곳`);
  if (location) parts.push(location);

  return `<p class="muted rm-caption">${escapeHtml(parts.join(' · '))}</p>
    <svg class="rm-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="여행 경로">
      ${links}${marks}
    </svg>`;
}
```

맨 아래 export 줄을 교체한다:

```js
export {
  buildWaypoints, serpentineLayout, renderRouteMap,
  PER_ROW, CELL_W, ROW_H, NODE_R, CANVAS_W,
};
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS — 전체 스위트

- [ ] **Step 5: 커밋한다**

```bash
git add public/routeMap.js public/test/routeMap.test.js
git commit -m "feat(frontend): render the route map as an inline SVG"
```

---

## Task 4: `setExpenseWaypoint` 콜러블

**Files:**
- Modify: `functions/src/functions/expenses.js`
- Modify: `functions/index.js`
- Test: `functions/test/functions/expenses.test.js`

**Interfaces:**
- Consumes: `requireSession` (`../lib/sessions`)
- Produces:
  - `setExpenseWaypoint(db, data) => { ok: true }` — `data`는 `{ sessionToken, tripId, expenseId, isWaypoint }`

**왜 `updateExpense`에 얹지 않는가:** `updateExpense`는 멤버에게 본인이 입력한 것만, 확정 전에만 수정을 허용한다. 경로 맵을 만드는 시점은 대개 경비가 전부 확정된 여행 종료 후다. 그 규칙을 물려받으면 정작 필요할 때 아무것도 표시할 수 없다. `setMemberSettled`·`setMyAccount`가 같은 이유로 `requireTripEditable`을 걸지 않는 선례다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`functions/test/functions/expenses.test.js`에 추가한다. 아래 블록은 실제 문서를 만들어야 소유자·확정·완료 조건을 검사할 수 있으므로 자체 셋업 헬퍼를 갖는다:

```js
describe('setExpenseWaypoint', () => {
  async function setup(db, { status = 'active' } = {}) {
    const tripRef = await db.collection('trips').add({
      slug: 'a', name: 'A', group: 'G', status, adminPinHash: 'x', memberPinHash: 'y',
    });
    const m1 = await tripRef.collection('members').add({ name: '가', weight: 1 });
    const m2 = await tripRef.collection('members').add({ name: '나', weight: 1 });
    const owner = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m1.id });
    const other = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m2.id });
    const expRef = await tripRef.collection('expenses').add({
      date: '2026-08-11', category: '식비', amount: 10000, merchant: '동문시장', detail: '',
      enteredBy: m1.id, recordedBy: 'member', photoPath: null, excludedMembers: [],
      confirmed: false, confirmedAt: null, isWaypoint: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    return {
      tripId: tripRef.id, tripRef, expenseId: expRef.id, expRef,
      ownerToken: owner.token, otherToken: other.token,
    };
  }

  test('경유지로 표시하고 해제한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);

    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);

    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: false,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(false);
  });

  // updateExpense와의 결정적 차이. 경로 맵은 공동의 기록이다.
  test('남이 입력한 경비에도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await setExpenseWaypoint(db, {
      sessionToken: t.otherToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  // 확정 후가 이 기능의 주 사용 시점이다.
  test('확정된 경비에도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await t.expRef.update({ confirmed: true });
    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  // 완료된 여행의 회고가 주 사용 시점이다.
  test('완료된 여행에서도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db, { status: 'completed' });
    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  test('불린이 아닌 값을 불린으로 강제한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: 'yes',
    });
    expect((await t.expRef.get()).data().isWaypoint).toBe(true);
  });

  test('없는 경비는 EXPENSE_NOT_FOUND', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(setExpenseWaypoint(db, {
      sessionToken: t.ownerToken, tripId: t.tripId, expenseId: 'nope', isWaypoint: true,
    })).rejects.toThrow('EXPENSE_NOT_FOUND');
  });

  test('다른 여행의 세션은 FORBIDDEN', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { token } = await createSession(db, { role: 'member', tripId: 'other', memberId: 'x' });
    await expect(setExpenseWaypoint(db, {
      sessionToken: token, tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    })).rejects.toThrow('FORBIDDEN');
  });

  test('세션이 없으면 UNAUTHENTICATED', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(setExpenseWaypoint(db, {
      tripId: t.tripId, expenseId: t.expenseId, isWaypoint: true,
    })).rejects.toThrow('UNAUTHENTICATED');
  });
});
```

`addExpense`가 필드를 넣는지도 확인한다. 이 파일은 공유 셋업 헬퍼 없이 테스트마다 인라인으로 세션을 만드는 방식이고(파일 첫 테스트가 그 관례다), 여행 문서를 만들지 않아도 된다 — `requireTripEditable`은 trip 문서가 없으면 편집 가능으로 취급한다. 최상위 `describe('expenses', ...)` 블록 안에 그 관례대로 추가한다:

```js
  test('addExpense initialises isWaypoint to false', async () => {
    const db = new FakeFirestore();
    const { token } = await createSession(db, { role: 'member', tripId: 't1', memberId: 'm1' });

    const { expenseId } = await addExpense(db, {
      sessionToken: token, tripId: 't1', date: '2026-08-11', category: '식비', amount: 10000,
    });

    const snap = await db.collection('trips').doc('t1').collection('expenses').doc(expenseId).get();
    expect(snap.data().isWaypoint).toBe(false);
  });
```

`setExpenseWaypoint`를 파일 상단 require 구조분해에 추가한다:

```js
const {
  listExpenses, addExpense, updateExpense, deleteExpense, confirmExpense,
  setExpenseExclusions, setExpenseWaypoint,
} = require('../../src/functions/expenses');
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd functions && npm test -- expenses`
Expected: FAIL — `setExpenseWaypoint is not a function`

- [ ] **Step 3: 최소 구현을 작성한다**

`functions/src/functions/expenses.js`의 `addExpense` 안, `.add({ ... })` 객체에 한 줄을 넣는다 (`excludedMembers` 다음):

```js
    isWaypoint: false,
```

그리고 `confirmExpense` 아래에 함수를 추가한다:

```js
/**
 * Flags an expense as a stop on the trip's route map.
 *
 * Deliberately looser than updateExpense, which limits members to their own
 * unconfirmed entries. The route map is assembled after the trip, when every
 * expense is confirmed and the trip may be marked complete -- inheriting those
 * rules would make the feature unusable exactly when it is wanted. It changes
 * one boolean and touches no money, which is why setMemberSettled and
 * setMyAccount skip requireTripEditable for the same reason.
 */
async function setExpenseWaypoint(db, data) {
  const { sessionToken, tripId, expenseId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);

  const ref = db.collection('trips').doc(tripId).collection('expenses').doc(expenseId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('EXPENSE_NOT_FOUND');

  await ref.update({ isWaypoint: !!data.isWaypoint, updatedAt: Date.now() });
  return { ok: true };
}
```

`module.exports`에 `setExpenseWaypoint`를 추가한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd functions && npm test`
Expected: PASS — 전체 (기존 325 + 신규 9)

- [ ] **Step 5: 콜러블을 등록한다**

`functions/index.js`의 `exports.setExpenseExclusions` 줄 아래에 추가한다:

```js
exports.setExpenseWaypoint = onCall(wrap(expenses.setExpenseWaypoint));
```

- [ ] **Step 6: 커밋한다**

```bash
git add functions/src/functions/expenses.js functions/index.js functions/test/functions/expenses.test.js
git commit -m "feat(functions): setExpenseWaypoint callable for route map stops"
```

---

## Task 5: 경비 카드 경유지 토글

**Files:**
- Modify: `public/views/member.js` (경비 카드 렌더링과 이벤트 바인딩)
- Modify: `public/views/admin.js` (같은 것)

**Interfaces:**
- Consumes: `setExpenseWaypoint` 콜러블 (Task 4)
- Produces: 없음

**핵심 제약:** 토글은 **`.card-actions` 블록 안에 넣으면 안 된다.** 두 파일 모두 그 블록을 조건부로 렌더링한다 — `member.js`는 `canEdit`(본인 것 && 미확정), `admin.js`는 `!locked`. Task 4에서 콜러블 권한을 일부러 느슨하게 잡았는데 UI를 그 안에 두면 제약이 UI 층에서 되살아난다. **모든 경비 카드에 항상 보여야 한다.**

또한 카드 자체가 영수증 팝업 클릭 대상(`.expense-card-receipt`)이므로 토글 핸들러는 `ev.stopPropagation()`을 호출해야 한다.

- [ ] **Step 1: `member.js`에 토글을 추가한다**

`public/views/member.js`의 경비 카드 템플릿에서, `<p class="muted" ...>${escapeHtml(e.merchant || '')} ...` 줄 **바로 앞**에 넣는다:

```js
        <div style="margin-top:0.4rem">
          <button type="button" class="btn-waypoint${e.isWaypoint ? ' on' : ''}" data-id="${e.id}" data-on="${e.isWaypoint ? '1' : ''}">📍 경유지</button>
        </div>
```

그리고 `.member-edit` 바인딩 아래에 핸들러를 추가한다:

```js
  body.querySelectorAll('.btn-waypoint').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      // The card itself opens the receipt popup; don't trigger that too.
      ev.stopPropagation();
      btn.disabled = true;
      try {
        await callFunction('setExpenseWaypoint', {
          tripId: session.tripId, expenseId: btn.dataset.id, isWaypoint: !btn.dataset.on,
        });
        await loadExpenses(body, slug, myToken);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });
```

**낙관적 갱신을 하지 않는 이유:** 호출이 실패했는데 켜진 것처럼 보이면 리포트의 경로 맵과 화면이 어긋난다. 성공 후 목록을 다시 불러 상태를 반영한다.

- [ ] **Step 2: `admin.js`에 같은 토글을 추가한다**

`public/views/admin.js`의 경비 카드 템플릿에도 같은 마크업을 넣는다. 위치는 `.card-actions` 블록 **바깥**, 카드 본문 아래다.

핸들러도 같은 모양으로 추가하되, 이 파일의 재로딩 함수 이름(`renderExpensesTab(body, slug, myToken)`)에 맞춘다:

```js
  body.querySelectorAll('.btn-waypoint').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      btn.disabled = true;
      try {
        await callFunction('setExpenseWaypoint', {
          tripId: session.tripId, expenseId: btn.dataset.id, isWaypoint: !btn.dataset.on,
        });
        await renderExpensesTab(body, slug, myToken);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, 'error');
      }
    });
  });
```

`showToast`가 이미 import 되어 있는지 확인하고, 없으면 `../ui.js`에서 추가로 가져온다.

- [ ] **Step 3: 문법을 확인하고 테스트를 돌린다**

Run:

```bash
node --check public/views/member.js
node --check public/views/admin.js
npm test
```

Expected: `--check`는 무출력, `npm test`는 전체 통과 (Task 3 이후 개수 유지)

- [ ] **Step 4: 커밋한다**

```bash
git add public/views/member.js public/views/admin.js
git commit -m "feat(frontend): waypoint toggle on every expense card"
```

---

## Task 6: 리포트 통합 · 스타일 · 서비스워커

**Files:**
- Modify: `public/views/report.js`
- Modify: `public/style.css`
- Modify: `public/sw.js:5`

**Interfaces:**
- Consumes: `buildWaypoints`, `renderRouteMap` (Task 1, 3)
- Produces: 없음 (마지막 태스크)

- [ ] **Step 1: `report.js`가 일정을 함께 불러오게 한다**

상단 import에 추가한다:

```js
import { buildWaypoints, renderRouteMap } from '../routeMap.js';
```

`getReportData` 호출부를 병렬 호출로 바꾼다. 기존:

```js
    data = await callFunction('getReportData', { tripId: session.tripId });
```

변경 후:

```js
    // Two calls rather than extending getReportData: that function carries the
    // settlement maths and a thick test suite, and a visualisation is no reason
    // to change its shape. Promise.all keeps it to one round trip of latency.
    [data, scheduleData] = await Promise.all([
      callFunction('getReportData', { tripId: session.tripId }),
      callFunction('listSchedules', { tripId: session.tripId }),
    ]);
```

`let data;` 선언을 `let data, scheduleData;`로 바꾼다.

- [ ] **Step 2: 경로 맵 섹션을 넣는다**

`container.innerHTML` 템플릿에서 `<div class="section"><h2>여행사진</h2>...` **바로 앞**에 추가한다:

```js
    <div class="section"><h2>여행 경로</h2>
      ${renderRouteMap(buildWaypoints(scheduleData.schedules, expenses), { location: trip.location, period: trip.period })}
    </div>
```

**확정 여부로 거르지 않는다.** 경로 맵은 정산이 아니라 회고이므로 `expenses`(전체)를 넘긴다 — 위쪽 섹션들이 쓰는 `confirmedExpenses`가 아니다. 어차피 `isWaypoint`가 참인 것만 들어간다.

- [ ] **Step 3: 스타일을 추가한다**

`public/style.css` 맨 아래에 추가한다:

```css
/* ---- 여행 경로 맵 ---- */
.rm-caption { font-size: 12px; margin-bottom: 0.6rem; }
.rm-svg { width: 100%; height: auto; display: block; }
.rm-link { stroke: var(--rule); stroke-width: 2; }
.rm-node { stroke-width: 3; }
.rm-num {
  fill: var(--ink); font-size: 12px; font-weight: 600;
  text-anchor: middle; font-family: var(--f-body);
}
.rm-label {
  fill: var(--ink-2); font-size: 9px; text-anchor: middle;
  font-family: var(--f-body);
}
.rm-date {
  fill: var(--ink-3); font-size: 9px; text-anchor: middle;
  font-family: var(--f-body);
}

/* ---- 경유지 토글 ---- */
.btn-waypoint {
  border: 1px solid var(--rule); background: none; border-radius: 999px;
  padding: 0.15rem 0.5rem; font: inherit; font-size: 11px;
  color: var(--ink-3); cursor: pointer;
}
.btn-waypoint.on {
  background: var(--ink); color: var(--paper); border-color: var(--ink);
}
.btn-waypoint:disabled { opacity: 0.5; cursor: default; }
```

`.rm-label`의 `text-anchor: middle`은 `<text>`에 `x`가 없어도 각 `<tspan>`이 자기 `x`를 갖고 있어 동작한다.

- [ ] **Step 4: 서비스워커 캐시를 범프한다**

`public/sw.js:5`:

```js
const CACHE_NAME = 'tripsplit-shell-v5';
```

`SHELL_ASSETS`는 바꾸지 않는다 — fetch 핸들러가 동일 출처 GET을 전부 캐시하므로 뷰 모듈은 자동으로 잡힌다.

- [ ] **Step 5: 전체 테스트를 돌린다**

Run:

```bash
node --check public/views/report.js
npm test
cd functions && npm test
```

Expected: 전부 PASS

- [ ] **Step 6: 커밋한다**

```bash
git add public/views/report.js public/style.css public/sw.js
git commit -m "feat(frontend): route map section in the trip report"
```

- [ ] **Step 7: 배포 순서를 지킨다**

**이 기능은 신규 콜러블(`setExpenseWaypoint`)에 의존한다.** main에 병합하면 Vercel이 프론트를 자동 배포하지만 Firebase 함수는 수동이다. 순서를 지키지 않으면 라이브에서 토글이 "네트워크 오류"를 낸다 (Plan 11에서 실제로 발생).

```powershell
npx -y firebase-tools@14 deploy --only functions --project prod
```

PowerShell에서 실행한다 (Git Bash에서는 exit 127로 죽는다). 배포 후 확인:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' \
  -d '{"data":{}}' \
  https://asia-northeast3-sfayw-10d11.cloudfunctions.net/setExpenseWaypoint
```

**401이면 배포됨, 404면 미배포.** 401을 확인한 뒤에 main에 병합한다.

---

## 자체 검토 결과

**스펙 커버리지:**

| 스펙 | 태스크 |
|---|---|
| §1.1 `isWaypoint` 필드, 마이그레이션 불필요 | Task 4 (+ Task 1에 `undefined` 제외 테스트) |
| §1.2 `setExpenseWaypoint` 권한 | Task 4 |
| §1.3 병렬 호출 | Task 6 |
| §1.4 병합·정렬·중복 접기·URL 제외 | Task 1 |
| §2.1 지그재그, 행당 3개 고정 | Task 2 |
| §2.2 좌표 | Task 2 |
| §2.3 연결선 | Task 3 (스펙의 베지어 → 수직 직선으로 정정, 근거 명시) |
| §2.4 라벨 2줄·말줄임·`<title>` | Task 3 |
| §2.5 날짜 칩 | Task 3 |
| §2.6 테두리 방식과 대비 | Task 3 (테스트로 고정) + Global Constraints |
| §2.7 머리말 | Task 3 |
| §2.8 빈 상태 | Task 3 |
| §3 토글 UI, 카드에 배치 | Task 5 |
| §4 파일 목록 | 전체 |
| §5 테스트 | Task 1~4 |

**의도한 간극:** `renderRouteMap`의 시각적 배치(곡선 모양, 겹침, 실제 가독성)는 단위 테스트 대상이 아니다 — 스펙 §5가 육안 확인으로 넘긴 부분이다.

**구현자가 주의할 점:**

- Task 2와 Task 3은 `routeMap.js` 맨 아래 `export` 문을 각각 **교체**한다. 추가가 아니다.
- Task 4의 `addExpense` 테스트는 이 파일의 기존 헬퍼 이름을 확인하고 맞춰야 한다. 위 코드의 `setupTrip`은 예시 이름이다.
- Task 5는 토글을 `.card-actions` 안에 넣으면 안 된다. 두 파일 모두 그 블록이 조건부다.
- Task 6 Step 7의 배포 순서는 건너뛰면 라이브가 깨진다.
