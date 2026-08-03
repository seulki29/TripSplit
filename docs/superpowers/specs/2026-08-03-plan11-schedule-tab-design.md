# Plan 11 — 여행 일정 탭 (타임테이블 · 목록)

날짜: 2026-08-03

## 배경

지금 앱은 여행이 끝난 뒤의 돈만 다룬다. 여행 **전과 중**에 "언제 어디를 가는지"를 공유할 자리가 없어서, 그 정보는 카카오톡 대화나 누군가의 메모장에 흩어져 있다.

일정을 앱 안으로 들이면 경비와 이어붙일 수 있다는 이득도 생긴다. 저녁을 누가 같이 먹었는지는 일정에 이미 적혀 있는데, 지금은 경비 입력 때 그걸 다시 손으로 고른다.

## 목표

- 여행 기간 동안의 일정을 등록·수정·삭제한다. 구성원 누구나 할 수 있다.
- 네 가지 뷰로 본다: **주간 / 하루 / 연속 / 목록**. 선택은 기억된다.
- 일정마다 참여자를 지정한다. 기본은 전원이며 체크리스트로 고친다.
- 위치를 적으면 카카오맵으로 바로 연다.
- 시간이 안 정해진 일정도 담는다.
- **나중에 "안(案)" 여러 개를 굴릴 수 있도록 스키마를 미리 갖춰둔다.** UI는 이번 범위가 아니다.

## 비목표 — 무엇을 왜 덜어냈는가

이 기능은 원래 요청 기준으로 여섯 덩어리였다. 한 번에 다 하면 스펙이 길어지고 중간에 방향이 틀어질 때 되돌리는 비용이 커서, 이번 스펙은 **첫 덩어리**만 다룬다.

| 덜어낸 것 | 이유 | 대신 |
|---|---|---|
| 스팟 사진 1~2장 | 검색 이미지 핫링크는 저작권 문제이고 링크가 깨진다. 합법적 경로는 사실상 Google Places Photos뿐인데 결제 계정 등록이 필요하다 | 후속 단계에서 사진 없이 요약 + 링크만 |
| 지도 SDK 임베드 | 앱키 발급 + 도메인 등록(Vercel·Firebase 양쪽) + 좌표를 얻기 위한 장소검색 API 프록시가 딸려온다 | `map.kakao.com` 검색 링크 (§6) |
| 일정↔경비 참여자 불일치 경고 모달 | 프리필이 동작하면 불일치가 드물다. 드문 경우를 위한 모달은 매번 닫는 잔소리가 된다 | 후속 단계에서 프리필만 |
| 드래그 이동 / 리사이즈 | 자르는 게 아니라 **미룬다**. 폰에서 30분 블록 모서리를 손가락으로 잡는 건 괴롭고, 빌드 없는 바닐라 JS에서 포인터 이벤트 + 스냅 + 스크롤 판별을 직접 짜면 버그가 잘 생긴다 | 블록 탭 → 모달에서 시간 조정. 써보고 답답하면 그때 얹는다 |
| 안(案) 전환 UI | 스키마만 미리 심으면 마이그레이션 없이 나중에 붙는다 (§1.1) | `planId` 필드 + `plans/default` |

**자정을 넘기는 일정도 지원하지 않는다.** `endMin > 1440`을 허용하면 그 블록 하나 때문에 세 타임테이블의 레이아웃 계산이 전부 복잡해진다. 이틀로 쪼개 입력한다.

**실시간 동기화도 하지 않는다.** Firestore 룰이 전면 차단(`allow read, write: if false`)이라 클라이언트가 `onSnapshot`을 쓸 수 없다. 콜러블 폴링이 유일한 대안인데 얻는 것에 비해 비싸다. 새로고침 버튼을 둔다.

---

## 1. 데이터 모델

### 1.1 `trips/{tripId}/plans/{planId}` — 안(案) 컨테이너

```js
{
  name: '1안',
  isActive: true,
  createdBy: 'm1' | null,      // 관리자가 만들면 null
  createdByRole: 'member' | 'admin',
  createdAt: 1754... ,
  updatedAt: 1754...,
}
```

**기본 안의 문서 ID는 `default`로 고정한다.** 자동 ID가 아니다. 이유는 두 가지다.

