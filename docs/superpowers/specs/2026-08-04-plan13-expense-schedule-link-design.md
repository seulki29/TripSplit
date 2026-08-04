# Plan 13 — 경비 ↔ 일정 연계

날짜: 2026-08-04

## 배경

Plan 11에서 일정에 참여자를 적게 했고, Plan 12에서 경비를 경로 맵에 끌어다 썼다. 그런데 정작 두 데이터가 만나야 할 자리 — 경비를 누가 나눠 내는가 — 는 아직 손으로 따로 입력한다.

저녁을 누가 같이 먹었는지는 일정에 이미 적혀 있는데, 경비 입력 때 그걸 다시 고른다.

## 현재 흐름의 문제

**멤버는 제외 인원을 지정할 수 없다.** `openExpenseModal`(`member.js`)에는 제외 UI가 없고, 멤버가 넣은 경비는 항상 `excludedMembers: []`(전원 분담)로 저장된다. 제외는 나중에 **관리자가 경비확인 탭의 일괄 제외설정**으로 건다.

즉 "누가 빠졌는지" 를 아는 사람(결제한 멤버)과 그걸 입력할 수 있는 사람(관리자)이 다르다. 이 스펙은 그 간극을 메운다.

## 목표

- 네 개 경비 모달 전부에서 **분담 인원을 직접 지정**한다.
- 일정을 고르면 그 일정의 참여자·카테고리·날짜가 채워진다.
- 경비가 어느 일정에서 나왔는지 기억하고, 일정 수정 모달에서 그 일정의 경비 합계를 보여준다.

## 비목표

- **인원 불일치 경고 모달을 만들지 않는다.** Plan 11 설계 때 이미 덜어냈다. 프리필이 동작하면 불일치가 드물고, 드문 경우를 위한 모달은 매번 닫는 잔소리가 된다.
- 상호명을 일정의 위치에서 채우지 않는다 (§2.2).
- 일정 없이 경비만으로 역방향 연결(경비 → 일정 생성)을 만들지 않는다.
- 기존 관리자 일괄 제외설정을 걷어내지 않는다. 여러 건을 한 번에 고칠 때는 여전히 그쪽이 빠르다.

---

## 1. 데이터 모델

### 1.1 `expenses.scheduleId`

```js
scheduleId: null   // 또는 'abc123' (같은 여행의 schedules 문서 id)
```

기존 경비 문서에는 이 필드가 없다. 읽는 쪽에서 `expense.scheduleId || null`로 정규화하므로 **마이그레이션이 필요 없다.** Plan 12의 `isWaypoint`와 같은 처리다.

`addExpense`가 새 문서에 `scheduleId: null`을 기본으로 넣는다.

### 1.2 포함과 제외 — 어느 쪽을 보여주는가

백엔드는 `excludedMembers`(제외된 사람)를 저장한다. 사람은 "누가 나눠 내나"(포함된 사람)로 생각한다.

**화면은 포함 기준으로 보여준다.** 체크된 사람이 분담하는 사람이고, 저장 직전에 뒤집는다.

```
excludedMembers = 전체 구성원 − 체크된 구성원
```

Plan 11의 일정 참여자 체크리스트와 같은 심상이라 사용자가 새로 배울 것이 없다. 백엔드 스키마는 그대로 두므로 정산 로직도 손대지 않는다.

**입력 모달의 기본값은 전원 체크다.** 지금 멤버 입력이 `excludedMembers: []`로 저장되는 것과 동일한 결과이므로, 아무것도 건드리지 않으면 동작이 바뀌지 않는다.

**수정 모달은 저장된 값에서 출발한다.** 초기 체크 = 전체 − `expense.excludedMembers`. 관리자가 일괄 제외설정으로 걸어둔 값도 여기 그대로 나타나므로, 두 경로가 같은 데이터를 본다.

### 1.3 링크와 체크박스는 고른 뒤 독립이다

일정을 고르면 체크가 그 일정의 참여자로 맞춰진다. 그 뒤에 사용자가 체크를 고쳐도 `scheduleId`는 유지된다.

프리필은 출발점이지 구속이 아니다. "성산일출봉 일정이지만 입장료는 나만 냈다" 같은 경우가 실제로 있다.

---

## 2. 일정 선택

### 2.1 고르면 채워지는 것

