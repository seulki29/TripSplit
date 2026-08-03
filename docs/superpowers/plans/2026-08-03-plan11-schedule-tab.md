# 여행 일정 탭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여행 기간의 일정을 구성원 누구나 등록·수정하고, 주간/하루/연속/목록 네 가지 뷰로 공유하는 탭을 만든다.

**Architecture:** 레이아웃 계산은 DOM 없는 순수 함수(`public/scheduleLayout.js`)로 완전히 분리하고, 세 타임테이블 뷰는 공통 `renderDayColumn` 하나를 서로 다르게 배치하는 얇은 껍데기로 만든다. 백엔드는 기존 콜러블 패턴 그대로 `schedules.js` 하나를 추가한다.

**Tech Stack:** 빌드 없는 바닐라 ES 모듈, Firebase Cloud Functions (CommonJS, Node 20), Firestore. 프론트 테스트는 `node --test`, 백엔드 테스트는 jest.

**Spec:** `docs/superpowers/specs/2026-08-03-plan11-schedule-tab-design.md`

## Global Constraints

- **프레임워크·빌드 도구·신규 npm 의존성을 추가하지 않는다.** 이 프로젝트는 빌드 단계가 없다.
- 프론트엔드는 ES 모듈(`import`/`export`), 백엔드는 CommonJS(`require`/`module.exports`). 섞지 않는다.
- 사용자에게 보이는 모든 문자열은 한국어.
- **사용자 입력을 HTML에 넣을 때는 반드시 `escapeHtml()`을 거친다.** (`public/ui.js`)
- 시간은 자정 기준 분 정수로 저장한다. 문자열 `'11:00'`은 표시 직전에만 만든다.
- 프론트엔드 파일을 하나라도 건드리면 **`public/sw.js`의 `CACHE_NAME`을 범프한다.** 현재 값은 `tripsplit-shell-v3` → `tripsplit-shell-v4`. (Task 9에서 한 번만)
- 백엔드 에러는 `throw new Error('CODE')`로 던지고, 모든 코드는 `public/errorMessages.js`의 `MESSAGES`에 대응 문구가 있어야 한다.
- 커밋 메시지는 기존 관례를 따른다: `feat(frontend):`, `feat(functions):`, `fix(...)`, `test(...)`, `refactor(...)`.
- 테스트 실행: 프론트 `npm test` (루트), 백엔드 `npm test` (`functions/` 안에서).

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `public/scheduleLayout.js` | 신규 | 순수 계산. DOM 없음 |
| `public/views/schedule.js` | 신규 | 탭 셸 — 뷰 전환, 로드, 새로고침, 추가 버튼 |
| `public/views/scheduleTimetable.js` | 신규 | `renderDayColumn` + 주간/하루/연속 껍데기 |
| `public/views/scheduleList.js` | 신규 | 목록 뷰 |
| `public/views/scheduleForm.js` | 신규 | 등록/수정 모달 |
| `functions/src/lib/memberIds.js` | 신규 | `expenses.js`에서 추출한 멤버 ID 검증 |
| `functions/src/functions/schedules.js` | 신규 | 콜러블 4개 |
| `public/errorMessages.js` | 수정 | 에러 코드 7개 추가 |
| `public/views/member.js` | 수정 | 일정 탭 |
| `public/views/admin.js` | 수정 | 일정 탭 |
| `public/style.css` | 수정 | 타임테이블 스타일 |
| `public/sw.js` | 수정 | `CACHE_NAME` 범프 |
| `functions/index.js` | 수정 | 콜러블 등록 |
| `functions/src/functions/expenses.js` | 수정 | 추출된 함수 사용 |

**태스크 순서 근거:** 순수 함수(1~3) → 백엔드(4~5) → UI(6~9). 앞 태스크가 뒤 태스크의 의존성이고, 각 태스크는 자체 테스트 사이클로 끝난다.

---

## Task 1: 시간·링크 변환 순수 함수

**Files:**
- Create: `public/scheduleLayout.js`
- Test: `public/test/scheduleLayout.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `minToLabel(min: number|null) => string` — `660 → '11:00'`, `1440 → '24:00'`, `null → ''`
  - `labelToMin(label: string) => number|null` — `'11:00' → 660`, 잘못된 입력 → `null`
  - `mapLinkFor(placeName: string) => string|null`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`public/test/scheduleLayout.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { minToLabel, labelToMin, mapLinkFor } from '../scheduleLayout.js';

describe('minToLabel', () => {
  test('자정 기준 분을 HH:MM으로 바꾼다', () => {
    assert.equal(minToLabel(0), '00:00');
    assert.equal(minToLabel(660), '11:00');
    assert.equal(minToLabel(795), '13:15');
  });

  test('한 자리 시/분에 0을 채운다', () => {
    assert.equal(minToLabel(65), '01:05');
  });

  // 시간축의 마지막 눈금이 1440까지 올라갈 수 있다. '00:00'으로 적으면
  // 축이 자정으로 되감긴 것처럼 보인다.
  test('1440은 24:00으로 표시한다', () => {
    assert.equal(minToLabel(1440), '24:00');
  });

  test('null과 undefined는 빈 문자열', () => {
    assert.equal(minToLabel(null), '');
    assert.equal(minToLabel(undefined), '');
  });
});

describe('labelToMin', () => {
  test('HH:MM을 분으로 바꾼다', () => {
    assert.equal(labelToMin('11:00'), 660);
    assert.equal(labelToMin('00:00'), 0);
    assert.equal(labelToMin('13:15'), 795);
  });

  test('minToLabel과 왕복한다', () => {
    for (const m of [0, 65, 660, 795, 1439]) {
      assert.equal(labelToMin(minToLabel(m)), m);
    }
  });

  test('형식에 맞지 않으면 null', () => {
    assert.equal(labelToMin(''), null);
    assert.equal(labelToMin('11'), null);
    assert.equal(labelToMin('abc'), null);
    assert.equal(labelToMin(null), null);
  });

  test('범위를 벗어난 시/분은 null', () => {
    assert.equal(labelToMin('25:00'), null);
    assert.equal(labelToMin('11:70'), null);
  });
});