1. **마이그레이션이 필요 없다.** 기존 여행들에 미리 plan 문서를 만들어둘 필요 없이, 일정 탭에 처음 들어올 때 만든다.
2. **동시 생성이 안전하다.** 여러 명이 같은 순간에 탭을 열어도 문서 ID가 같으므로 중복이 생기지 않는다. 자동 ID였다면 `plans` 컬렉션에 빈 안이 여러 개 쌓인다.

**생성은 읽어보고 없을 때만 한다 — `set(..., { merge: true })`를 쓰지 않는다.**

```js
const ref = db.collection('trips').doc(tripId).collection('plans').doc('default');
const snap = await ref.get();
if (!snap.exists) await ref.set({ name: '1안', isActive: true, ... });
```

`merge: true`는 *넘기지 않은* 필드만 보존한다. 넘긴 필드는 그대로 덮어쓴다. 따라서 `listSchedules`가 매번 `set(merge:true)`를 호출하면 탭을 열 때마다 `createdAt`이 갱신되고, 후속 단계에서 안 이름을 바꿔도 다음 조회에서 `'1안'`으로 되돌아간다.

남는 경합은 두 명이 동시에 첫 진입해 둘 다 `!exists`를 보고 둘 다 쓰는 경우인데, **문서 ID가 고정이라 중복 문서가 생기지 않고 `createdAt`이 밀리초 단위로 달라질 뿐**이라 무해하다. 트랜잭션을 쓸 이유가 없다.

주의: `functions/test/helpers/fakeFirestore.js`의 `FakeDocRef.set()`은 옵션 인자를 무시하고 항상 통째로 덮어쓴다. merge 동작에 의존하는 코드는 테스트에서 통과하고 운영에서 어긋난다.

지연 생성은 **여행 상태와 무관하게 동작한다.** 완료된 여행에서도 `listSchedules`는 성공해야 하고, 이 문서는 사용자가 쓴 내용이 아니라 내부 컨테이너라 `requireTripEditable`의 대상이 아니다.

후속 단계의 안 UI는 이 컬렉션에 문서를 더 추가하고 `isActive`를 옮기는 것뿐이라, 스키마 변경이 없다.

**`isActive`는 이번 범위에서 쓰이지 않는다.** 안이 하나뿐이라 프론트는 `default`를 그냥 읽는다. 지연 생성 시 `true`로 기록만 해두고, 이 값으로 분기하는 코드는 만들지 않는다.

### 1.2 `trips/{tripId}/schedules/{scheduleId}`

```js
{
  planId: 'default',
  title: '성산일출봉',           // 내용
  detail: '입장료 5천원',        // 세부
  category: '놀이',              // 기존 CATEGORIES 재사용
  placeName: '성산일출봉',        // 위치 — 장소명 또는 지도 URL
  date: '2026-08-02' | null,     // null = 날짜 미정
  startMin: 660 | null,          // 자정 기준 분. 11:00 → 660
  endMin: 780 | null,            // 13:00. startMin과 항상 짝
  participants: ['m1', 'm2'],
  createdBy: 'm1' | null,
  createdByRole: 'member' | 'admin',
  updatedBy: 'm2' | null,
  updatedByRole: 'member' | 'admin',
  createdAt, updatedAt,
}
```

**시간을 `'11:00'` 문자열이 아니라 분 정수로 둔다.** 픽셀 환산, 정렬, 겹침 판정이 전부 산술 한 줄로 끝난다. 문자열이면 세 뷰가 렌더링할 때마다 파싱한다. 표시할 때만 `minToLabel()`로 바꾼다.

**`participants`는 "전원"이어도 전체 ID를 나열해 저장한다.** 빈 배열을 "전원"의 뜻으로 쓰면, 나중에 구성원이 추가됐을 때 과거 일정의 참여자가 소리 없이 늘어난다. 명시적 배열이면 그런 일이 없다. 대신 구성원이 삭제되면 유효하지 않은 ID가 남으므로, **렌더링할 때 실재하는 멤버만 필터**한다 — 저장된 데이터는 건드리지 않는다.

**`createdBy`가 `null`일 수 있는 이유**: 관리자 세션은 `memberId`가 `null`이다 (`tripAuth.js` `verifyAdminPin` → `createSession({ role: 'admin', tripId })`). 관리자에게 작성자로 귀속할 멤버를 고르게 하는 건 일정에서는 과하다. `createdByRole`로 구분해 화면에는 "관리자"로 표시한다. `expenses`가 `enteredBy` + `recordedBy`로 나눠 쓰는 것과 같은 결이다.

