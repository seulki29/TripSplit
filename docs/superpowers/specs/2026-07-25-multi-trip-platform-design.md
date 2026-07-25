# sfaYW 멀티 여행 정산 플랫폼 — 설계 문서

- 날짜: 2026-07-25
- 대상 저장소: `seulki29/sfaYW` (기존 단일 여행 정적 리포트 → 멀티 여행 플랫폼으로 전환)

## 1. 배경 및 목표

기존 sfaYW는 여행 1건마다 사람이 직접 데이터를 채운 정적 HTML 리포트(`travel_report.html`) 한 장과, 입금 여부·계좌 정보만 저장하는 Firebase Realtime Database로 이루어져 있다. 로그인, 권한, 경비 입력, 영수증 자동 분류 같은 기능은 없다.

다음 여행부터 반복 사용할 수 있도록, 아래 기능을 갖춘 멀티테넌트 웹앱으로 전환한다.

- 슈퍼어드민이 여행을 생성하고 관리자/일반 PIN을 부여
- 여행마다 독립된 경로(slug)를 가짐 (코드 배포 없이 즉시 새 여행 개설)
- 관리자가 여행 정보·구성원·정산 규칙을 설정하고 경비를 컴펌
- 참가자가 이름+PIN으로 로그인해 경비를 사진으로 입력(자동 분류) 하고 본인 항목을 수정
- 확정된 경비로 sfaYW 스타일의 리포트를 생성하되, 카테고리 파이차트와 그룹 내 다른 여행 평균 대비 비교를 추가

## 2. 전체 아키텍처

**프론트엔드**: 프레임워크 없는 순수 HTML/CSS/JS(ES 모듈) SPA. 기존 sfaYW의 에디토리얼 디자인 언어(세리프 타이틀, 얇은 룰선, 모노스페이스 숫자, `--ink`/`--accent`/`--receive`/`--pay` 팔레트)를 그대로 계승한다. 화면 단위로 파일을 분리한다: `login.js`, `admin.js`, `member.js`, `report.js`, `superadmin.js`, 공통 `api.js`(Cloud Functions 호출 래퍼), 공통 `style.css`.

Firebase Hosting에서 모든 경로를 `index.html`로 rewrite하고, 클라이언트 라우터가 다음 경로를 해석한다.

- `/t/<slug>` — 여행 로그인 (관리자 PIN 탭 / 이름+일반 PIN 탭)
- `/t/<slug>/admin` — 관리자 콘솔
- `/t/<slug>/report` — 리포트 (로그인 세션 필요)
- `/sa/<secret-path>` — 슈퍼어드민 로그인. `<secret-path>`는 배포 전 임의 문자열로 정해 코드에 상수로 넣는다(예: `sa-9f2k7`). 어디에도 링크되지 않는 비공개 경로 + 비밀번호 이중 방어.

**백엔드**: Firestore(데이터) + Cloud Functions(모든 검증/쓰기 로직) + Firebase Storage(영수증 사진) + Gemini API(영수증 자동 분류).

Firestore 보안 규칙은 클라이언트의 직접 접근을 전부 차단한다(`allow read, write: if false;`). 모든 읽기/쓰기는 Cloud Functions(Admin SDK)를 통해서만 이루어진다. 클라이언트는 로그인 성공 시 발급받은 세션 토큰(랜덤 문자열)을 localStorage에 저장하고, 이후 모든 API 호출에 실어 보낸다. 각 Function은 `sessions/{token}` 문서를 조회해 role(superadmin/admin/member)과 tripId를 확인한 뒤 요청을 처리한다. Firebase Auth는 사용하지 않는다 — PIN 기반의 신뢰 그룹 서비스라는 성격에 비해 과한 장치이기 때문이다.

Cloud Functions 목록(초안):

| Function | Role | 설명 |
|---|---|---|
| `verifySuperadminPassword` | 공개 | 비밀번호 검증 → superadmin 세션 발급 |
| `createTrip` | superadmin | 여행 생성 (slug, group, PIN 2종) |
| `listTrips` / `updateTrip` / `archiveTrip` | superadmin | 여행 목록/설정/삭제 |
| `verifyAdminPin` | 공개(slug 필요) | 관리자 PIN 검증 → admin 세션 발급 |
| `verifyMemberPin` | 공개(slug 필요) | 이름+일반 PIN 검증 → member 세션 발급 |
| `getTripSetup` / `updateTripSetup` | admin | 기간/장소/숙박지 등록·수정 |
| `addMember` / `updateMember` | admin | 구성원 이름/가중치/제외카테고리 관리 |
| `listExpenses` | admin, member | 경비 목록 조회 |
| `classifyReceipt` | admin, member | 영수증 이미지를 Gemini로 분류 |
| `addExpense` / `updateExpense` | admin, member(본인 것만) | 경비 등록/수정 |
| `confirmExpense` | admin | 경비 컴펌(락) |
| `getReportData` | admin, member | 리포트용 집계(현재 여행 + 그룹 평균) |