describe('mapLinkFor', () => {
  test('장소명을 카카오맵 검색 링크로 만든다', () => {
    assert.equal(
      mapLinkFor('켄싱턴리조트평창'),
      'https://map.kakao.com/?q=%EC%BC%84%EC%8B%B1%ED%84%B4%EB%A6%AC%EC%A1%B0%ED%8A%B8%ED%8F%89%EC%B0%BD',
    );
  });

  test('공백을 인코딩한다', () => {
    assert.equal(mapLinkFor('제주 공항'), 'https://map.kakao.com/?q=%EC%A0%9C%EC%A3%BC%20%EA%B3%B5%ED%95%AD');
  });

  test('http(s) URL은 그대로 통과시킨다', () => {
    assert.equal(mapLinkFor('https://map.kakao.com/?itemId=123'), 'https://map.kakao.com/?itemId=123');
    assert.equal(mapLinkFor('http://naver.me/abc'), 'http://naver.me/abc');
  });

  // 사용자가 붙여넣은 문자열이 그대로 href가 되므로, 스킴 검사를 통과하지
  // 못한 것은 전부 검색어로 취급되어야 한다.
  test('위험한 스킴은 URL로 취급하지 않는다', () => {
    const link = mapLinkFor('javascript:alert(1)');
    assert.ok(link.startsWith('https://map.kakao.com/?q='));
    assert.ok(!link.startsWith('javascript:'));
  });

  test('빈 값은 null', () => {
    assert.equal(mapLinkFor(''), null);
    assert.equal(mapLinkFor('   '), null);
    assert.equal(mapLinkFor(null), null);
    assert.equal(mapLinkFor(undefined), null);
  });

  test('앞뒤 공백을 없앤다', () => {
    assert.equal(mapLinkFor('  성산  '), mapLinkFor('성산'));
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scheduleLayout.js'`

- [ ] **Step 3: 최소 구현을 작성한다**

`public/scheduleLayout.js`:

```js
// 시각 표현은 자정 기준 분 정수다. 픽셀 환산·정렬·겹침 판정이 전부 산술로
// 끝나기 때문이며, 'HH:MM' 문자열은 화면에 찍기 직전에만 만든다.

function minToLabel(min) {
  if (typeof min !== 'number' || !Number.isFinite(min)) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function labelToMin(label) {
  if (typeof label !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

// placeName은 장소명일 수도, 사용자가 지도에서 복사해 붙여넣은 URL일 수도
// 있다. URL이면 그대로 열어야 정확한 핀이 되고, 아니면 검색어로 넘긴다.
// 검사를 통과하지 못한 문자열은 전부 검색어가 되므로 javascript: 같은
// 스킴이 href에 실릴 일이 없다.
function mapLinkFor(placeName) {
  const s = String(placeName ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://map.kakao.com/?q=${encodeURIComponent(s)}`;
}

export { minToLabel, labelToMin, mapLinkFor };
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS. `minToLabel(1440)`이 `'24:00'`을 내는지 확인 — `Math.floor(1440/60) = 24`, `1440 % 60 = 0`이라 자연스럽게 나온다.

- [ ] **Step 5: 커밋한다**

```bash
git add public/scheduleLayout.js public/test/scheduleLayout.test.js
git commit -m "feat(frontend): schedule time and map-link conversion helpers"
```

---

## Task 2: 겹침 레인 배치

**Files:**
- Modify: `public/scheduleLayout.js`
- Test: `public/test/scheduleLayout.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `assignLanes(entries) => Array<{ entry, lane: number, laneCount: number }>`
  - `entries`는 `{ id, startMin, endMin }`를 가진 객체 배열. `startMin`이 `null`인 항목은 호출 전에 걸러서 넘긴다.
  - 반환 순서는 입력 순서와 무관하게 `startMin` 오름차순이다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`public/test/scheduleLayout.test.js`에 추가 (import 줄에 `assignLanes`를 넣는다):

```js
import { minToLabel, labelToMin, mapLinkFor, assignLanes } from '../scheduleLayout.js';

// 테스트를 읽기 쉽게 하는 헬퍼. id는 결과를 지목할 때만 쓴다.
function e(id, startMin, endMin) {
  return { id, startMin, endMin };
}

function laneOf(result, id) {
  return result.find((r) => r.entry.id === id);
}

describe('assignLanes', () => {
  test('빈 입력은 빈 배열', () => {
    assert.deepEqual(assignLanes([]), []);
  });

  test('겹치지 않으면 전부 lane 0, laneCount 1', () => {
    const result = assignLanes([e('a', 600, 660), e('b', 700, 760)]);
    assert.equal(result.length, 2);
    for (const r of result) {
      assert.equal(r.lane, 0);
      assert.equal(r.laneCount, 1);
    }
  });

  test('두 개가 겹치면 lane 0과 1, laneCount 2', () => {
    const result = assignLanes([e('a', 600, 720), e('b', 660, 780)]);
    assert.equal(laneOf(result, 'a').lane, 0);
    assert.equal(laneOf(result, 'b').lane, 1);
    assert.equal(laneOf(result, 'a').laneCount, 2);
    assert.equal(laneOf(result, 'b').laneCount, 2);
  });

  test('결과는 startMin 오름차순으로 나온다', () => {
    const result = assignLanes([e('late', 700, 760), e('early', 600, 660)]);
    assert.deepEqual(result.map((r) => r.entry.id), ['early', 'late']);
  });

  // 경계: 11:00-12:00과 12:00-13:00은 겹치지 않는다. 판정은
  // aStart < bEnd && bStart < aEnd 이므로 660 < 720 && 720 < 720 은 거짓.
  test('끝나는 시각과 시작하는 시각이 같으면 겹치지 않는다', () => {
    const result = assignLanes([e('a', 660, 720), e('b', 720, 780)]);
    assert.equal(laneOf(result, 'a').laneCount, 1);
    assert.equal(laneOf(result, 'b').laneCount, 1);
  });

  // 이게 핵심이다. 하루 전체의 최대 레인 수로 나누면, 오후에 3개가 겹쳤다는
  // 이유로 아침의 단독 일정까지 1/3 폭이 된다.
  test('클러스터마다 laneCount를 따로 센다', () => {
    const result = assignLanes([
      e('morning', 540, 600),                                  // 단독
      e('pm1', 800, 900), e('pm2', 810, 910), e('pm3', 820, 920), // 3중첩
    ]);
    assert.equal(laneOf(result, 'morning').laneCount, 1);
    assert.equal(laneOf(result, 'pm1').laneCount, 3);
    assert.equal(laneOf(result, 'pm2').laneCount, 3);
    assert.equal(laneOf(result, 'pm3').laneCount, 3);
  });

  test('비어난 레인을 재사용한다', () => {
    // a와 b가 겹치고, c는 a가 끝난 뒤 시작하지만 b와는 겹친다.
    // c는 새 레인이 아니라 a가 비운 레인 0으로 들어가야 한다.
    const result = assignLanes([e('a', 600, 660), e('b', 620, 800), e('c', 700, 780)]);
    assert.equal(laneOf(result, 'a').lane, 0);
    assert.equal(laneOf(result, 'b').lane, 1);
    assert.equal(laneOf(result, 'c').lane, 0);
    assert.equal(laneOf(result, 'c').laneCount, 2);
  });

  // 셋이 사슬처럼 이어지면 (a-b 겹침, b-c 겹침, a-c 안 겹침) 하나의
  // 클러스터이고 레인은 2개면 충분하다.
  test('사슬처럼 이어진 겹침은 한 클러스터', () => {
    const result = assignLanes([e('a', 600, 700), e('b', 650, 750), e('c', 720, 800)]);
    assert.equal(laneOf(result, 'a').laneCount, 2);
    assert.equal(laneOf(result, 'c').laneCount, 2);
    assert.equal(laneOf(result, 'c').lane, 0);
  });

  test('시작 시각이 같으면 긴 것이 먼저(lane 0)', () => {
    const result = assignLanes([e('short', 600, 630), e('long', 600, 720)]);
    assert.equal(laneOf(result, 'long').lane, 0);
    assert.equal(laneOf(result, 'short').lane, 1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test`
Expected: FAIL — `assignLanes is not a function`

- [ ] **Step 3: 최소 구현을 작성한다**

`public/scheduleLayout.js`에 추가:

```js
/**
 * 겹치는 일정을 나란한 레인에 배치한다.
 *
 * laneCount를 "클러스터"(서로 이어져 겹치는 무리) 단위로 세는 것이 핵심이다.
 * 하루 전체의 최대 레인 수로 폭을 나누면, 오후에 3개가 겹쳤다는 이유만으로
 * 아침의 단독 일정까지 1/3 폭이 된다.
 *
 * 반환값의 lane/laneCount로 left = lane / laneCount, width = 1 / laneCount
 * (비율)를 구한다.
 */
function assignLanes(entries) {
  const sorted = [...entries].sort((a, b) => (
    a.startMin - b.startMin || b.endMin - a.endMin
  ));

  const result = [];
  let cluster = [];      // 이번 클러스터의 결과 항목들
  let clusterEnd = -1;   // 클러스터에 속한 일정들의 최대 endMin
  let lanes = [];        // 레인별 마지막 endMin

  function flushCluster() {
    for (const item of cluster) item.laneCount = lanes.length;
    result.push(...cluster);
    cluster = [];
    lanes = [];
    clusterEnd = -1;
  }

  for (const entry of sorted) {
    // 진행 중인 클러스터의 어느 일정과도 겹치지 않으면 새 클러스터를 연다.
    if (cluster.length > 0 && entry.startMin >= clusterEnd) flushCluster();

    let lane = lanes.findIndex((lastEnd) => lastEnd <= entry.startMin);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(entry.endMin);
    } else {
      lanes[lane] = entry.endMin;
    }

    cluster.push({ entry, lane, laneCount: 0 });
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  if (cluster.length > 0) flushCluster();

  return result;
}

export { minToLabel, labelToMin, mapLinkFor, assignLanes };
```

기존 맨 아래 `export { minToLabel, labelToMin, mapLinkFor };` 줄은 위 줄로 교체한다 (중복 export는 문법 오류다).

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS (assignLanes 9개 포함 전부)

- [ ] **Step 5: 커밋한다**

```bash
git add public/scheduleLayout.js public/test/scheduleLayout.test.js
git commit -m "feat(frontend): per-cluster overlap lane assignment for schedule blocks"
```

---

## Task 3: 시간축 범위와 날짜 그룹핑

**Files:**
- Modify: `public/scheduleLayout.js`
- Test: `public/test/scheduleLayout.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `MIN_FROM = 480`, `MIN_TO = 1320`, `PX_PER_MIN = 0.8` (상수 export)
  - `timeRangeFor(entries) => { fromMin, toMin }`
  - `groupByDate(entries, period) => { dates: string[], byDate: Record<string, {timed, untimed}>, floating: [] }`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`public/test/scheduleLayout.test.js`에 추가 (import 줄에 `timeRangeFor, groupByDate`를 넣는다):

```js
describe('timeRangeFor', () => {
  test('시간이 있는 일정이 없으면 08:00-22:00', () => {
    assert.deepEqual(timeRangeFor([]), { fromMin: 480, toMin: 1320 });
    assert.deepEqual(
      timeRangeFor([{ startMin: null, endMin: null }]),
      { fromMin: 480, toMin: 1320 },
    );
  });

  test('기본 범위 안에 드는 일정만 있으면 범위가 그대로', () => {
    assert.deepEqual(timeRangeFor([e('a', 600, 720)]), { fromMin: 480, toMin: 1320 });
  });

  test('이른 일정이 있으면 아래로 시간 단위 내림', () => {
    // 06:30 시작 -> 06:00
    assert.equal(timeRangeFor([e('a', 390, 500)]).fromMin, 360);
  });

  test('늦은 일정이 있으면 위로 시간 단위 올림', () => {
    // 23:45 종료 -> 24:00
    assert.equal(timeRangeFor([e('a', 1300, 1425)]).toMin, 1440);
  });

  test('정각에 끝나면 더 올리지 않는다', () => {
    assert.equal(timeRangeFor([e('a', 1300, 1380)]).toMin, 1380);
  });

  test('시간이 null인 항목은 계산에서 빠진다', () => {
    const result = timeRangeFor([e('a', 600, 720), { startMin: null, endMin: null }]);
    assert.deepEqual(result, { fromMin: 480, toMin: 1320 });
  });
});

describe('groupByDate', () => {
  const period = { start: '2026-08-01', end: '2026-08-03' };

  test('기간의 모든 날짜를 일정이 없어도 낸다', () => {
    const result = groupByDate([], period);
    assert.deepEqual(result.dates, ['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  test('시간이 있는 일정은 timed 버킷', () => {
    const entry = { id: 'a', date: '2026-08-02', startMin: 600, endMin: 720 };
    const result = groupByDate([entry], period);
    assert.deepEqual(result.byDate['2026-08-02'].timed, [entry]);
    assert.deepEqual(result.byDate['2026-08-02'].untimed, []);
  });

  test('날짜만 있고 시간이 없으면 untimed 버킷', () => {
    const entry = { id: 'a', date: '2026-08-02', startMin: null, endMin: null };
    const result = groupByDate([entry], period);
    assert.deepEqual(result.byDate['2026-08-02'].untimed, [entry]);
    assert.deepEqual(result.byDate['2026-08-02'].timed, []);
  });

  test('날짜가 없으면 floating', () => {
    const entry = { id: 'a', date: null, startMin: null, endMin: null };
    const result = groupByDate([entry], period);
    assert.deepEqual(result.floating, [entry]);
  });

  // 관리자가 기간을 좁혔을 때 기간 밖으로 밀려난 일정이 화면에서 사라지면
  // 안 된다. 데이터는 남아 있는데 보이지 않는 상태가 최악이다.
  test('기간 밖 날짜의 일정도 날짜 목록에 넣는다', () => {
    const entry = { id: 'a', date: '2026-08-09', startMin: 600, endMin: 720 };
    const result = groupByDate([entry], period);
    assert.ok(result.dates.includes('2026-08-09'));
    assert.deepEqual(result.byDate['2026-08-09'].timed, [entry]);
  });

  test('날짜 목록은 정렬되어 있다', () => {
    const entries = [
      { id: 'a', date: '2026-07-30', startMin: 600, endMin: 720 },
      { id: 'b', date: '2026-08-09', startMin: 600, endMin: 720 },
    ];
    const result = groupByDate(entries, period);
    assert.deepEqual(result.dates, [
      '2026-07-30', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-09',
    ]);
  });

  test('기간이 비어도 일정 날짜만으로 동작한다', () => {
    const entry = { id: 'a', date: '2026-08-02', startMin: 600, endMin: 720 };
    assert.deepEqual(groupByDate([entry], null).dates, ['2026-08-02']);
    assert.deepEqual(groupByDate([entry], { start: null, end: null }).dates, ['2026-08-02']);
  });

  test('기간도 일정도 없으면 날짜 목록이 비어 있다', () => {
    const result = groupByDate([], null);
    assert.deepEqual(result.dates, []);
    assert.deepEqual(result.floating, []);
  });

  test('timed 버킷은 startMin 순으로 정렬된다', () => {
    const entries = [
      { id: 'late', date: '2026-08-01', startMin: 700, endMin: 760 },
      { id: 'early', date: '2026-08-01', startMin: 600, endMin: 660 },
    ];
    const result = groupByDate(entries, period);
    assert.deepEqual(result.byDate['2026-08-01'].timed.map((x) => x.id), ['early', 'late']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test`
Expected: FAIL — `timeRangeFor is not a function`

- [ ] **Step 3: 최소 구현을 작성한다**

`public/scheduleLayout.js`에 추가:

```js
// 축의 기본 범위는 08:00-22:00이다. 00-24시를 다 그리면 새벽이 텅 빈 채
// 스크롤만 길어진다. 이 범위를 벗어나는 일정이 있으면 그만큼만 넓힌다.
const MIN_FROM = 480;   // 08:00
const MIN_TO = 1320;    // 22:00
const PX_PER_MIN = 0.8; // 1시간 = 48px

function timeRangeFor(entries) {
  const timed = entries.filter((x) => typeof x.startMin === 'number');
  if (timed.length === 0) return { fromMin: MIN_FROM, toMin: MIN_TO };

  const earliest = Math.min(...timed.map((x) => x.startMin));
  const latest = Math.max(...timed.map((x) => x.endMin));

  return {
    fromMin: Math.min(MIN_FROM, Math.floor(earliest / 60) * 60),
    toMin: Math.max(MIN_TO, Math.ceil(latest / 60) * 60),
  };
}

// YYYY-MM-DD 문자열을 하루씩 늘린다. Date 객체를 쓰면 타임존에 따라 하루가
// 밀릴 수 있어서 UTC로 고정해 계산한다.
function eachDate(start, end) {
  const out = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return out;
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * 날짜 목록은 여행 기간과 일정에 실제로 등장하는 날짜의 합집합이다.
 * 관리자가 나중에 기간을 좁혔을 때 기간 밖으로 밀려난 일정이 화면에서
 * 사라지면 안 된다 — 데이터는 남아 있는데 보이지 않는 상태가 최악이다.
 */
function groupByDate(entries, period) {
  const dateSet = new Set();
  if (period?.start && period?.end) {
    for (const d of eachDate(period.start, period.end)) dateSet.add(d);
  }
  for (const entry of entries) {
    if (entry.date) dateSet.add(entry.date);
  }

  const dates = [...dateSet].sort();
  const byDate = {};
  for (const d of dates) byDate[d] = { timed: [], untimed: [] };

  const floating = [];
  for (const entry of entries) {
    if (!entry.date) { floating.push(entry); continue; }
    const bucket = byDate[entry.date];
    if (typeof entry.startMin === 'number') bucket.timed.push(entry);
    else bucket.untimed.push(entry);
  }

  for (const d of dates) {
    byDate[d].timed.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  }

  return { dates, byDate, floating };
}

export {
  MIN_FROM, MIN_TO, PX_PER_MIN,
  minToLabel, labelToMin, mapLinkFor, assignLanes, timeRangeFor, groupByDate,
};
```

맨 아래 기존 export 줄을 위 블록으로 교체한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS — 전체 스위트

- [ ] **Step 5: 커밋한다**

```bash
git add public/scheduleLayout.js public/test/scheduleLayout.test.js
git commit -m "feat(frontend): schedule time-axis range and date grouping"
```

---

## Task 4: `validateMemberIds` 추출

**Files:**
- Create: `functions/src/lib/memberIds.js`
- Create: `functions/test/lib/memberIds.test.js`
- Modify: `functions/src/functions/expenses.js:21-27` (함수 정의 제거), `:47`, `:113` (호출부)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `assertMemberIdsExist(db, tripId, ids, errorCode) => Promise<void>` — `ids`가 배열이 아니거나 실재하지 않는 ID가 있으면 `new Error(errorCode)`를 던진다. 빈 배열은 통과.

**왜 추출하는가:** 일정의 `participants` 검증에 같은 로직이 필요하다. 복사하면 두 곳이 따로 늙는다. 다만 **에러 코드는 호출자가 정한다** — 경비는 `INVALID_EXCLUDED_MEMBERS`, 일정은 `INVALID_PARTICIPANTS`로 서로 다른 문구가 나가야 한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`functions/test/lib/memberIds.test.js`:

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { assertMemberIdsExist } = require('../../src/lib/memberIds');

async function makeTripWithMembers(db, names) {
  const tripRef = await db.collection('trips').add({ slug: 'a', name: 'A' });
  const ids = [];
  for (const name of names) {
    const ref = await tripRef.collection('members').add({ name, weight: 1 });
    ids.push(ref.id);
  }
  return { tripId: tripRef.id, ids };
}

describe('assertMemberIdsExist', () => {
  test('빈 배열은 통과한다', async () => {
    const db = new FakeFirestore();
    const { tripId } = await makeTripWithMembers(db, ['가']);
    await expect(assertMemberIdsExist(db, tripId, [], 'CODE')).resolves.toBeUndefined();
  });

  test('실재하는 ID는 통과한다', async () => {
    const db = new FakeFirestore();
    const { tripId, ids } = await makeTripWithMembers(db, ['가', '나']);
    await expect(assertMemberIdsExist(db, tripId, ids, 'CODE')).resolves.toBeUndefined();
  });

  test('없는 ID가 하나라도 있으면 주어진 코드로 던진다', async () => {
    const db = new FakeFirestore();
    const { tripId, ids } = await makeTripWithMembers(db, ['가']);
    await expect(
      assertMemberIdsExist(db, tripId, [...ids, 'nope'], 'MY_CODE'),
    ).rejects.toThrow('MY_CODE');
  });

  test('배열이 아니면 주어진 코드로 던진다', async () => {
    const db = new FakeFirestore();
    const { tripId } = await makeTripWithMembers(db, ['가']);
    await expect(assertMemberIdsExist(db, tripId, null, 'MY_CODE')).rejects.toThrow('MY_CODE');
    await expect(assertMemberIdsExist(db, tripId, 'x', 'MY_CODE')).rejects.toThrow('MY_CODE');
  });

  test('다른 여행의 구성원 ID는 통과하지 못한다', async () => {
    const db = new FakeFirestore();
    const a = await makeTripWithMembers(db, ['가']);
    const b = await makeTripWithMembers(db, ['나']);
    await expect(
      assertMemberIdsExist(db, a.tripId, b.ids, 'MY_CODE'),
    ).rejects.toThrow('MY_CODE');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd functions && npm test -- memberIds`
Expected: FAIL — `Cannot find module '../../src/lib/memberIds'`

- [ ] **Step 3: 최소 구현을 작성한다**

`functions/src/lib/memberIds.js`:

```js
/**
 * 주어진 ID들이 전부 이 여행의 구성원인지 확인한다.
 *
 * 던지는 에러 코드를 호출자가 정하는 이유: 같은 검사지만 사용자에게 나가는
 * 문구가 다르다. 경비는 "제외 구성원 선택이 올바르지 않습니다",
 * 일정은 "참여자 선택이 올바르지 않습니다".
 */
async function assertMemberIdsExist(db, tripId, ids, errorCode) {
  if (!Array.isArray(ids)) throw new Error(errorCode);
  if (ids.length === 0) return;
  const membersRef = db.collection('trips').doc(tripId).collection('members');
  const snaps = await Promise.all(ids.map((id) => membersRef.doc(id).get()));
  if (snaps.some((s) => !s.exists)) throw new Error(errorCode);
}

module.exports = { assertMemberIdsExist };
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd functions && npm test -- memberIds`
Expected: PASS (5개)

- [ ] **Step 5: `expenses.js`가 이걸 쓰게 바꾼다**

`functions/src/functions/expenses.js`에서 `validateMemberIds` 함수 정의(21~27행)를 삭제하고, 파일 상단 require 블록에 추가한다:

```js
const { assertMemberIdsExist } = require('../lib/memberIds');
```

호출부 두 곳을 바꾼다:

```js
// addExpense 안 (기존: await validateMemberIds(db, tripId, excludedMembers);)
await assertMemberIdsExist(db, tripId, excludedMembers, 'INVALID_EXCLUDED_MEMBERS');

// updateExpense 안 (기존: await validateMemberIds(db, tripId, patch.excludedMembers);)
await assertMemberIdsExist(db, tripId, patch.excludedMembers, 'INVALID_EXCLUDED_MEMBERS');
```

`setExpenseExclusions` 안의 호출도 같은 방식으로 바꾼다:

```js
await assertMemberIdsExist(db, tripId, excludedMemberIds, 'INVALID_EXCLUDED_MEMBERS');
```

- [ ] **Step 6: 기존 경비 테스트가 여전히 통과하는지 확인한다**

Run: `cd functions && npm test`
Expected: PASS — 전체. 특히 `expenses.test.js`의 제외 구성원 검증 테스트가 `INVALID_EXCLUDED_MEMBERS`를 그대로 받아야 한다. 실패하면 호출부 세 곳 중 코드 문자열을 빠뜨린 곳이 있다.

- [ ] **Step 7: 커밋한다**

```bash
git add functions/src/lib/memberIds.js functions/test/lib/memberIds.test.js functions/src/functions/expenses.js
git commit -m "refactor(functions): extract member-id validation for reuse by schedules"
```

---

## Task 5: 일정 콜러블 4개

**Files:**
- Create: `functions/src/functions/schedules.js`
- Create: `functions/test/functions/schedules.test.js`
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `assertMemberIdsExist` (Task 4), `requireSession` (`../lib/sessions`), `requireTripEditable` (`../lib/tripStatus`), `CATEGORIES` (`../lib/categories`)
- Produces:
  - `listSchedules(db, data) => { plans: [{id, ...}], schedules: [{id, ...}] }`
  - `addSchedule(db, data) => { scheduleId }`
  - `updateSchedule(db, data) => { ok: true }`
  - `deleteSchedule(db, data) => { ok: true }`
  - `data`는 항상 `{ sessionToken, tripId, ... }`를 포함한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`functions/test/functions/schedules.test.js`:

```js
const { FakeFirestore } = require('../helpers/fakeFirestore');
const { createSession } = require('../../src/lib/sessions');
const {
  listSchedules, addSchedule, updateSchedule, deleteSchedule,
} = require('../../src/functions/schedules');

async function setup(db, { status = 'active' } = {}) {
  const tripRef = await db.collection('trips').add({
    slug: 'a', name: 'A', group: 'G', status, adminPinHash: 'x', memberPinHash: 'y',
  });
  const m1 = await tripRef.collection('members').add({ name: '가', weight: 1 });
  const m2 = await tripRef.collection('members').add({ name: '나', weight: 1 });
  const member = await createSession(db, { role: 'member', tripId: tripRef.id, memberId: m1.id });
  const admin = await createSession(db, { role: 'admin', tripId: tripRef.id });
  return {
    tripId: tripRef.id, m1: m1.id, m2: m2.id, memberToken: member.token, adminToken: admin.token,
  };
}

function validEntry(t, over = {}) {
  return {
    sessionToken: t.memberToken,
    tripId: t.tripId,
    planId: 'default',
    title: '성산일출봉',
    detail: '입장료 5천원',
    category: '놀이',
    placeName: '성산일출봉',
    date: '2026-08-02',
    startMin: 660,
    endMin: 780,
    participants: [t.m1, t.m2],
    ...over,
  };
}

// listSchedules를 먼저 호출해 plans/default를 만들어두는 헬퍼.
async function withPlan(db, t) {
  await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
}

describe('listSchedules', () => {
  test('처음 호출하면 plans/default를 만든다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const result = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].id).toBe('default');
    expect(result.plans[0].name).toBe('1안');
    expect(result.schedules).toEqual([]);
  });

  // merge:true로 매번 덮어쓰면 탭을 열 때마다 createdAt이 갱신되고,
  // 나중에 안 이름을 바꿔도 다음 조회에서 '1안'으로 되돌아간다.
  test('두 번 호출해도 plan은 하나이고 내용이 보존된다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const first = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    const createdAt = first.plans[0].createdAt;

    await db.collection('trips').doc(t.tripId).collection('plans').doc('default')
      .update({ name: '2안' });

    const second = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(second.plans).toHaveLength(1);
    expect(second.plans[0].name).toBe('2안');
    expect(second.plans[0].createdAt).toBe(createdAt);
  });

  test('완료된 여행에서도 성공한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db, { status: 'completed' });
    const result = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(result.plans).toHaveLength(1);
  });

  test('저장된 일정을 돌려준다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await addSchedule(db, validEntry(t));
    const result = await listSchedules(db, { sessionToken: t.memberToken, tripId: t.tripId });
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].title).toBe('성산일출봉');
    expect(result.schedules[0].id).toBeDefined();
  });

  test('다른 여행의 세션은 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    const { token } = await createSession(db, { role: 'member', tripId: 'other', memberId: 'x' });
    await expect(listSchedules(db, { sessionToken: token, tripId: t.tripId })).rejects.toThrow('FORBIDDEN');
  });

  test('세션이 없으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(listSchedules(db, { tripId: t.tripId })).rejects.toThrow('UNAUTHENTICATED');
  });
});

describe('addSchedule', () => {
  test('멤버 세션이면 createdBy에 memberId가 들어간다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().createdBy).toBe(t.m1);
    expect(snap.data().createdByRole).toBe('member');
    expect(snap.data().planId).toBe('default');
  });

  // 관리자 세션은 memberId가 null이다 (tripAuth.verifyAdminPin).
  test('관리자 세션이면 createdBy가 null이고 role이 admin', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t, { sessionToken: t.adminToken }));

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().createdBy).toBeNull();
    expect(snap.data().createdByRole).toBe('admin');
  });

  test('완료된 여행에서는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db, { status: 'completed' });
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t))).rejects.toThrow('TRIP_COMPLETED');
  });

  test('없는 plan이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(addSchedule(db, validEntry(t, { planId: 'nope' }))).rejects.toThrow('PLAN_NOT_FOUND');
  });

  test('제목이 비면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { title: '' }))).rejects.toThrow('TITLE_REQUIRED');
    await expect(addSchedule(db, validEntry(t, { title: '   ' }))).rejects.toThrow('TITLE_REQUIRED');
  });

  test('제목이 100자를 넘으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { title: 'ㄱ'.repeat(101) }))).rejects.toThrow('TITLE_REQUIRED');
  });

  test('세부가 500자를 넘으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { detail: 'ㄱ'.repeat(501) })),
    ).rejects.toThrow('SCHEDULE_TEXT_TOO_LONG');
  });

  test('없는 카테고리면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { category: '없음' }))).rejects.toThrow('INVALID_CATEGORY');
  });

  test('날짜 형식이 틀리면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(addSchedule(db, validEntry(t, { date: '2026/08/02' }))).rejects.toThrow('INVALID_SCHEDULE_DATE');
  });

  test('끝 시간이 시작 시간보다 뒤가 아니면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { startMin: 660, endMin: 660 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
    await expect(
      addSchedule(db, validEntry(t, { startMin: 660, endMin: 600 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  test('시간이 0-1440 범위를 벗어나면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { startMin: -1, endMin: 600 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
    await expect(
      addSchedule(db, validEntry(t, { startMin: 600, endMin: 1441 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  test('한쪽만 null이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { startMin: 660, endMin: null })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  // 날짜 없는 시간은 어느 날의 11시인지 알 수 없어 의미가 없다.
  test('날짜가 null인데 시간이 있으면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { date: null, startMin: 660, endMin: 780 })),
    ).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  test('날짜도 시간도 null이면 통과한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(
      db, validEntry(t, { date: null, startMin: null, endMin: null }),
    );
    expect(scheduleId).toBeDefined();
  });

  test('날짜만 있고 시간이 null이면 통과한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(
      db, validEntry(t, { startMin: null, endMin: null }),
    );
    expect(scheduleId).toBeDefined();
  });

  test('실재하지 않는 참여자는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    await expect(
      addSchedule(db, validEntry(t, { participants: [t.m1, 'nope'] })),
    ).rejects.toThrow('INVALID_PARTICIPANTS');
  });

  test('참여자 중복을 제거해 저장한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t, { participants: [t.m1, t.m1, t.m2] }));
    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().participants).toEqual([t.m1, t.m2]);
  });
});

describe('updateSchedule', () => {
  test('남이 만든 일정도 수정할 수 있다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    // m1(memberToken)이 만들고
    const { scheduleId } = await addSchedule(db, validEntry(t));
    // m2가 수정한다
    const other = await createSession(db, { role: 'member', tripId: t.tripId, memberId: t.m2 });

    await updateSchedule(db, {
      sessionToken: other.token, tripId: t.tripId, scheduleId, patch: { title: '우도' },
    });

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().title).toBe('우도');
    expect(snap.data().updatedBy).toBe(t.m2);
    expect(snap.data().updatedByRole).toBe('member');
  });

  test('patch에 없는 필드는 건드리지 않는다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));

    await updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { title: '우도' },
    });

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().detail).toBe('입장료 5천원');
    expect(snap.data().startMin).toBe(660);
  });

  test('patch도 검증한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { category: '없음' },
    })).rejects.toThrow('INVALID_CATEGORY');

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { startMin: 700, endMin: 600 },
    })).rejects.toThrow('INVALID_SCHEDULE_TIME');
  });

  // 시간만 한쪽 넣으면 저장된 다른 쪽과 맞춰서 검증해야 한다.
  test('시간을 한쪽만 patch하면 기존 값과 함께 검증한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t)); // 660-780

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { endMin: 600 },
    })).rejects.toThrow('INVALID_SCHEDULE_TIME');

    await updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { endMin: 900 },
    });
    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.data().endMin).toBe(900);
  });

  test('완료된 여행에서는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));
    await db.collection('trips').doc(t.tripId).update({ status: 'completed' });

    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId, patch: { title: '우도' },
    })).rejects.toThrow('TRIP_COMPLETED');
  });

  test('없는 일정이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(updateSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId: 'nope', patch: { title: 'x' },
    })).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });
});