### 1.3 날짜/시간의 네 가지 조합

| `date` | `startMin`/`endMin` | 의미 | 표시 위치 |
|---|---|---|---|
| 있음 | 있음 | 확정 일정 | 타임테이블 본문 |
| 있음 | `null` | 날짜만 정해짐 | 그 날짜 컬럼 위 "미정" 스트립 |
| `null` | `null` | 완전 미정 | 화면 최상단 "미정" 영역 |
| `null` | 있음 | — | **거부한다.** 날짜 없는 시간은 의미가 없다 |

---

## 2. 백엔드

`functions/src/functions/schedules.js`를 새로 만든다. 기존 콜러블 패턴을 그대로 따른다.

| 함수 | 권한 | 비고 |
|---|---|---|
| `listSchedules` | `['admin','member']` | `plans` + `schedules`를 한 번에 반환 |
| `addSchedule` | `['admin','member']` + `requireTripEditable` | → `{ scheduleId }` |
| `updateSchedule` | 동일 | `{ scheduleId, patch }` |
| `deleteSchedule` | 동일 | |

**`listSchedules`가 `plans`까지 같이 반환하는 이유**: 프론트가 화면을 그리려면 둘 다 필요하다. 나누면 왕복이 두 번이고, 그 사이에 `plans/default`가 생성되는 타이밍 문제가 생긴다. `listSchedules`가 진입점이자 `plans/default`의 지연 생성 지점이다.

**`listSchedules`에는 `requireTripEditable`을 걸지 않는다.** 완료된 여행의 일정도 읽을 수 있어야 한다. 쓰기 3종에만 건다 — 기존 `expenses`와 같다.

### 2.1 검증 규칙

| 필드 | 규칙 | 실패 코드 |
|---|---|---|
| `title` | trim 후 1~100자 | `TITLE_REQUIRED` |
| `detail` | 0~500자 | `SCHEDULE_TEXT_TOO_LONG` |
| `placeName` | 0~200자 | `SCHEDULE_TEXT_TOO_LONG` |
| `category` | `CATEGORIES` 포함 | `INVALID_CATEGORY` (기존) |
| `date` | `null` 또는 `/^\d{4}-\d{2}-\d{2}$/` | `INVALID_SCHEDULE_DATE` |
| `startMin`/`endMin` | 둘 다 `null`, 또는 둘 다 0~1440 정수이며 `endMin > startMin` | `INVALID_SCHEDULE_TIME` |
| `date`가 `null`인데 시간이 있음 | 거부 | `INVALID_SCHEDULE_TIME` |
| `participants` | 배열, 중복 제거 후 전부 실재 `memberId` | `INVALID_PARTICIPANTS` |
| `planId` | 실재하는 plan 문서 | `PLAN_NOT_FOUND` |

새 코드는 `public/errorMessages.js`의 `MESSAGES`에 추가한다. 없으면 `FALLBACK` 문구가 나가서 사용자가 무엇이 틀렸는지 알 수 없다.

- `TITLE_REQUIRED`: '일정 내용을 입력해주세요.'
- `SCHEDULE_TEXT_TOO_LONG`: '입력이 너무 깁니다.'
- `INVALID_SCHEDULE_DATE`: '날짜가 올바르지 않습니다.'
- `INVALID_SCHEDULE_TIME`: '시간이 올바르지 않습니다. 끝 시간은 시작 시간보다 뒤여야 합니다.'
- `INVALID_PARTICIPANTS`: '참여자 선택이 올바르지 않습니다.'
- `PLAN_NOT_FOUND`: '일정 안을 찾을 수 없습니다.'
- `SCHEDULE_NOT_FOUND`: '일정을 찾을 수 없습니다.'

### 2.2 곁다리 정리 — `validateMemberIds` 추출

`validateMemberIds`가 지금 `functions/src/functions/expenses.js` 안에 비공개 함수로 있다. 일정의 `participants` 검증에 똑같은 것이 필요하다.

