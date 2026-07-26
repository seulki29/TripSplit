# sfaYW 프론트엔드 SPA — 설계 문서 (Plan 2)

- 날짜: 2026-07-26
- 대상 저장소: `seulki29/sfaYW`
- 선행 문서: `docs/superpowers/specs/2026-07-25-multi-trip-platform-design.md` (전체 시스템 설계), `docs/superpowers/plans/2026-07-25-backend-functions.md` (Plan 1: 백엔드, 완료됨)

## 1. 배경 및 범위

Plan 1에서 Firebase Cloud Functions 백엔드(세션 인증, 여행/구성원/경비 CRUD, Gemini 영수증 분류, 정산·리포트 집계)가 완성되어 로컬 에뮬레이터로 전체 플로우 검증까지 마쳤다. 이 문서는 그 백엔드를 실제로 사용하는 정적 SPA 프론트엔드를 설계한다.

Plan 1이 노출하는 Cloud Functions(20개): `verifySuperadminPassword`, `createTrip`, `listTrips`, `updateTrip`, `archiveTrip`, `verifyAdminPin`, `verifyMemberPin`, `listMembersForLogin`, `logout`, `getTripSetup`, `updateTripSetup`, `addMember`, `updateMember`, `listExpenses`, `addExpense`, `updateExpense`, `deleteExpense`, `confirmExpense`, `classifyReceipt`, `getReportData`.

## 2. 기술 스택 & 파일 구조

프레임워크 없는 순수 HTML/CSS/JS(ES 모듈), 빌드 단계 없음 — Plan 1과 동일한 방침을 프론트엔드에도 유지한다.

```
public/
  index.html          # 셸 HTML — 모든 경로가 Firebase Hosting rewrite로 여기 도착
  app.js               # 라우터: location.pathname을 해석해 해당 뷰 모듈을 동적 import
  api.js                # firebase/functions httpsCallable 래퍼 + 세션 토큰 자동 첨부 + 에러 코드 공통 처리
  session.js            # localStorage 기반 세션 상태(token/role/tripId/memberId) get/set/clear
  ui.js                  # 공통 UI 컴포넌트: 모달, 토스트, 카테고리 칩 버튼, 로딩 스피너
  style.css               # 신규 디자인 시스템 — 기존 travel_report.html의 750줄 CSS를 그대로 재사용하지 않고, 색상/폰트 토큰(--ink/--accent/--receive/--pay, Playfair Display + DM Sans + Noto Sans KR)만 계승해 5개 화면에 맞게 새로 설계
  views/
    superadmin.js       # 슈퍼어드민 로그인 + 여행 목록/생성
    login.js             # 여행별 로그인 (관리자 PIN / 참가자 이름+PIN 탭)
    admin.js              # 관리자 콘솔 (탭 방식)
    member.js              # 참가자 화면 (경비 목록 + 입력)
    report.js               # 리포트
```

## 3. 라우팅 & 세션

Firebase Hosting이 모든 경로를 `index.html`로 rewrite하며, `app.js`가 History API 기반으로(해시 라우팅 아님) 다음 경로를 해석한다.

- `/sa/<secret-path>` — 슈퍼어드민 로그인. `<secret-path>`는 배포 전 임의 문자열로 코드에 상수로 넣는다.
- `/t/<slug>` — 여행 로그인 (미로그인 시) 또는 참가자 화면 (로그인 후, role=member/admin)
- `/t/<slug>/admin` — 관리자 콘솔 (role=admin 세션 필요)
- `/t/<slug>/report` — 리포트 (로그인 세션 필요, role 무관)

`session.js`는 로그인 성공 시 받은 `{token, expiresAt}`과 역할 정보를 localStorage에 저장한다. 각 뷰는 로드 시 `getSession()`으로 role/tripId를 확인하고, 없거나 해당 화면 권한과 맞지 않으면 `/t/<slug>` 로그인 화면으로 리다이렉트한다.

`api.js`는 Plan 1이 이미 매핑해둔 HTTPS 에러 코드를 기준으로 공통 처리한다.

- `unauthenticated` / `permission-denied` → 세션 삭제 후 로그인 화면으로 이동
- `resource-exhausted` → "잠시 후 다시 시도해주세요" 안내 (속도 제한)
- 그 외 → `error.message`를 폼 옆에 그대로 표시 (Plan 1의 도메인 에러 코드는 이미 사람이 읽을 수 있는 수준으로 좁혀져 있음)

## 4. 화면별 흐름