describe('deleteSchedule', () => {
  test('남이 만든 일정도 삭제할 수 있다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));
    const other = await createSession(db, { role: 'member', tripId: t.tripId, memberId: t.m2 });

    await deleteSchedule(db, { sessionToken: other.token, tripId: t.tripId, scheduleId });

    const snap = await db.collection('trips').doc(t.tripId)
      .collection('schedules').doc(scheduleId).get();
    expect(snap.exists).toBe(false);
  });

  test('완료된 여행에서는 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await withPlan(db, t);
    const { scheduleId } = await addSchedule(db, validEntry(t));
    await db.collection('trips').doc(t.tripId).update({ status: 'completed' });

    await expect(deleteSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId,
    })).rejects.toThrow('TRIP_COMPLETED');
  });

  test('없는 일정이면 거부한다', async () => {
    const db = new FakeFirestore();
    const t = await setup(db);
    await expect(deleteSchedule(db, {
      sessionToken: t.memberToken, tripId: t.tripId, scheduleId: 'nope',
    })).rejects.toThrow('SCHEDULE_NOT_FOUND');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `cd functions && npm test -- schedules`
Expected: FAIL — `Cannot find module '../../src/functions/schedules'`

- [ ] **Step 3: 최소 구현을 작성한다**

`functions/src/functions/schedules.js`:

```js
const { requireSession } = require('../lib/sessions');
const { requireTripEditable } = require('../lib/tripStatus');
const { CATEGORIES } = require('../lib/categories');
const { assertMemberIdsExist } = require('../lib/memberIds');

const DEFAULT_PLAN_ID = 'default';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 100;
const MAX_DETAIL = 500;
const MAX_PLACE = 200;
const MAX_MIN = 1440;

function schedulesRef(db, tripId) {
  return db.collection('trips').doc(tripId).collection('schedules');
}

function plansRef(db, tripId) {
  return db.collection('trips').doc(tripId).collection('plans');
}

/**
 * 기본 안을 읽어보고 없을 때만 만든다.
 *
 * set(..., { merge: true })를 쓰지 않는 이유: merge는 넘기지 않은 필드만
 * 보존하고 넘긴 필드는 덮어쓴다. listSchedules가 매번 호출되므로 탭을 열
 * 때마다 createdAt이 갱신되고, 나중에 안 이름을 바꿔도 '1안'으로 되돌아간다.
 *
 * 남는 경합(둘이 동시에 !exists를 보는 경우)은 문서 ID가 고정이라 중복
 * 문서를 만들지 않고 createdAt만 밀리초 단위로 달라진다 — 무해하다.
 *
 * 여행 상태와 무관하게 동작한다. 사용자가 쓴 내용이 아니라 내부 컨테이너다.
 */
async function ensureDefaultPlan(db, tripId, session) {
  const ref = plansRef(db, tripId).doc(DEFAULT_PLAN_ID);
  const snap = await ref.get();
  if (snap.exists) return;

  const now = Date.now();
  await ref.set({
    name: '1안',
    isActive: true,
    createdBy: session.memberId || null,
    createdByRole: session.role,
    createdAt: now,
    updatedAt: now,
  });
}

function validateText(value, max) {
  const s = String(value ?? '');
  if (s.length > max) throw new Error('SCHEDULE_TEXT_TOO_LONG');
  return s;
}

function validateTitle(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > MAX_TITLE) throw new Error('TITLE_REQUIRED');
  return s;
}

function validateDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw new Error('INVALID_SCHEDULE_DATE');
  return value;
}

/**
 * startMin/endMin은 둘 다 null이거나 둘 다 유효한 분이어야 한다.
 * 날짜가 없는데 시간만 있으면 어느 날의 11시인지 알 수 없으므로 거부한다.
 */
function validateTimes(date, startMin, endMin) {
  const bothNull = (startMin === null || startMin === undefined)
    && (endMin === null || endMin === undefined);
  if (bothNull) return { startMin: null, endMin: null };

  if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) {
    throw new Error('INVALID_SCHEDULE_TIME');
  }
  if (startMin < 0 || endMin > MAX_MIN || endMin <= startMin) {
    throw new Error('INVALID_SCHEDULE_TIME');
  }
  if (!date) throw new Error('INVALID_SCHEDULE_TIME');

  return { startMin, endMin };
}

function validateCategory(value) {
  if (!CATEGORIES.includes(value)) throw new Error('INVALID_CATEGORY');
  return value;
}

async function validateParticipants(db, tripId, participants) {
  if (!Array.isArray(participants)) throw new Error('INVALID_PARTICIPANTS');
  const unique = [...new Set(participants)];
  await assertMemberIdsExist(db, tripId, unique, 'INVALID_PARTICIPANTS');
  return unique;
}

async function assertPlanExists(db, tripId, planId) {
  const snap = await plansRef(db, tripId).doc(planId).get();
  if (!snap.exists) throw new Error('PLAN_NOT_FOUND');
}

async function listSchedules(db, data) {
  const session = await requireSession(db, data.sessionToken, ['admin', 'member'], data.tripId);
  await ensureDefaultPlan(db, data.tripId, session);

  const [planSnap, scheduleSnap] = await Promise.all([
    plansRef(db, data.tripId).get(),
    schedulesRef(db, data.tripId).get(),
  ]);

  return {
    plans: planSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    schedules: scheduleSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

async function addSchedule(db, data) {
  const { sessionToken, tripId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const planId = data.planId || DEFAULT_PLAN_ID;
  await assertPlanExists(db, tripId, planId);

  const title = validateTitle(data.title);
  const detail = validateText(data.detail, MAX_DETAIL);
  const placeName = validateText(data.placeName, MAX_PLACE);
  const category = validateCategory(data.category);
  const date = validateDate(data.date);
  const { startMin, endMin } = validateTimes(date, data.startMin, data.endMin);
  const participants = await validateParticipants(db, tripId, data.participants || []);

  const now = Date.now();
  const ref = await schedulesRef(db, tripId).add({
    planId,
    title,
    detail,
    category,
    placeName,
    date,
    startMin,
    endMin,
    participants,
    createdBy: session.memberId || null,
    createdByRole: session.role,
    updatedBy: session.memberId || null,
    updatedByRole: session.role,
    createdAt: now,
    updatedAt: now,
  });

  return { scheduleId: ref.id };
}

async function updateSchedule(db, data) {
  const { sessionToken, tripId, scheduleId } = data;
  const session = await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const ref = schedulesRef(db, tripId).doc(scheduleId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('SCHEDULE_NOT_FOUND');
  const current = snap.data();

  // 경비와 달리 소유자 제한이 없다. 일정은 공동 작업물이다.
  const patch = data.patch || {};
  const update = {};

  if ('title' in patch) update.title = validateTitle(patch.title);
  if ('detail' in patch) update.detail = validateText(patch.detail, MAX_DETAIL);
  if ('placeName' in patch) update.placeName = validateText(patch.placeName, MAX_PLACE);
  if ('category' in patch) update.category = validateCategory(patch.category);

  // 날짜와 시간은 서로 얽혀 있어서 patch에 없는 쪽은 저장된 값을 끌어와
  // 함께 검증한다. 끝 시간만 당겨 시작 시간보다 앞서게 만드는 걸 막는다.
  const nextDate = 'date' in patch ? validateDate(patch.date) : (current.date ?? null);
  const nextStart = 'startMin' in patch ? patch.startMin : (current.startMin ?? null);
  const nextEnd = 'endMin' in patch ? patch.endMin : (current.endMin ?? null);
  const touchesTime = 'date' in patch || 'startMin' in patch || 'endMin' in patch;

  if (touchesTime) {
    const times = validateTimes(nextDate, nextStart, nextEnd);
    update.date = nextDate;
    update.startMin = times.startMin;
    update.endMin = times.endMin;
  }

  if ('participants' in patch) {
    update.participants = await validateParticipants(db, tripId, patch.participants);
  }

  update.updatedBy = session.memberId || null;
  update.updatedByRole = session.role;
  update.updatedAt = Date.now();

  await ref.update(update);
  return { ok: true };
}

async function deleteSchedule(db, data) {
  const { sessionToken, tripId, scheduleId } = data;
  await requireSession(db, sessionToken, ['admin', 'member'], tripId);
  await requireTripEditable(db, tripId);

  const ref = schedulesRef(db, tripId).doc(scheduleId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('SCHEDULE_NOT_FOUND');

  await ref.delete();
  return { ok: true };
}

module.exports = {
  listSchedules, addSchedule, updateSchedule, deleteSchedule, DEFAULT_PLAN_ID,
};
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `cd functions && npm test -- schedules`
Expected: PASS (전부)

- [ ] **Step 5: `functions/index.js`에 콜러블을 등록한다**

require 블록에 추가:

```js
const schedules = require('./src/functions/schedules');
```

`exports.getReportData` 줄 아래에 추가:

```js
exports.listSchedules = onCall(wrap(schedules.listSchedules));
exports.addSchedule = onCall(wrap(schedules.addSchedule));
exports.updateSchedule = onCall(wrap(schedules.updateSchedule));
exports.deleteSchedule = onCall(wrap(schedules.deleteSchedule));
```

- [ ] **Step 6: 백엔드 전체 테스트를 돌린다**

Run: `cd functions && npm test`
Expected: PASS — 전부

- [ ] **Step 7: 커밋한다**

```bash
git add functions/src/functions/schedules.js functions/test/functions/schedules.test.js functions/index.js
git commit -m "feat(functions): schedule CRUD callables with lazy default plan"
```

---

## Task 6: 에러 문구와 등록/수정 모달

**Files:**
- Modify: `public/errorMessages.js`
- Create: `public/views/scheduleForm.js`
- Test: `public/test/errorMessages` 없음 — 기존 파일에 상수만 추가하므로 별도 테스트 없음

**Interfaces:**
- Consumes: `mapLinkFor`, `minToLabel`, `labelToMin` (Task 1)
- Produces:
  - `openScheduleForm({ tripId, members, schedule, defaultDate, onSaved })` — `schedule`이 `null`이면 등록, 있으면 수정. `members`는 `[{ id, name }]`. `onSaved`는 저장·삭제 성공 후 호출되는 콜백(인자 없음).

- [ ] **Step 1: 에러 문구를 추가한다**

`public/errorMessages.js`의 `MESSAGES`에서 `ENTERED_BY_REQUIRED` 줄 아래에 추가:

```js
  TITLE_REQUIRED: '일정 내용을 입력해주세요. (100자 이내)',
  SCHEDULE_TEXT_TOO_LONG: '입력이 너무 깁니다.',
  INVALID_SCHEDULE_DATE: '날짜가 올바르지 않습니다.',
  INVALID_SCHEDULE_TIME: '시간이 올바르지 않습니다. 끝 시간은 시작 시간보다 뒤여야 합니다.',
  INVALID_PARTICIPANTS: '참여자 선택이 올바르지 않습니다.',
  PLAN_NOT_FOUND: '일정 안을 찾을 수 없습니다.',
  SCHEDULE_NOT_FOUND: '일정을 찾을 수 없습니다.',
```

- [ ] **Step 2: 문구가 빠짐없이 들어갔는지 확인한다**

Run:

```bash
node -e "import('./public/errorMessages.js').then(({MESSAGES}) => {
  const need = ['TITLE_REQUIRED','SCHEDULE_TEXT_TOO_LONG','INVALID_SCHEDULE_DATE','INVALID_SCHEDULE_TIME','INVALID_PARTICIPANTS','PLAN_NOT_FOUND','SCHEDULE_NOT_FOUND'];
  const missing = need.filter((k) => !MESSAGES[k]);
  console.log(missing.length ? 'MISSING: ' + missing : 'OK');
})"
```

Expected: `OK`

- [ ] **Step 3: 모달을 구현한다**

`public/views/scheduleForm.js`:

```js
import { callFunction } from '../api.js';
import { openModal, closeModal, showToast, renderChipGroup, escapeHtml } from '../ui.js';
import { CATEGORIES, categoryMark } from '../categories.js';
import { minToLabel, labelToMin, mapLinkFor } from '../scheduleLayout.js';