`functions/src/lib/memberIds.js`로 옮기고 양쪽이 import한다. 복사하면 두 곳이 따로 늙는다. 단, **던지는 에러 코드는 호출자가 정한다** — 경비는 `INVALID_EXCLUDED_MEMBERS`, 일정은 `INVALID_PARTICIPANTS`로 서로 다른 메시지가 나가야 한다. 추출한 함수는 불린을 반환하거나 에러 코드를 인자로 받는다.

기존 `functions/test/functions/expenses.test.js`의 제외 구성원 검증 테스트는 그대로 통과해야 한다.

---

## 3. 화면

### 3.1 탭 배치

`public/views/schedule.js`가 `renderScheduleInto(body, slug)`를 export하고, **멤버 뷰와 관리자 뷰가 같은 모듈을 호출**한다. `report.js`의 `renderReportInto`가 이미 같은 패턴이다.

- 멤버 뷰 탭: `경비목록 · 구성원 · **일정** · 리포트`
- 관리자 뷰 탭: `여행정보 · 구성원 · 경비확인 · **일정** · 리포트`

일정을 리포트보다 앞에 둔다. 리포트는 여행이 끝난 뒤 보는 것이고 일정은 여행 전·중에 보는 것이라, 사용 빈도 순서가 그렇다.

**공개 리포트(`/t/{slug}/report`)에는 노출하지 않는다.** 참여자 이름과 방문 장소가 인증 없는 URL로 나가는 문제를 지금 결정할 이유가 없다.

### 3.2 네 가지 뷰

탭 상단 줄에 뷰 세그먼트 컨트롤 · 새로고침 · "일정 추가" 버튼이 놓인다. 뷰 선택은 `localStorage['tripsplit.scheduleView']`에 저장한다.

**새로고침 버튼이 필요한 이유**: 실시간 동기화가 없어서(비목표 참조) 다른 사람이 방금 넣은 일정이 자동으로 나타나지 않는다. 여럿이 같이 계획을 짜는 상황이 이 기능의 주 사용처라, 다시 불러올 수단이 화면에 보여야 한다.

**뷰가 4개라고 렌더링 코드가 4벌은 아니다.** 세 타임테이블은 같은 부품의 배치만 다르다.

```
renderDayColumn(날짜, 일정들, opts)   ← 겹침 레인 · 픽셀 환산 · 블록 그리기
                                        까다로운 건 전부 여기 한 곳

  주간형 = [시간 거터] + DayColumn × N일           (가로)
  하루형 = [날짜 탭] + [시간 거터] + DayColumn × 1
  연속형 = ([날짜 헤더] + [시간 거터] + DayColumn) × N일  (세로)
```

| 뷰 | 형태 | 비고 |
|---|---|---|
| **주간** | 가로 날짜 × 세로 시간 | 여행 전체를 한 화면에. 컬럼 최소 폭 72px, 넘으면 가로 스크롤 |
| **하루** | 날짜 탭 + 하루치 시간축 | 블록이 화면 폭을 다 써서 제목·장소·인원이 다 보인다 |
| **연속** | 날짜 헤더 sticky + 세로로 이어짐 | 탭 전환 없이 훑는다 |
| **목록** | 날짜별 그룹 + 시간순 카드 | 시간축 비례 없이 압축. `11:00–13:00 · [놀이] 성산일출봉 · 📍성산 · 👥5` |

**시간축 범위는 모든 날짜에 공통으로 하나를 쓴다.** 연속형에서 날마다 축이 다르면 들쭉날쭉해 보이고, 주간형은 애초에 축을 공유해야 한다.

**블록 내용은 높이에 따라 점진적으로 표시한다.** 30분 이하면 제목만, 그 이상이면 장소, 더 크면 참여자까지. 짧은 블록에 세 줄을 넣으면 전부 잘린다.

**"미정" 영역**은 시간축 위의 가로 스트립이다. 날짜만 정해진 일정은 그 날짜 컬럼의 스트립 칸에, 날짜도 없는 일정은 화면 최상단 별도 줄에 칩 형태로 놓는다. 목록 뷰에서는 맨 위 "미정" 그룹이다.

### 3.3 등록 · 수정

**일정 생성은 상단 "일정 추가" 버튼으로만 한다.** 타임테이블 빈 칸을 눌러 만드는 방식은 쓰지 않는다 — 스크롤 중 오탭이 잦고, 드래그를 나중에 얹을 때 제스처가 충돌한다.