## 3. 데이터 모델 (Firestore)

```
trips/{tripId}
  slug: string                    # 예: "yeongwol-2026"
  name: string                    # 예: "SFA 영월 여행"
  group: string                   # 그룹 평균 비교 범위를 묶는 태그 (예: "SFA")
  adminPinHash: string
  memberPinHash: string
  status: "setup" | "active" | "completed"
  period: { start: date, end: date }
  location: string
  lodging: string
  createdAt: timestamp

trips/{tripId}/members/{memberId}
  name: string                    # 로그인 ID 역할, 여행 내 유일해야 함
  weight: number                  # 정산 가중치, 기본 1.0
  excludedCategories: string[]    # 이 사람만 제외할 카테고리 (예: 특정 인원의 특정 카테고리 제외)
  account: { bank, num, holder } | null

trips/{tripId}/expenses/{expenseId}
  date: date
  category: "숙박" | "식비" | "장보기" | "교통비"
  amount: number
  merchant: string
  detail: string
  enteredBy: memberId             # 실제 지출 귀속 대상 (관리자가 대신 입력해도 이 값은 실제 결제자)
  recordedBy: "member" | "admin"  # 누가 입력했는지 (감사용, 이름은 남기지 않음)
  photoUrl: string | null
  confirmed: boolean
  confirmedAt: timestamp | null
  createdAt, updatedAt: timestamp

sessions/{token}
  role: "superadmin" | "admin" | "member"
  tripId: string | null           # superadmin은 null
  memberId: string | null         # member 세션에만 존재
  expiresAt: timestamp
```

## 4. 역할별 흐름

### 슈퍼어드민 (`/sa/<secret-path>`)
1. 비밀번호(`20112988sk!`, Secret Manager에 저장) 입력 → 세션 발급 → 여행 목록 대시보드
2. "새 여행 만들기": 이름/slug, 그룹명, 관리자 PIN, 일반 PIN 입력 → 여행 생성(`status=setup`)
3. 여행별 PIN 재발급, 상태 변경(`active`/`completed`), 삭제 가능

### 관리자 (`/t/<slug>` → 관리자 PIN, 여러 명이 같은 PIN을 공유해 로그인 가능)
1. 최초 로그인 시 여행 정보(기간/장소/숙박지) 입력 화면으로 안내
2. 구성원 관리: 이름 추가/수정, 정산 가중치, 카테고리 제외 설정
3. 경비 입력: 본인 대신 입력 시 "입력 귀속 대상"(구성원 목록) 선택 후 참가자와 동일한 사진→OCR→확인 흐름 사용
4. 경비 내역 확인: 전체 목록(날짜/카테고리/입력자 필터), 아무 항목이나 수정, 컴펌(락)
5. 리포트 생성 → `/t/<slug>/report`

### 참가자 (`/t/<slug>` → 구성원 목록에서 이름 선택 + 일반 PIN)
1. 이름은 자유 입력이 아니라 관리자가 등록한 구성원 목록에서 선택 (오타로 인한 정산 누락 방지)
2. 로그인 후 전체 경비 열람(읽기 전용), 본인이 입력한 항목만 컴펌 전까지 수정 가능
3. "경비 입력" → 카메라 촬영/사진 선택 → Gemini 자동 분류 폼 확인 → 저장(`confirmed=false`)

세션 토큰은 localStorage에 저장되어 재방문 시 자동 로그인된다(멤버/관리자 세션 30일, 슈퍼어드민 세션 12시간 만료).

## 5. 경비 입력 & OCR 분류

1. "경비 입력" 클릭 → `<input type="file" accept="image/*" capture="environment">`로 네이티브 카메라 실행(별도 카메라 라이브러리 불필요)
2. 사진 선택 즉시 Cloud Storage에 업로드 → `classifyReceipt(photoUrl)` 호출
3. Gemini API(vision)에 이미지와 함께 "숙박/식비/장보기/교통비 중 하나로 분류하고 날짜·상호명·금액·세부내용을 JSON으로 추출" 프롬프트 전송 → `{category, date, amount, merchant, detail}` 수신
4. 폼에 자동으로 채워진 값을 사용자가 확인/수정(카테고리도 드롭다운으로 변경 가능)
5. "저장" → `addExpense`가 세션 검증 후 Firestore에 기록. 관리자가 입력한 경우 "입력 귀속 대상"으로 선택한 구성원이 `enteredBy`가 된다.
6. Gemini 호출 실패/애매한 응답 시 필드를 빈 채로 두고 사용자가 직접 입력(재시도 로직 없이 즉시 수동 입력 폴백 — 여행지 네트워크 불안정 대비)
7. 남용 방지를 위해 `classifyReceipt`는 세션당 분당 5회로 호출 빈도를 제한한다.