/**
 * 일정 등록/수정 모달.
 *
 * schedule === null 이면 등록, 객체면 수정. 참여자는 등록 시 전원 체크가
 * 기본이다 — 빈 배열을 "전원"의 뜻으로 쓰지 않고 항상 명시적으로 저장한다.
 */
function openScheduleForm({ tripId, members, schedule, defaultDate, onSaved }) {
  const isEdit = !!schedule;
  let category = isEdit ? schedule.category : CATEGORIES[1];
  const selected = new Set(
    isEdit ? (schedule.participants || []) : members.map((m) => m.id),
  );

  const noDate = isEdit && !schedule.date;
  const noTime = isEdit && schedule.startMin === null;

  openModal(isEdit ? '일정 수정' : '일정 추가', `
    <div class="field"><label class="label">카테고리</label><div id="sf-category"></div></div>
    <div class="field">
      <label class="label">날짜</label>
      <input type="date" class="input" id="sf-date"
             value="${escapeHtml(isEdit ? (schedule.date || '') : (defaultDate || ''))}"
             ${noDate ? 'disabled' : ''}>
      <label class="check-inline">
        <input type="checkbox" id="sf-nodate" ${noDate ? 'checked' : ''}> 날짜 미정
      </label>
    </div>
    <div class="field">
      <label class="label">시간</label>
      <div class="sf-time-row">
        <input type="time" step="900" class="input" id="sf-start"
               value="${escapeHtml(isEdit ? minToLabel(schedule.startMin) : '')}" ${noTime ? 'disabled' : ''}>
        <span class="muted">–</span>
        <input type="time" step="900" class="input" id="sf-end"
               value="${escapeHtml(isEdit ? minToLabel(schedule.endMin) : '')}" ${noTime ? 'disabled' : ''}>
      </div>
      <label class="check-inline">
        <input type="checkbox" id="sf-notime" ${noTime ? 'checked' : ''}> 시간 미정
      </label>
    </div>
    <div class="field"><label class="label">내용</label>
      <input class="input" id="sf-title" value="${escapeHtml(isEdit ? schedule.title : '')}"></div>
    <div class="field"><label class="label">세부</label>
      <input class="input" id="sf-detail" value="${escapeHtml(isEdit ? (schedule.detail || '') : '')}"></div>
    <div class="field"><label class="label">위치</label>
      <input class="input" id="sf-place" placeholder="장소명 또는 지도 링크"
             value="${escapeHtml(isEdit ? (schedule.placeName || '') : '')}">
      <div id="sf-place-link" class="muted" style="font-size:12px;margin-top:0.3rem"></div>
    </div>
    <div class="field"><label class="label">참여자</label><div id="sf-participants"></div></div>
    <button type="button" class="btn btn-primary btn-block" id="sf-submit">저장</button>
    ${isEdit ? '<button type="button" class="btn btn-secondary btn-block" id="sf-delete" style="margin-top:0.5rem">삭제</button>' : ''}
    <p class="muted" id="sf-error" style="margin-top:0.5rem;font-size:13px"></p>
    ${isEdit ? `<p class="muted" style="margin-top:0.5rem;font-size:12px">마지막 수정: ${escapeHtml(lastEditorName(schedule, members))}</p>` : ''}
  `);

  function rerenderCategory() {
    renderChipGroup(document.getElementById('sf-category'), CATEGORIES, category, (c) => {
      category = c;
      rerenderCategory();
    }, { dotColor: categoryMark });
  }
  rerenderCategory();

  function renderParticipants() {
    const all = members.length > 0 && members.every((m) => selected.has(m.id));
    document.getElementById('sf-participants').innerHTML = `
      <label class="check-inline"><input type="checkbox" id="sf-all" ${all ? 'checked' : ''}> <strong>전체</strong></label>
      ${members.map((m) => `
        <label class="check-inline">
          <input type="checkbox" class="sf-p" data-id="${escapeHtml(m.id)}" ${selected.has(m.id) ? 'checked' : ''}>
          ${escapeHtml(m.name)}
        </label>`).join('')}`;

    document.getElementById('sf-all').addEventListener('change', (ev) => {
      selected.clear();
      if (ev.target.checked) members.forEach((m) => selected.add(m.id));
      renderParticipants();
    });
    document.querySelectorAll('.sf-p').forEach((box) => {
      box.addEventListener('change', () => {
        if (box.checked) selected.add(box.dataset.id);
        else selected.delete(box.dataset.id);
        renderParticipants();
      });
    });
  }
  renderParticipants();

  function refreshPlaceLink() {
    const link = mapLinkFor(document.getElementById('sf-place').value);
    document.getElementById('sf-place-link').innerHTML = link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">카카오맵에서 열기 ↗</a>`
      : '';
  }
  document.getElementById('sf-place').addEventListener('input', refreshPlaceLink);
  refreshPlaceLink();

  document.getElementById('sf-nodate').addEventListener('change', (ev) => {
    document.getElementById('sf-date').disabled = ev.target.checked;
    // 날짜가 없으면 시간도 있을 수 없다 (백엔드가 거부한다).
    if (ev.target.checked) {
      const notime = document.getElementById('sf-notime');
      notime.checked = true;
      notime.dispatchEvent(new Event('change'));
    }
  });

  document.getElementById('sf-notime').addEventListener('change', (ev) => {
    document.getElementById('sf-start').disabled = ev.target.checked;
    document.getElementById('sf-end').disabled = ev.target.checked;
  });

  document.getElementById('sf-submit').addEventListener('click', async () => {
    const btn = document.getElementById('sf-submit');
    const err = document.getElementById('sf-error');
    btn.disabled = true; btn.textContent = '저장 중...';

    const dateOff = document.getElementById('sf-nodate').checked;
    const timeOff = document.getElementById('sf-notime').checked;
    const payload = {
      tripId,
      planId: 'default',
      title: document.getElementById('sf-title').value,
      detail: document.getElementById('sf-detail').value,
      placeName: document.getElementById('sf-place').value,
      category,
      date: dateOff ? null : (document.getElementById('sf-date').value || null),
      startMin: timeOff ? null : labelToMin(document.getElementById('sf-start').value),
      endMin: timeOff ? null : labelToMin(document.getElementById('sf-end').value),
      participants: [...selected],
    };

    try {
      if (isEdit) {
        const { tripId: _t, planId: _p, ...patch } = payload;
        await callFunction('updateSchedule', { tripId, scheduleId: schedule.id, patch });
      } else {
        await callFunction('addSchedule', payload);
      }
      closeModal();
      onSaved();
    } catch (e) {
      btn.disabled = false; btn.textContent = '저장';
      err.textContent = e.message;
    }
  });

  if (isEdit) {
    document.getElementById('sf-delete').addEventListener('click', async () => {
      if (!window.confirm(`'${schedule.title}' 일정을 삭제할까요?`)) return;
      const btn = document.getElementById('sf-delete');
      btn.disabled = true; btn.textContent = '삭제 중...';
      try {
        await callFunction('deleteSchedule', { tripId, scheduleId: schedule.id });
        closeModal();
        onSaved();
      } catch (e) {
        btn.disabled = false; btn.textContent = '삭제';
        showToast(e.message, 'error');
      }
    });
  }
}