블록/카드를 탭하면 수정 모달이 열린다. 모달 필드 순서:

```
카테고리   [칩 그룹]              ← renderChipGroup 재사용
날짜       [date]  □ 날짜 미정
시간       [time]–[time]  □ 시간 미정   ← step=900 (15분)
내용       [text]
세부       [text]
위치       [text]                 → 입력되면 아래에 카카오맵 링크 미리보기
참여자     ☑전체  ☑홍길동 ☑김철수 …
[저장]  [삭제]
```

- 시간 입력은 `<input type="time" step="900">`. 브라우저 기본 UI가 폰에서 가장 잘 동작한다.
- 참여자는 **기본 전원 체크**. "전체" 토글 하나로 전부 켜고 끈다.
- 삭제는 확인 모달을 한 번 거친다. 누구나 남의 일정을 지울 수 있으므로 실수 비용이 낮지 않다.
- 모달 하단에 `마지막 수정: 홍길동`을 `.muted`로 표시한다. `updatedByRole === 'admin'`이면 "관리자".

---

## 4. 레이아웃 계산 — `public/scheduleLayout.js`

**이 파일에는 DOM이 없다.** 이 기능에서 실제로 틀리기 쉬운 건 전부 계산이다 — 세 일정이 서로 다르게 겹칠 때 레인이 몇 개 나오는지, 23:45에 끝나는 일정 때문에 축이 어디까지 늘어나는지. 순수 함수로 분리하면 jsdom 없이 `node --test`로 직접 검증할 수 있다.

### 4.1 `assignLanes(entries)` — 겹침 배치

1. `startMin` 오름차순, 같으면 `endMin` 내림차순 정렬
2. **클러스터 분할**: 진행 중 클러스터의 최대 `endMin`보다 다음 일정의 `startMin`이 작으면 같은 클러스터
3. 클러스터 안에서 각 일정을 `lastEnd <= startMin`인 **첫 번째 빈 레인**에 넣는다. 없으면 새 레인
4. 반환: 일정별 `{ lane, laneCount }` — `laneCount`는 그 **클러스터**의 레인 수

`left = lane / laneCount`, `width = 1 / laneCount` (비율). 클러스터별로 레인 수를 세는 것이 중요하다. 하루 전체의 최대 레인 수로 나누면, 오후에 3개가 겹쳤다는 이유로 아침의 단독 일정까지 1/3 폭이 된다.

**경계**: `11:00–12:00`과 `12:00–13:00`은 겹치지 않는다. 판정은 `aStart < bEnd && bStart < aEnd`.

### 4.2 `timeRangeFor(entries)` — 축 범위

```
시간이 있는 일정이 없으면      → 08:00–22:00
있으면  from = min(480, floor(최소 startMin / 60) * 60)
        to   = max(1320, ceil(최대 endMin / 60) * 60)
```

시간 단위로 내림/올림하고, **최소 08:00–22:00은 보장**한다. 00~24시를 다 그리면 새벽이 텅 빈 채 스크롤만 길어진다.

`pxPerMin = 0.8` (1시간 = 48px). 기본 범위 840분 × 0.8 = 672px로, 폰 세로에서 살짝 스크롤된다.

### 4.3 `groupByDate(entries, period)`

날짜 목록은 **`period.start~end`와 일정에 실제로 등장하는 날짜의 합집합**이다.

관리자가 나중에 여행 기간을 좁혔을 때 기간 밖으로 밀려난 일정이 화면에서 사라지면 안 된다. 데이터는 남아 있는데 보이지 않는 상태가 최악이다. `period`가 아예 비어 있으면 일정의 날짜들만 쓰고, 그것도 없으면 빈 상태 안내를 낸다.

### 4.4 `minToLabel(min)` / `labelToMin(str)`

`660 ↔ '11:00'`.

`1440`을 `'24:00'`으로 표시하는 경우가 하나 있다: **시간축의 마지막 눈금**. `timeRangeFor`의 `to`는 23:45에 끝나는 일정 때문에 1440까지 올라갈 수 있고, 그 눈금을 `'00:00'`으로 적으면 축이 자정으로 되감긴 것처럼 보인다.

일정 자체의 값 범위는 이렇게 갈린다.