### 슈퍼어드민 (`/sa/<secret-path>`)
1. 비밀번호 입력 → `verifySuperadminPassword` → 세션 저장 → 여행 목록(테이블: 이름/slug/그룹/상태) 화면
2. "새 여행 만들기" 버튼 → 모달 폼(이름, slug, 그룹명, 관리자 PIN, 일반 PIN) → `createTrip`
3. 각 행에서 PIN 재발급(`updateTrip`), 상태 변경, 삭제(`archiveTrip`) 가능

### 여행 로그인 (`/t/<slug>`)
- 두 개 탭
  - "관리자로 입장": PIN 입력 → `verifyAdminPin`
  - "참가자로 입장": 이름은 자유 입력이 아니라 `listMembersForLogin(slug)`로 받은 목록에서 드롭다운 선택 + 일반 PIN 입력 → `verifyMemberPin`

### 관리자 콘솔 (`/t/<slug>/admin`) — **탭 방식** (브레인스토밍에서 확정)
가로 탭 4개: 여행정보 · 구성원 · 경비확인 · 리포트(바로가기 링크)

- **여행정보 탭**: 기간/장소/숙박지 입력 폼 → `getTripSetup`으로 초기값 로드, `updateTripSetup`으로 저장
- **구성원 탭**: 목록 + 추가/수정 폼(이름, 정산 가중치, 카테고리 제외) → `addMember`/`updateMember`
- **경비확인 탭**: 전체 경비 목록(날짜/카테고리/입력자 필터), 행 클릭 시 수정 가능(`updateExpense`), 컴펌 토글(`confirmExpense`), 삭제(`deleteExpense`). 경비 입력 버튼도 있어 관리자가 직접 입력 가능 — 이때 "입력 귀속 대상"(구성원) 드롭다운 추가
- **리포트 탭**: `/t/<slug>/report`로 이동하는 링크만

### 참가자 화면 (`/t/<slug>`, 로그인 후)
- 경비 목록: 전체 열람 가능(읽기 전용), 본인이 입력한 항목만 컴펌 전까지 수정/삭제 가능. 컴펌된 항목은 자물쇠 아이콘 + 흐림 처리(기존 사이트의 `settle-card.paid` 스타일 언어를 확장)
- "경비 입력" 버튼 → `<input type="file" accept="image/*" capture="environment">`로 카메라 실행 → 사진을 base64로 인코딩해 `classifyReceipt` 호출
- **입력 확인 화면 — 사진 위 + 폼 아래 세로 배치** (브레인스토밍에서 확정): 촬영 사진을 크게 보여주고, 그 아래 카테고리(드롭다운 대신 4개 칩 버튼: 숙박/식비/장보기/교통비), 날짜, 금액, 상호명, 세부사항 입력란. 사용자가 확인/수정 후 "입력 완료" → `addExpense`
- Gemini 호출 실패 시에도 폼은 빈 채로 그대로 뜨고 수동 입력 가능 (Plan 1 스펙의 폴백 동작과 일치)

### 리포트 (`/t/<slug>/report`)
기존 섹션 유지: 히어로 → 01 조건 → 02 지출내역 → 03 결제자별 → 04 정산 → 05 갤러리

**신규 — "02.5 카테고리 분석" 섹션** (02와 03 사이, 브레인스토밍에서 위치 확정): `getReportData`가 반환하는 `currentCategoryAverages`/`groupCategoryAverages`/`tripsInComparison`을 사용해,
- 카테고리별 지출 비중을 인라인 SVG 도넛 차트로 표시 (외부 차트 라이브러리 없음, 기존 색상 팔레트 사용)
- **그 아래**(세로 배치, 확정) 카테고리별로 "1인당 지출 vs 그룹 평균" 막대 + 증감률(%) 표시
- 비교 대상 완료 여행이 하나도 없으면(`tripsInComparison === 0`) 이 비교 부분은 숨긴다

## 5. 컴포넌트 재사용

`ui.js` 공통 모듈에 모달 열기/닫기, 토스트 알림, 카테고리 칩 버튼 그룹을 모아두고 각 뷰가 import해서 쓴다 (브레인스토밍에서 확정 — 화면별 완전 독립 대신 공통 모듈 방식).

## 6. 범위 밖 (Plan 3으로 이관)

- 기존 `travel_report.html`/Realtime Database 데이터 마이그레이션 스크립트
- 실제 Firebase 프로젝트 배포(도메인, Blaze 결제, 시크릿 설정)
- 슈퍼어드민 비밀번호 해시·Gemini API 키 등 실제 프로덕션 시크릿 값 설정