function lastEditorName(schedule, members) {
  if (schedule.updatedByRole === 'admin') return '관리자';
  const found = members.find((m) => m.id === schedule.updatedBy);
  return found ? found.name : '알 수 없음';
}

export { openScheduleForm };
```

- [ ] **Step 4: 문법 오류가 없는지 확인한다**

Run: `node --check public/views/scheduleForm.js`
Expected: 출력 없음 (통과). ES 모듈 문법이라 `--check`가 거부하면 `node --input-type=module --check` 대신 다음을 쓴다:

```bash
node -e "import('./public/views/scheduleForm.js').then(() => console.log('OK')).catch((e) => { console.error(e.message); process.exit(1); })"
```

`document is not defined`가 아니라 `SyntaxError`가 나면 실패다. 이 파일은 모듈 최상위에서 DOM을 건드리지 않으므로 import 자체는 성공해야 한다.

- [ ] **Step 5: 커밋한다**

```bash
git add public/errorMessages.js public/views/scheduleForm.js
git commit -m "feat(frontend): schedule entry form modal with participant checklist"
```

---

## Task 7: 타임테이블 뷰 3종과 목록 뷰

**Files:**
- Create: `public/views/scheduleTimetable.js`
- Create: `public/views/scheduleList.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `assignLanes`, `timeRangeFor`, `minToLabel`, `mapLinkFor`, `PX_PER_MIN` (Task 1~3), `categorySlug`/`categoryMark`/`categoryTag` (`../categories.js`)
- Produces:
  - `renderTimetable(grouped, ctx) => string` — `ctx = { view: 'week'|'day'|'flow', activeDate, members }`
  - `renderList(grouped, ctx) => string`
  - 두 함수 모두 **순수 문자열 함수**다. DOM 접근도 이벤트 바인딩도 하지 않는다 — Task 8의 셸이 담당한다.
  - 블록/카드에는 `data-schedule-id` 속성이 붙는다. 셸이 이걸로 클릭을 잡는다.