| | 범위 | 근거 |
|---|---|---|
| 폼이 만들어내는 값 | 0 ~ 1439 | `<input type="time">`이 `24:00`을 받지 못한다 |
| 백엔드가 허용하는 값 | 0 ~ 1440 | 축 계산과 같은 상한을 쓴다. 폼보다 넓은 건 무해하다 |

---

## 5. 파일

| 파일 | 상태 | 내용 |
|---|---|---|
| `public/scheduleLayout.js` | 신규 | `assignLanes` · `timeRangeFor` · `groupByDate` · `minToLabel` · `labelToMin` · `mapLinkFor` |
| `public/views/schedule.js` | 신규 | 탭 셸 — 뷰 전환, 데이터 로드, 새로고침, 추가 버튼 |
| `public/views/scheduleTimetable.js` | 신규 | `renderDayColumn` + 주간/하루/연속 껍데기 |
| `public/views/scheduleList.js` | 신규 | 목록 뷰 |
| `public/views/scheduleForm.js` | 신규 | 등록/수정 모달, 참여자 체크리스트 |
| `public/views/member.js` | 수정 | 일정 탭 추가 |
| `public/views/admin.js` | 수정 | 일정 탭 추가 |
| `public/errorMessages.js` | 수정 | 신규 에러 코드 7개 |
| `public/style.css` | 수정 | 타임테이블/블록/세그먼트/미정 스트립 |
| `public/sw.js` | 수정 | `CACHE_NAME` 범프 |
| `functions/src/functions/schedules.js` | 신규 | 콜러블 4개 |
| `functions/src/lib/memberIds.js` | 신규 | `expenses.js`에서 추출 |
| `functions/src/functions/expenses.js` | 수정 | 추출된 함수 사용 |
| `functions/index.js` | 수정 | 콜러블 4개 등록 |

**파일을 처음부터 나누는 이유**: `admin.js`가 이미 26KB로 비대해졌다. 한 파일에 다 넣으면 같은 상태가 된다.

`sw.js`의 `SHELL_ASSETS`에는 새 파일을 넣지 않는다. fetch 핸들러가 동일 출처 GET을 전부 캐시하므로 뷰 모듈은 자동으로 잡힌다 (`sw.js` 주석 참조). **`CACHE_NAME` 범프는 반드시 한다** — 안 하면 기존 사용자가 옛 모듈로 새 백엔드를 때린다.

---

## 6. 위치 링크

```js
function mapLinkFor(placeName) {
  const s = String(placeName || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://map.kakao.com/?q=${encodeURIComponent(s)}`;
}
```

`'켄싱턴리조트평창'` → `https://map.kakao.com/?q=%EC%BC%84%EC%8B%B1%ED%84%B4%EB%A6%AC%EC%A1%B0%ED%8A%B8%ED%8F%89%EC%B0%BD`

**이건 좌표가 박힌 핀이 아니라 검색어를 넘기는 것이다.** 고유한 이름이면 결과가 하나라 사실상 핀과 같지만, "스타벅스" 같은 이름은 전국 목록이 뜬다. 그래서 **`http(s)://`로 시작하면 검색 링크를 만들지 않고 그 URL을 그대로 쓴다.** 카카오맵에서 장소를 찾아 공유 링크를 복사해오면 정확한 핀이 된다. 판별이 정규식 한 줄이라 비용이 거의 없는 탈출구다.

링크는 `target="_blank" rel="noopener noreferrer"`로 연다. 사용자가 붙여넣은 URL이 그대로 `href`가 되므로, `javascript:`·`data:` 같은 스킴이 통과하지 않도록 `^https?://` 검사를 반드시 거친다.

---

## 7. 테스트

### `public/test/scheduleLayout.test.js` (신규, `node --test`)