## 6. 정산 규칙

균등분담 + 가중치 방식을 사용한다(임의 수식 입력 방식은 채택하지 않음).

```
1인당 정산액 = 컴펌된 카테고리별 총 지출 ÷ 해당 카테고리의 가중치 합계
```

- 관리자는 구성원별 `weight`(기본 1.0, 예: 자녀 0.5)와 `excludedCategories`(예: 특정 인원의 특정 카테고리 제외, 가중치 0으로 취급)만 설정한다.
- 차량별 유가 계산처럼 사람마다 다른 계산식이 필요한 지출(예: 기존 영월 여행의 차량별 교통비)은 정산 엔진이 자동 계산하지 않는다. 대신 관리자가 사전에 계산한 금액을 "교통비" 카테고리 지출 항목으로 직접 입력한다.
- 최종 정산 카드는 컴펌된 지출 합계와 각자의 실제 결제액을 비교해 받을 돈/낼 돈을 계산한다(기존 sfaYW의 `settle-card` UI 유지).

## 7. 리포트

`/t/<slug>/report`는 컴펌된 경비만 집계해 렌더링하며, 로그인 세션이 있어야 열람 가능하다(정산액·계좌 등 민감정보 포함).

기존 유지: 히어로(여행명/기간/장소/숙박지), 조건 섹션(정산 규칙 요약), 전체 지출 내역 테이블(영수증 클릭→모달), 결제자별 지출, 최종 정산 카드(수령/입금, 계좌 모달), 갤러리.

신규 추가:
- **카테고리 파이차트**: 숙박/식비/장보기/교통비 비중을 외부 라이브러리 없이 인라인 SVG 도넛 차트로 표시, 기존 색상 팔레트 사용.
- **그룹 평균 대비**: 카테고리별로 "1인당 지출 vs 같은 `group`의 `status=completed` 여행들의 평균"을 막대 비교 + 증감률(%)로 표시. 다른 여행의 개별 지출 내역은 노출하지 않고 집계값만 사용한다. `getReportData`가 현재 여행 집계와 그룹 평균을 함께 계산해 반환한다. 비교 대상 완료 여행이 하나도 없으면 이 섹션은 숨긴다.

## 8. 보안

- 슈퍼어드민 비밀번호는 Cloud Functions 환경변수(Secret Manager)에 저장, 코드/클라이언트에 노출하지 않는다.
- 트립별 admin/member PIN은 Firestore에 평문이 아닌 해시(bcrypt)로 저장한다.
- Gemini API 키는 Secret Manager에 저장하고 클라이언트에는 절대 전달하지 않는다.
- Firestore 보안 규칙은 클라이언트 접근을 전면 차단(`allow read, write: if false;`)하고, 모든 접근은 세션 토큰을 검증하는 Cloud Functions를 경유한다.
- 세션 만료: admin/member 30일, superadmin 12시간.

## 9. 기존 데이터 마이그레이션

1회성 Node 스크립트(Firebase Admin SDK)로 다음을 수행한다.

- 기존 `travel_report.html`에 하드코딩된 지출 내역·결제자·정산 결과를 파싱해 `trips/{yeongwol-2026}` 문서와 하위 `members`/`expenses`로 이관 (`status=completed`, `group="SFA"`, `confirmed=true`로 설정)
- 기존 영수증 이미지(`images/receipt_*.jpg`)를 Cloud Storage로 업로드하고 각 expense의 `photoUrl`로 연결
- 기존 Realtime Database의 `accounts`(계좌 정보), `paid`(입금 완료 여부)를 새 구조(`members/{id}.account`, 정산 완료 상태)로 이관

마이그레이션 완료 후 기존 Realtime Database 사용은 중단하고 Firestore로 일원화한다.

## 10. 범위 밖 (YAGNI)

- 차량 유가 계산 등 사람별 임의 수식 기반 정산 자동화 — 대신 관리자가 계산된 금액을 직접 항목으로 입력
- 관리자별 개인 식별(감사 로그) — 관리자는 PIN 공유로 충분, 개인별 계정 불필요
- Firebase Auth, OAuth 등 정식 인증 체계 — 세션 토큰 문서 방식으로 충분
- 여행별 정적 파일 생성/배포 파이프라인 — 단일 앱 + 동적 slug로 대체