- [ ] **Step 1: 타임테이블을 구현한다**

`public/views/scheduleTimetable.js`:

```js
import { escapeHtml } from '../ui.js';
import { categorySlug } from '../categories.js';
import { assignLanes, timeRangeFor, minToLabel, PX_PER_MIN } from '../scheduleLayout.js';

const HOUR_PX = 60 * PX_PER_MIN;

function participantLabel(entry, members) {
  // 저장된 participants에 삭제된 구성원의 ID가 남아 있을 수 있다.
  // 데이터는 고치지 않고 표시할 때만 걸러낸다.
  const alive = (entry.participants || []).filter((id) => members.some((m) => m.id === id));
  if (members.length > 0 && alive.length === members.length) return '전원';
  return `${alive.length}명`;
}

/**
 * 블록 하나. 높이에 따라 담는 줄 수를 달리한다 — 30분짜리 블록에 세 줄을
 * 넣으면 전부 잘린다.
 */
function renderBlock(entry, lane, laneCount, fromMin, members) {
  const top = (entry.startMin - fromMin) * PX_PER_MIN;
  const height = (entry.endMin - entry.startMin) * PX_PER_MIN;
  const width = 100 / laneCount;
  const left = lane * width;
  const mins = entry.endMin - entry.startMin;

  const lines = [`<span class="tt-title">${escapeHtml(entry.title)}</span>`];
  if (mins > 30 && entry.placeName) {
    lines.push(`<span class="tt-place">📍 ${escapeHtml(entry.placeName)}</span>`);
  }
  if (mins > 60) {
    lines.push(`<span class="tt-people">👥 ${escapeHtml(participantLabel(entry, members))}</span>`);
  }

  return `<button type="button" class="tt-block" data-schedule-id="${escapeHtml(entry.id)}"
    data-cat="${categorySlug(entry.category)}"
    style="top:${top}px;height:${height}px;left:${left}%;width:calc(${width}% - 2px)">
    ${lines.join('')}
  </button>`;
}

function renderUntimedStrip(entries) {
  if (entries.length === 0) return '<div class="tt-untimed"></div>';
  return `<div class="tt-untimed">${entries.map((e) => `
    <button type="button" class="tt-chip" data-schedule-id="${escapeHtml(e.id)}"
      data-cat="${categorySlug(e.category)}">${escapeHtml(e.title)}</button>`).join('')}</div>`;
}

/** 하루치 시간축 컬럼. 세 뷰 전부가 이 함수 하나를 쓴다. */
function renderDayColumn(bucket, fromMin, toMin, members) {
  const height = (toMin - fromMin) * PX_PER_MIN;
  const placed = assignLanes(bucket.timed);
  return `<div class="tt-col" style="height:${height}px">
    ${placed.map((p) => renderBlock(p.entry, p.lane, p.laneCount, fromMin, members)).join('')}
  </div>`;
}

// The loop bound is exclusive of toMin on purpose. Each band is HOUR_PX tall
// and labelled with the hour it *starts*, so an axis of 08:00-22:00 needs 14
// bands (08:00 through 21:00), not 15. An inclusive bound would make the
// gutter one band taller than renderDayColumn's explicit column height, and
// flex cannot stretch a column that already has an explicit height — the
// columns would end 48px short of a trailing, orphaned hour label.
function renderGutter(fromMin, toMin) {
  const rows = [];
  for (let m = fromMin; m < toMin; m += 60) {
    rows.push(`<div class="tt-hour" style="height:${HOUR_PX}px">${minToLabel(m)}</div>`);
  }
  return `<div class="tt-gutter">${rows.join('')}</div>`;
}

function dayLabel(date) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date(`${date}T00:00:00Z`);
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${md} (${days[d.getUTCDay()]})`;
}

function renderFloating(floating) {
  if (floating.length === 0) return '';
  return `<div class="tt-floating">
    <span class="label">미정</span>
    ${floating.map((e) => `<button type="button" class="tt-chip" data-schedule-id="${escapeHtml(e.id)}"
      data-cat="${categorySlug(e.category)}">${escapeHtml(e.title)}</button>`).join('')}
  </div>`;
}