| 필드 | 값 |
|---|---|
| 분담 인원 | 일정의 `participants` |
| 카테고리 | 일정의 `category` |
| 날짜 | 일정의 `date` |

`(연결 안 함)`을 고르면 `scheduleId`가 `null`이 되고, **다른 필드는 되돌리지 않는다.** 이미 채워진 값을 지우는 것은 사용자가 기대하지 않는 파괴적 동작이다.

### 2.2 상호명을 채우지 않는 이유

일정의 위치는 `성산일출봉`인데 영수증 상호는 `성산일출봉 매표소`처럼 다른 경우가 흔하다. 그리고 상호명은 OCR이 더 정확하게 채운다. 겹치게 두면 서로 덮어쓰는 싸움만 난다.

### 2.3 목록에 넣지 않는 일정

- **`date`가 `null`인 일정** — 경비에는 날짜가 필요한데 "언젠가 갈 곳"에는 채울 날짜가 없다.
- 그 외에는 시간 미정(`startMin === null`)이든 무엇이든 전부 넣는다.

**저장된 `scheduleId`가 목록에 없는 경우**(일정이 삭제됐거나, 연결한 뒤 그 일정의 날짜가 지워진 경우) `<select>`는 `(연결 안 함)`을 선택한 상태로 열린다. §6.4의 "못 찾으면 연결 없음" 규칙과 같다. **다만 사용자가 저장을 누르기 전까지 `scheduleId`를 임의로 지우지는 않는다** — 화면에 안 보인다고 데이터를 조용히 바꾸면, 모달을 열었다 닫기만 해도 연결이 사라진다.

### 2.4 목록 형태

`<select>` 하나. 날짜별 `<optgroup>`으로 묶고, 항목은 `11:00 성산일출봉` / 시간 미정이면 `시간미정 기념품`.

첫 항목은 `(연결 안 함)`이며 값은 빈 문자열이다.

**일정이 하나도 없으면 선택 칸 자체를 렌더링하지 않는다.** 빈 컨트롤을 보여줄 이유가 없다. 이때도 분담 인원 체크리스트는 남는다.

---

## 3. OCR과의 충돌

영수증 OCR(`classifyReceipt`)도 **카테고리와 날짜를 채운다.** 사용자가 사진을 올리고 OCR이 도는 중에 일정을 고르면, 뒤늦게 도착한 OCR 응답이 방금 고른 카테고리를 덮어쓴다.

기존 `skipped` 플래그는 OCR 반영 전체를 끄는 스위치라 여기에는 과하다.

**`scheduleChosen` 플래그를 따로 둔다.** 참이면 OCR 응답에서 **카테고리와 날짜만** 무시하고, 금액·상호명·세부사항은 그대로 반영한다 — 그 셋은 영수증에서 나온 것이 맞다.

이 플래그는 사진이 있는 두 모달(멤버 입력, 관리자 입력)에만 해당한다. 수정 모달에는 OCR이 없다.

---

## 4. 공유 위젯

네 모달에 같은 UI가 들어간다. 복사하면 네 벌이 따로 늙는다.

**`public/views/expenseSplit.js`**

```js
mountExpenseSplit(container, {
  members,            // [{ id, name }]
  schedules,          // [{ id, title, category, date, startMin, participants }]
  scheduleId,         // 초기값, 없으면 null
  excludedMembers,    // 초기값, 없으면 []
}) => {
  getScheduleId(),        // string | null
  getExcludedMembers(),   // [memberId]
  onSchedulePick(cb),     // cb({ category, date }) — 일정을 고를 때마다
}
```

**카테고리를 위젯이 소유하지 않는 이유:** 카테고리 칩 렌더링이 모달마다 조금씩 다르다(변수명·재렌더 함수가 각각 있다). 위젯이 카테고리까지 가지면 네 모달의 내부 사정을 알아야 해서 결합이 오히려 늘어난다. 위젯은 "무엇을 골랐는지" 만 알리고, 반영은 각 모달이 한다.

`onSchedulePick`은 `(연결 안 함)`을 고를 때는 호출하지 않는다 (§2.1의 "되돌리지 않는다").

---

## 5. 일정별 합계

일정 수정 모달(`scheduleForm.js`) 하단에 한 줄을 넣는다.

```
이 일정 경비: 128,000원 (3건)
```

연결된 경비가 없으면 이 줄을 표시하지 않는다.