- `assignLanes`: 겹침 없음 → 전부 `laneCount 1`
- `assignLanes`: 2개 겹침 → 각각 `lane 0/1`, `laneCount 2`
- `assignLanes`: 클러스터가 둘로 나뉘면 각자의 `laneCount`를 갖는다 (오후 3중첩이 아침 단독 일정 폭에 영향 없음)
- `assignLanes`: `11:00–12:00`과 `12:00–13:00`은 겹치지 않는다
- `assignLanes`: 빈 레인 재사용 — 세 번째 일정이 첫 일정이 끝난 레인 0에 들어간다
- `timeRangeFor`: 일정 없음 → 480/1320
- `timeRangeFor`: 06:30 시작 → `from`이 360으로 확장
- `timeRangeFor`: 23:45 종료 → `to`가 1440으로 확장
- `timeRangeFor`: 최소 범위 안에 들어가는 일정만 있으면 480/1320 유지
- `groupByDate`: 기간 밖 날짜의 일정도 날짜 목록에 포함된다
- `groupByDate`: `date: null`은 floating 버킷으로 간다
- `groupByDate`: 날짜는 있고 시간이 `null`이면 그 날짜의 untimed 버킷
- `groupByDate`: `period`가 비어도 일정 날짜만으로 동작한다
- `minToLabel` / `labelToMin` 왕복
- `mapLinkFor`: 한글 인코딩, URL 그대로 통과, `javascript:` 거부, 빈 문자열 → `null`

### `functions/test/functions/schedules.test.js` (신규, jest)

- `listSchedules`가 `plans/default`를 만들고, 두 번 불러도 하나만 존재한다 (멱등성)
- 완료된 여행에서도 `listSchedules`는 성공한다
- 완료된 여행에서 `addSchedule`은 `TRIP_COMPLETED`
- 검증 규칙 표(§2.1)의 각 실패 케이스
- `date: null` + 시간 있음 → `INVALID_SCHEDULE_TIME`
- `endMin === startMin` → `INVALID_SCHEDULE_TIME`
- 실재하지 않는 `participants` → `INVALID_PARTICIPANTS`
- 관리자 세션으로 만들면 `createdBy: null`, `createdByRole: 'admin'`
- 멤버 세션으로 만들면 `createdBy: memberId`
- 다른 여행의 세션으로 접근하면 `FORBIDDEN`
- 남이 만든 일정도 수정·삭제된다 (경비와 달리 소유자 제한이 없음을 고정)

### 기존 테스트

`expenses.test.js`의 제외 구성원 검증이 `memberIds.js` 추출 후에도 그대로 통과해야 한다.

렌더링(블록 위치, 세그먼트, sticky 헤더)은 CSS와 DOM 배치라 단위 테스트 대상이 아니다. 에뮬레이터에서 육안 확인한다.

---

## 8. 리스크

| 리스크 | 대응 |
|---|---|
| 주간 뷰가 폰에서 너무 좁다 | 컬럼 최소 폭 72px + 가로 스크롤. 그래도 답답하면 하루/목록 뷰로 피할 수 있다 |
| 구성원 삭제 후 `participants`에 유령 ID | 렌더링 시 실재 멤버만 필터. 저장 데이터는 안 고친다 |
| 여러 명이 동시에 같은 일정 수정 | 마지막 저장이 이긴다. 새로고침 버튼과 `마지막 수정: 이름` 표시로 알아챌 수 있게만 한다 |
| 여행 기간을 좁혀 일정이 기간 밖으로 밀림 | `groupByDate`가 합집합을 쓴다 (§4.3) |
| 붙여넣은 URL이 위험한 스킴 | `^https?://`만 통과 (§6) |
| `CACHE_NAME` 범프 누락 | 파일 표(§5)에 명시. 배포 전 확인 |
| 일정이 많은 날 주간 뷰의 블록이 읽을 수 없이 얇아짐 | 레인이 4개를 넘으면 컬럼 폭 대비 너무 얇다. 구현 후 실측하고, 문제가 되면 "+N" 축약을 후속으로 검토 |

---

## 9. 후속 단계

이번 스펙이 끝난 뒤 각각 별도 스펙 → 플랜 → 구현으로 간다. 순서는 실사용 후 다시 정한다.

1. **경비 연계** — 경비 입력 시 일정 선택 → `participants` 기준으로 제외 인원과 카테고리 프리필
2. **드래그 이동 / 리사이즈** — 먼저 써보고 필요성을 판단
3. **안(案) UI** — 복제 · 전환 · 이름 변경. 스키마는 이미 준비됨
4. **스팟 요약** — Gemini로 3줄 요약 + 링크. 사진 없음. 장소별 캐싱 필수
5. **여행 경로 맵** — 실제 지도 타일이 아니라 SVG 여정도. 좌표도 API 키도 불필요