function renderTimetable(grouped, ctx) {
  const { dates, byDate, floating } = grouped;
  const { view, activeDate, members } = ctx;

  if (dates.length === 0 && floating.length === 0) {
    return '<p class="muted">아직 등록된 일정이 없습니다.</p>';
  }

  const all = dates.flatMap((d) => byDate[d].timed);
  const { fromMin, toMin } = timeRangeFor(all);

  if (view === 'week') {
    return `${renderFloating(floating)}
      <div class="tt-week">
        <div class="tt-week-head"><div class="tt-gutter-head"></div>
          ${dates.map((d) => `<div class="tt-day-head">${escapeHtml(dayLabel(d))}</div>`).join('')}
        </div>
        <div class="tt-week-untimed"><div class="tt-gutter-head"></div>
          ${dates.map((d) => renderUntimedStrip(byDate[d].untimed)).join('')}
        </div>
        <div class="tt-week-body">
          ${renderGutter(fromMin, toMin)}
          ${dates.map((d) => renderDayColumn(byDate[d], fromMin, toMin, members)).join('')}
        </div>
      </div>`;
  }

  if (view === 'day') {
    const date = dates.includes(activeDate) ? activeDate : dates[0];
    if (!date) return `${renderFloating(floating)}<p class="muted">날짜가 있는 일정이 없습니다.</p>`;
    return `${renderFloating(floating)}
      <div class="tt-daytabs">
        ${dates.map((d) => `<button type="button" class="tt-daytab${d === date ? ' active' : ''}"
          data-date="${escapeHtml(d)}">${escapeHtml(dayLabel(d))}</button>`).join('')}
      </div>
      ${renderUntimedStrip(byDate[date].untimed)}
      <div class="tt-single">
        ${renderGutter(fromMin, toMin)}
        ${renderDayColumn(byDate[date], fromMin, toMin, members)}
      </div>`;
  }

  // view === 'flow'
  return `${renderFloating(floating)}
    ${dates.map((d) => `
      <div class="tt-flow-day">
        <div class="tt-flow-head">${escapeHtml(dayLabel(d))}</div>
        ${renderUntimedStrip(byDate[d].untimed)}
        <div class="tt-single">
          ${renderGutter(fromMin, toMin)}
          ${renderDayColumn(byDate[d], fromMin, toMin, members)}
        </div>
      </div>`).join('')}`;
}

export { renderTimetable, dayLabel, participantLabel };
```

- [ ] **Step 2: 목록 뷰를 구현한다**

`public/views/scheduleList.js`:

```js
import { escapeHtml } from '../ui.js';
import { categoryTag } from '../categories.js';
import { minToLabel } from '../scheduleLayout.js';
import { dayLabel, participantLabel } from './scheduleTimetable.js';

function renderRow(entry, members) {
  const time = entry.startMin === null
    ? '<span class="muted">시간 미정</span>'
    : `${minToLabel(entry.startMin)}–${minToLabel(entry.endMin)}`;

  return `<button type="button" class="sl-row" data-schedule-id="${escapeHtml(entry.id)}">
    <span class="sl-time">${time}</span>
    <span class="sl-main">
      ${categoryTag(entry.category)}
      <strong>${escapeHtml(entry.title)}</strong>
      ${entry.placeName ? `<span class="muted sl-place">📍 ${escapeHtml(entry.placeName)}</span>` : ''}
    </span>
    <span class="muted sl-people">👥 ${escapeHtml(participantLabel(entry, members))}</span>
  </button>`;
}

function renderList(grouped, ctx) {
  const { dates, byDate, floating } = grouped;
  const { members } = ctx;

  if (dates.length === 0 && floating.length === 0) {
    return '<p class="muted">아직 등록된 일정이 없습니다.</p>';
  }

  const sections = [];

  if (floating.length > 0) {
    sections.push(`<div class="sl-group">
      <div class="sl-group-head">미정</div>
      ${floating.map((e) => renderRow(e, members)).join('')}
    </div>`);
  }

  for (const d of dates) {
    const rows = [...byDate[d].timed, ...byDate[d].untimed];
    if (rows.length === 0) continue;
    sections.push(`<div class="sl-group">
      <div class="sl-group-head">${escapeHtml(dayLabel(d))}</div>
      ${rows.map((e) => renderRow(e, members)).join('')}
    </div>`);
  }

  if (sections.length === 0) return '<p class="muted">아직 등록된 일정이 없습니다.</p>';
  return sections.join('');
}

export { renderList };
```

- [ ] **Step 3: 스타일을 추가한다**

`public/style.css` 맨 아래에 추가:

```css
/* ---- 일정 타임테이블 ---- */
.tt-week { overflow-x: auto; }
.tt-week-head, .tt-week-untimed, .tt-week-body { display: flex; min-width: min-content; }
.tt-gutter-head { flex: 0 0 44px; }
.tt-day-head {
  flex: 1 0 72px; text-align: center; font-size: 12px; font-weight: 600;
  padding: 0.4rem 0; border-bottom: 1px solid #e5e3dd;
}
.tt-week-body .tt-col { flex: 1 0 72px; }
.tt-week-untimed .tt-untimed { flex: 1 0 72px; }