**확정 여부로 거르지 않는다.** 정산이 아니라 "여기서 얼마 썼나"이므로 미확정 경비도 센다.

### 5.1 데이터를 얻는 방법

`schedule.js`의 병렬 로드에 `listExpenses`를 추가하고, `scheduleId`별 합계를 계산해 `openScheduleForm`에 넘긴다. Plan 11이 정한 시그니처에 인자가 하나 늘어난다:

```js
openScheduleForm({ tripId, members, schedule, defaultDate, onSaved, spend })
// spend = { total: 128000, count: 3 } | null
```

합계 계산은 `schedule.js`가 하고 모달은 받아서 찍기만 한다 — 모달이 경비 배열을 통째로 받으면 그쪽에서도 필터링 규칙을 알아야 해서 규칙이 두 곳에 흩어진다.

이미 `Promise.all`이라 왕복이 하나 늘어도 체감 지연은 없다. **일정 탭이 경비를 읽게 되는 결합이 새로 생기지만**, 읽기 전용이고 표시 한 줄이라 얕다.

Plan 12에서 리포트가 `listSchedules`를 함께 부를 때 배운 것을 여기서도 적용한다: **`listExpenses` 호출은 조용히 실패해야 한다.** 경비를 못 불러왔다고 일정 탭 전체가 에러 화면이 되면 안 된다.

```js
callFunction('listExpenses', { tripId }).catch(() => [])
```

합계 줄만 사라지고 일정은 정상 렌더링된다.

---

## 6. 백엔드

새 콜러블은 없다. 기존 둘에 필드 하나를 더한다.

### 6.1 `addExpense`

- `scheduleId`를 받는다. 없으면 `null`.
- `null`이 아니면 그 여행의 `schedules` 컬렉션에 실재하는지 확인한다. 없으면 `SCHEDULE_NOT_FOUND`.
- 문서에 `scheduleId`를 저장한다.

### 6.2 `updateExpense`

- `patch`에 `scheduleId`가 있으면 같은 검증 후 반영한다.
- `null`을 넣으면 연결 해제.

### 6.3 에러 코드

**신규 코드가 없다.** `SCHEDULE_NOT_FOUND`는 Plan 11에서 이미 `public/errorMessages.js`에 등록했고, `httpsErrors.js`의 `_NOT_FOUND` 규칙에 걸려 그대로 전달된다.

> Plan 11의 교훈: 새 에러 코드를 도입한다면 `public/errorMessages.js`의 `MESSAGES`와 `functions/src/lib/httpsErrors.js`의 `DOMAIN_ERROR_CODES` **두 곳 모두**에 등록해야 한다. 하나만 하면 `toHttpsError`가 코드를 버그로 간주해 `INTERNAL_ERROR`로 바꿔 내보낸다. 이번 범위에서는 해당 없음.

### 6.4 일정을 지우면

`deleteSchedule`은 그 일정을 가리키던 경비를 건드리지 않는다. 경비의 `scheduleId`가 사라진 문서를 가리키게 된다.

**정리하지 않는 이유:** 정산에 영향이 없고(`excludedMembers`는 경비에 이미 복사돼 있다), 읽는 쪽이 전부 "찾으면 표시, 못 찾으면 생략"으로 동작한다. 일정 삭제 때 경비를 훑어 갱신하는 비용이 얻는 것보다 크다.

읽는 쪽 규칙: **경비의 `scheduleId`가 실재하는 일정과 매칭되지 않으면 연결이 없는 것으로 취급한다.**

---

## 7. 파일

| 파일 | 상태 | 내용 |
|---|---|---|
| `public/views/expenseSplit.js` | 신규 | 일정 선택 + 분담 인원 체크리스트 위젯 |
| `public/test/expenseSplit.test.js` | 신규 | 순수 헬퍼 테스트 (§8) |
| `public/views/member.js` | 수정 | 입력·수정 모달에 위젯, `scheduleChosen` |
| `public/views/admin.js` | 수정 | 입력·수정 모달에 위젯, `scheduleChosen` |
| `public/views/schedule.js` | 수정 | `listExpenses` 병렬 로드(실패 허용), 일정별 합계 |
| `public/views/scheduleForm.js` | 수정 | 합계 줄 |
| `public/style.css` | 수정 | 위젯 스타일 |
| `public/sw.js` | 수정 | `CACHE_NAME` 범프 (v6 → v7) |
| `functions/src/functions/expenses.js` | 수정 | `scheduleId` 검증·저장 |
| `functions/test/functions/expenses.test.js` | 수정 | 검증 테스트 |