.tt-gutter { flex: 0 0 44px; }
.tt-hour {
  font-size: 11px; color: #8a857c; text-align: right; padding-right: 4px;
  border-top: 1px solid #eeece6; box-sizing: border-box;
}
.tt-col {
  position: relative; flex: 1; border-left: 1px solid #eeece6;
  background-image: repeating-linear-gradient(
    to bottom, #f5f3ee 0 1px, transparent 1px 48px);
}
.tt-single { display: flex; }

.tt-block {
  position: absolute; overflow: hidden; text-align: left; cursor: pointer;
  border: 0; border-left: 3px solid var(--cat, #999); border-radius: 3px;
  background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.12);
  padding: 2px 4px; font: inherit; font-size: 11px; line-height: 1.25;
  display: flex; flex-direction: column; gap: 1px; min-height: 14px;
}
.tt-title { font-weight: 600; }
.tt-place, .tt-people { color: #6b665e; font-size: 10px; }

.tt-untimed { min-height: 22px; display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; }
.tt-chip {
  border: 0; border-left: 3px solid var(--cat, #999); border-radius: 3px;
  background: #f0eee8; font: inherit; font-size: 11px; padding: 2px 6px; cursor: pointer;
}
.tt-floating {
  display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
  padding: 0.4rem 0; margin-bottom: 0.5rem; border-bottom: 1px dashed #ddd9d0;
}

.tt-daytabs { display: flex; gap: 0.3rem; overflow-x: auto; margin-bottom: 0.5rem; }
.tt-daytab {
  border: 1px solid #ddd9d0; background: #fff; border-radius: 999px;
  padding: 0.25rem 0.7rem; font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer;
}
.tt-daytab.active { background: #2a2723; color: #fff; border-color: #2a2723; }

.tt-flow-day { margin-bottom: 1.2rem; }
.tt-flow-head {
  position: sticky; top: 0; z-index: 2; background: #fafaf8;
  font-weight: 600; font-size: 13px; padding: 0.3rem 0; border-bottom: 1px solid #e5e3dd;
}

/* ---- 일정 목록 ---- */
.sl-group { margin-bottom: 1rem; }
.sl-group-head { font-weight: 600; font-size: 13px; margin-bottom: 0.3rem; }
.sl-row {
  display: flex; align-items: center; gap: 0.5rem; width: 100%;
  border: 0; border-bottom: 1px solid #eeece6; background: none;
  padding: 0.5rem 0.2rem; font: inherit; text-align: left; cursor: pointer;
}
.sl-row:hover { background: #f5f3ee; }
.sl-time { flex: 0 0 90px; font-size: 12px; color: #6b665e; }
.sl-main { flex: 1; min-width: 0; }
.sl-place { font-size: 12px; margin-left: 0.4rem; }
.sl-people { flex: 0 0 auto; font-size: 12px; }

/* ---- 일정 탭 셸 ---- */
.sched-bar {
  display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.8rem;
}
.sched-seg { display: flex; border: 1px solid #ddd9d0; border-radius: 6px; overflow: hidden; }
.sched-seg button {
  border: 0; background: #fff; font: inherit; font-size: 12px;
  padding: 0.3rem 0.6rem; cursor: pointer;
}
.sched-seg button.active { background: #2a2723; color: #fff; }
.check-inline {
  display: inline-flex; align-items: center; gap: 0.3rem;
  margin-right: 0.7rem; font-size: 14px;
}
.sf-time-row { display: flex; align-items: center; gap: 0.4rem; }
.sf-time-row .input { flex: 1; }
```

이어서 카테고리 색을 `--cat` 커스텀 프로퍼티로 정의한다. 위 규칙들이 `var(--cat)`로 블록의 왼쪽 테두리 색을 잡는다.

```css
[data-cat="lodging"]   { --cat: #2a78d6; }
[data-cat="food"]      { --cat: #eb6834; }
[data-cat="grocery"]   { --cat: #1baf7a; }
[data-cat="transport"] { --cat: #eda100; }
[data-cat="play"]      { --cat: #e87ba4; }
[data-cat="etc"]       { --cat: #4a3aa7; }
```

**기존 `.tag[data-cat=...]` 규칙(`style.css:116-121`)을 건드리지 않는다.** 그 규칙들은 `background`와 `color`를 잡고, 위 규칙은 `--cat`만 정의한다. 선택자가 겹쳐도 서로 다른 속성이라 충돌하지 않는다. 값은 `public/categories.js`의 `CATEGORY_META`와 일치시킨 것으로, 색각이상 검증(인접쌍 CVD ΔE 9.1)을 통과한 값이라 임의로 바꾸면 안 된다.

- [ ] **Step 4: 문법을 확인한다**

Run:

```bash
node -e "Promise.all([
  import('./public/views/scheduleTimetable.js'),
  import('./public/views/scheduleList.js'),
]).then(() => console.log('OK')).catch((e) => { console.error(e.message); process.exit(1); })"
```

Expected: `OK`

- [ ] **Step 5: 커밋한다**

```bash
git add public/views/scheduleTimetable.js public/views/scheduleList.js public/style.css
git commit -m "feat(frontend): schedule timetable (week/day/flow) and list renderers"
```

---

## Task 8: 탭 셸

**Files:**
- Create: `public/views/schedule.js`

**Interfaces:**
- Consumes: `renderTimetable` (Task 7), `renderList` (Task 7), `openScheduleForm` (Task 6), `groupByDate` (Task 3), `callFunction` (`../api.js`), `getSession` (`../session.js`)
- Produces:
  - `renderScheduleInto(body, slug) => Promise<void>` — Task 9의 멤버·관리자 뷰가 호출한다.

- [ ] **Step 1: 셸을 구현한다**

`public/views/schedule.js`:

```js
import { callFunction } from '../api.js';
import { getSession } from '../session.js';
import { escapeHtml, showToast } from '../ui.js';
import { groupByDate } from '../scheduleLayout.js';
import { renderTimetable } from './scheduleTimetable.js';
import { renderList } from './scheduleList.js';
import { openScheduleForm } from './scheduleForm.js';

const VIEW_KEY = 'tripsplit.scheduleView';
const VIEWS = [
  ['week', '주간'], ['day', '하루'], ['flow', '연속'], ['list', '목록'],
];

// 탭을 다시 그릴 때 진행 중이던 이전 로드의 응답이 늦게 도착해 덮어쓰는 것을
// 막는다. member.js의 renderToken과 같은 방식이다.
let renderToken = 0;
let activeDate = null;

function currentView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (VIEWS.some(([v]) => v === saved)) return saved;
  } catch {
    // localStorage가 막힌 브라우저(사파리 시크릿 등) — 기본값으로 간다
  }
  return 'week';
}

function setView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // 저장 실패는 기능을 막지 않는다
  }
}

async function renderScheduleInto(body, slug) {
  const myToken = ++renderToken;
  const session = getSession();

  body.innerHTML = `
    <div class="sched-bar">
      <div class="sched-seg" id="sched-views">
        ${VIEWS.map(([v, label]) => `<button type="button" data-view="${v}"
          class="${v === currentView() ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-secondary" id="sched-refresh">새로고침</button>
      <button type="button" class="btn btn-primary" id="sched-add">일정 추가</button>
    </div>
    <div id="sched-body"><p class="muted">불러오는 중...</p></div>`;

  body.querySelectorAll('#sched-views button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      renderScheduleInto(body, slug);
    });
  });
  body.querySelector('#sched-refresh').addEventListener('click', () => {
    renderScheduleInto(body, slug);
  });

  let data, members, trip;
  try {
    [data, members, trip] = await Promise.all([
      callFunction('listSchedules', { tripId: session.tripId }),
      callFunction('listMembers', { tripId: session.tripId }),
      callFunction('getTripSetup', { tripId: session.tripId }),
    ]);
  } catch (err) {
    if (myToken !== renderToken) return;
    // 구성원 목록을 못 받았으면 참여자 체크리스트를 그릴 수 없다. 눌러도
    // 아무 일이 없는 버튼을 남겨두는 대신 비활성화한다.
    body.querySelector('#sched-add').disabled = true;
    const target = body.querySelector('#sched-body');
    target.innerHTML = `<p class="muted">불러오지 못했습니다: ${escapeHtml(err.message)}</p>
      <button type="button" class="btn btn-secondary" id="sched-retry">다시 시도</button>`;
    target.querySelector('#sched-retry').addEventListener('click', () => renderScheduleInto(body, slug));
    return;
  }
  if (myToken !== renderToken) return;

  const grouped = groupByDate(data.schedules, trip.period);
  if (!activeDate || !grouped.dates.includes(activeDate)) {
    activeDate = grouped.dates[0] || null;
  }

  const view = currentView();
  const ctx = { view, activeDate, members };
  const target = body.querySelector('#sched-body');
  target.innerHTML = view === 'list' ? renderList(grouped, ctx) : renderTimetable(grouped, ctx);

  function reload() {
    renderScheduleInto(body, slug);
  }

  body.querySelector('#sched-add').addEventListener('click', () => {
    openScheduleForm({
      tripId: session.tripId,
      members,
      schedule: null,
      defaultDate: activeDate || trip.period?.start || '',
      onSaved: reload,
    });
  });

  target.querySelectorAll('[data-schedule-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const found = data.schedules.find((s) => s.id === el.dataset.scheduleId);
      if (!found) { showToast('일정을 찾을 수 없습니다.', 'error'); return; }
      openScheduleForm({
        tripId: session.tripId, members, schedule: found, defaultDate: null, onSaved: reload,
      });
    });
  });

  target.querySelectorAll('.tt-daytab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeDate = tab.dataset.date;
      renderScheduleInto(body, slug);
    });
  });
}

export { renderScheduleInto };
```

- [ ] **Step 2: 문법을 확인한다**

Run:

```bash
node -e "import('./public/views/schedule.js').then(() => console.log('OK')).catch((e) => { console.error(e.message); process.exit(1); })"
```

Expected: `OK`

- [ ] **Step 3: 커밋한다**

```bash
git add public/views/schedule.js
git commit -m "feat(frontend): schedule tab shell with view switcher and refresh"
```

---

## Task 9: 탭 배선, 서비스워커 범프, 수동 확인

**Files:**
- Modify: `public/views/member.js:29-35`, `:46-50`
- Modify: `public/views/admin.js:31-36` 및 탭 분기부
- Modify: `public/sw.js:5`

**Interfaces:**
- Consumes: `renderScheduleInto` (Task 8)
- Produces: 없음 (마지막 태스크)

- [ ] **Step 1: 멤버 뷰에 탭을 추가한다**

`public/views/member.js` 상단 import에 추가:

```js
import { renderScheduleInto } from './schedule.js';
```

탭 목록(29~33행)에서 `구성원` 버튼과 `리포트` 버튼 사이에 넣는다:

```html
<button type="button" class="tab ${currentTab === 'schedule' ? 'active' : ''}" data-tab="schedule">일정</button>
```

분기부(48~50행)를 다음으로 바꾼다:

```js
  if (currentTab === 'members') renderMembersTab(body, slug, myToken);
  else if (currentTab === 'schedule') renderScheduleInto(body, slug);
  else if (currentTab === 'report') renderReportInto(body, slug);
  else renderExpensesTab(body, slug, myToken);
```

- [ ] **Step 2: 관리자 뷰에 탭을 추가한다**

`public/views/admin.js` 상단 import에 추가:

```js
import { renderScheduleInto } from './schedule.js';
```

탭 목록에서 `경비확인` 버튼과 `리포트` 버튼 사이에 넣는다:

```html
<button type="button" class="tab ${currentTab === 'schedule' ? 'active' : ''}" data-tab="schedule">일정</button>
```

탭 분기부(`const body = root.querySelector('#admin-tab-body');` 아래)를 다음으로 바꾼다:

```js
  if (currentTab === 'setup') renderSetupTab(body, slug, myToken);
  else if (currentTab === 'members') renderMembersTab(body, slug, myToken);
  else if (currentTab === 'schedule') renderScheduleInto(body, slug);
  else if (currentTab === 'report') renderReportInto(body, slug);
  else renderExpensesTab(body, slug, myToken);
```

`else renderExpensesTab(...)`가 포괄 갈래이므로 `schedule` 분기는 반드시 그 앞에 와야 한다. 뒤에 두면 일정 탭에서 경비확인 화면이 나온다.

- [ ] **Step 3: 서비스워커 캐시를 범프한다**

`public/sw.js:5`:

```js
const CACHE_NAME = 'tripsplit-shell-v4';
```

`SHELL_ASSETS`는 바꾸지 않는다. fetch 핸들러가 동일 출처 GET을 전부 캐시하므로 뷰 모듈은 자동으로 잡힌다.

- [ ] **Step 4: 전체 테스트를 돌린다**

Run:

```bash
npm test
cd functions && npm test
```

Expected: 양쪽 다 PASS

- [ ] **Step 5: 에뮬레이터에서 눈으로 확인한다**

PowerShell에서 (Bash로는 firebase 배포/에뮬레이터 명령이 동작하지 않는다):

```powershell
firebase emulators:start
```

`http://localhost:5000`에서 여행에 로그인해 **일정** 탭을 열고 확인한다:

- [ ] 네 개의 뷰 버튼이 보이고, 누르면 화면이 바뀐다
- [ ] 뷰를 고른 뒤 새로고침해도 그 뷰가 유지된다 (localStorage)
- [ ] "일정 추가"로 시간이 있는 일정을 만들면 주간 뷰의 해당 날짜·시간 위치에 블록이 그려진다
- [ ] 같은 시간대에 하나 더 만들면 두 블록이 반씩 나뉜다
- [ ] "시간 미정"으로 만들면 타임테이블 위 스트립에 칩으로 뜬다
- [ ] "날짜 미정"으로 만들면 맨 위 미정 줄에 뜬다
- [ ] 블록을 누르면 수정 모달이 열리고, 값이 그대로 채워져 있다
- [ ] 참여자에서 "전체"를 끄면 전부 해제되고, 다시 켜면 전부 선택된다
- [ ] 위치에 `켄싱턴리조트평창`을 넣으면 아래에 카카오맵 링크가 뜬다
- [ ] 삭제 시 확인 창이 뜨고, 확인하면 사라진다
- [ ] 관리자 PIN으로 로그인해도 일정 탭이 보이고 등록이 된다
- [ ] 관리자가 만든 일정의 수정 모달에 `마지막 수정: 관리자`가 보인다
- [ ] 하루 뷰에서 날짜 탭을 누르면 그 날짜로 바뀐다
- [ ] 연속 뷰에서 스크롤하면 날짜 헤더가 상단에 붙는다
- [ ] 목록 뷰에 날짜별로 묶여 나온다
- [ ] 폰 크기(375px)로 줄여도 가로 스크롤이 페이지 전체가 아니라 주간 뷰 안에서만 생긴다

- [ ] **Step 6: 커밋한다**

```bash
git add public/views/member.js public/views/admin.js public/sw.js
git commit -m "feat(frontend): wire the schedule tab into member and admin views"
```

---

## 자체 검토 결과

**스펙 커버리지 확인** — 스펙의 각 절이 어느 태스크에 대응하는지:

| 스펙 | 태스크 |
|---|---|
| §1.1 `plans/default` 지연 생성, merge 금지 | Task 5 (`ensureDefaultPlan` + 보존 테스트) |
| §1.2 `schedules` 스키마, `createdBy` null | Task 5 |
| §1.3 날짜/시간 네 조합 | Task 5 (`validateTimes`) |
| §2 콜러블 4개, 권한 | Task 5 |
| §2.1 검증 규칙 표 | Task 5 |
| §2.2 `validateMemberIds` 추출 | Task 4 |
| §3.1 멤버·관리자 탭 | Task 9 |
| §3.2 네 뷰, 공통 `renderDayColumn`, 미정 영역 | Task 7 |
| §3.2 뷰 저장, 새로고침 | Task 8 |
| §3.3 등록/수정 모달, 참여자, 삭제 확인 | Task 6 |
| §4.1 `assignLanes` | Task 2 |
| §4.2 `timeRangeFor` | Task 3 |
| §4.3 `groupByDate` 합집합 | Task 3 |
| §4.4 `minToLabel`/`labelToMin` | Task 1 |
| §5 `CACHE_NAME` 범프 | Task 9 |
| §6 `mapLinkFor` | Task 1 |
| §7 테스트 | Task 1~5 |

**남은 간극 두 가지 — 의도한 것이다:**

1. **`renderTimetable`/`renderList`에 단위 테스트가 없다.** 스펙 §7이 "렌더링은 CSS와 DOM 배치라 단위 테스트 대상이 아니다. 에뮬레이터에서 육안 확인한다"고 명시했다. 실제로 틀리기 쉬운 계산은 전부 `scheduleLayout.js`에 있고 거기에 테스트가 있다. Task 9 Step 5의 체크리스트가 육안 확인을 대신한다.
2. **`isActive`로 분기하는 코드가 없다.** 스펙 §1.1이 "이번 범위에서 쓰이지 않는다. 기록만 해두고 분기하는 코드는 만들지 않는다"고 명시했다.

**구현자가 주의할 점:**

- Task 2와 Task 3은 `public/scheduleLayout.js`의 맨 아래 `export` 문을 각각 교체한다. 추가가 아니라 교체다 — 중복 export는 문법 오류다.
- Task 7 Step 3의 카테고리 색상 값은 `public/categories.js`의 `CATEGORY_META`와 반드시 일치해야 한다. 색각이상 검증을 통과한 값이다.
- Task 9 Step 2는 `admin.js`의 실제 탭 분기 형태를 확인하고 맞춰야 한다. `member.js`와 다를 수 있다.