### 7.1 순수 함수를 분리한다

`expenseSplit.js`는 DOM을 만지므로 단위 테스트 대상이 아니다. 하지만 그 안의 계산은 테스트할 수 있고, 실제로 틀리기 쉬운 부분이다. 다음 둘을 순수 함수로 빼서 export한다.

```js
// 전체 − 체크됨. 순서는 members 순서를 따른다.
excludedFrom(members, includedIds) => [memberId]

// 날짜별로 묶고, 각 그룹 안에서 startMin 순. date가 null인 일정은 제외.
groupSchedulesForPicker(schedules) => [{ date, items: [{ id, label }] }]
```

이 프로젝트는 프론트 단위 테스트를 순수 모듈에만 매기고 DOM은 육안으로 확인한다. 위 둘은 그 경계의 순수 쪽이다.

---

## 8. 테스트

### `public/test/expenseSplit.test.js` (신규, `node --test`)

`excludedFrom`:
- 전원 포함이면 빈 배열
- 아무도 포함 안 하면 전원 제외
- 일부만 포함하면 나머지가 제외되고, 순서는 `members` 순서를 따른다
- `members`에 없는 id가 `includedIds`에 있어도 결과에 영향이 없다

`groupSchedulesForPicker`:
- `date`가 `null`인 일정은 빠진다
- 날짜 오름차순으로 묶인다
- 그룹 안에서 `startMin` 오름차순, 시간 미정은 맨 뒤
- 라벨이 `11:00 성산일출봉` 형태이고, 시간 미정이면 `시간미정 기념품`
- 빈 입력은 빈 배열

### `functions/test/functions/expenses.test.js` (추가)

- `addExpense`가 `scheduleId: null`을 기본으로 저장한다
- 실재하는 `scheduleId`를 저장한다
- 없는 `scheduleId`는 `SCHEDULE_NOT_FOUND`
- 다른 여행의 `scheduleId`는 `SCHEDULE_NOT_FOUND`
- `updateExpense`가 `scheduleId`를 바꾼다
- `updateExpense`가 `scheduleId: null`로 연결을 해제한다
- `patch`에 `scheduleId`가 없으면 기존 값이 유지된다

DOM 동작(체크리스트 토글, 선택 시 프리필, OCR 경합)은 육안으로 확인한다.

---

## 9. 리스크

| 리스크 | 대응 |
|---|---|
| OCR이 뒤늦게 도착해 고른 카테고리를 덮어씀 | `scheduleChosen` 플래그 (§3) |
| 모달 네 개에 같은 코드가 네 벌 생김 | 공유 위젯 (§4) |
| 일정이 삭제돼 경비가 유령 id를 가리킴 | 읽는 쪽에서 "못 찾으면 연결 없음"으로 취급 (§6.4) |
| 경비 조회 실패가 일정 탭을 죽임 | `listExpenses`를 조용히 실패시킴 (§5.1) |
| 기존 경비 입력 동작이 바뀜 | 기본이 전원 체크 → `excludedMembers: []`로 지금과 같은 결과 (§1.2) |
| 일정이 많은 여행에서 선택 목록이 길어짐 | 날짜별 `optgroup`으로 묶음. 그래도 길면 후속 과제 |
| `CACHE_NAME` 범프 누락 | 파일 표(§7)에 명시 |

---

## 10. 배포 순서

**신규 콜러블이 없으므로 프론트만 배포해도 깨지지 않는다.** 다만 `scheduleId`를 보내면 배포 전 백엔드는 그 필드를 무시할 뿐이라(검증도 저장도 안 함) 연결이 조용히 안 되는 상태가 된다.

따라서 **백엔드를 먼저 배포하고 프론트를 병합한다.** Plan 11·12와 같은 순서다.

```powershell
npx -y firebase-tools@14 deploy --only functions --project prod
```

---

## 11. 이후

Plan 11에서 나눈 다섯 덩어리 중 사용자가 드래그/리사이즈 편집, 안(案) 전환 UI, 스팟 요약을 하지 않기로 했다. 이 스펙이 마지막이다.
