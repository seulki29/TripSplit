# Plan 9 — 여행사진 개선 + 리포트 밀도/카테고리 색상/그룹 비교 재설계

날짜: 2026-08-01

## 배경

Plan 8에서 여행사진 갤러리와 카테고리 분석이 들어갔지만 실사용에서 세 갈래 문제가 드러났다.

1. **여행사진** — 한 번에 한 장만 올릴 수 있고, 원본 해상도를 그대로 업로드하며, 라이트박스에서 가로/세로 사진이 섞이면 이미지 높이가 바뀌면서 이전/다음 버튼이 위아래로 움직인다.
2. **리포트 전체 지출 내역** — 모바일에서 결제자 이름이 항상 2줄로 접히고 금액의 `원`이 다음 줄로 떨어진다. 날짜에 연도가 붙어 폭을 낭비한다. 카테고리 태그가 전부 같은 회색이라 스캔이 안 된다.
3. **카테고리 분석** — 평균에 소수점이 그대로 노출되고, 그룹 평균 비교가 여행 길이를 무시한 총액 기준이라 3박 여행과 7박 여행을 같은 잣대로 비교한다. 표현도 카테고리당 한 문단씩이라 카테고리가 늘면 세로로 길어진다.

## 목표

- 여행사진: 다중 선택 업로드, 업로드 전 클라이언트 리사이즈, 고정 프레임 라이트박스
- 경비 날짜 표기 통일 (연도 제거)
- 카테고리별 고유 색상 (검증된 팔레트) — 카테고리가 나오는 모든 화면
- 모바일 지출 표 줄바꿈/밀도 개선
- 그룹 평균 비교를 1인·하루 기준으로 정규화하고 표 형태로 재설계

## 비목표

- 영수증(receipt) 업로드 경로는 건드리지 않는다. `classifyReceipt`는 이미지를 Gemini로 보내 OCR하므로 리사이즈가 인식률에 영향을 줄 수 있다. 여행사진(tripPhotos)만 대상이다.
- 다크 모드는 도입하지 않는다. 앱에 `prefers-color-scheme` 처리가 없고 이번 범위 밖이다. 팔레트는 light surface(`#fafaf8`)에 대해서만 검증한다.
- 리포트 머리글의 여행 기간(`period.start — period.end`)은 연도를 유지한다. 경비 날짜가 아니라 문서 머리글이며 연도가 정보 가치를 갖는다.

---

## 1. 카테고리 색상 시스템

### 1.1 팔레트 선정

기존 `CATEGORY_COLORS`(report.js)는 dataviz 검증기에서 전 항목 실패했다.

```
[FAIL] Lightness band   #1a4a6b(0.393), #1a5c3a(0.424) — 밴드 이탈
[FAIL] Chroma floor     #1a4a6b, #1a5c3a, #6a5a8a — 회색으로 읽힘
[FAIL] CVD separation   #1a5c3a↔#8a3a1a ΔE 5.5 (protan)
```

채도를 낮춘 편집 톤 후보 두 벌을 추가로 검증했으나 모두 실패했다 — 채도를 죽이면 색 분리가 함께 무너지므로 "무채도 + 색각 안전"은 동시에 성립하지 않는다. 최종 채택 팔레트는 dataviz 레퍼런스 램프에서 의미 매핑에 맞게 재배열한 것으로, 프로젝트 surface(`#fafaf8`)에 대해 전 항목 통과한다.

```
[PASS] Lightness band      6/6 inside L 0.43–0.77
[PASS] Chroma floor        6/6 >= 0.1
[PASS] CVD separation      worst adjacent #eda100↔#1baf7a ΔE 9.1 (protan)
[PASS] Normal-vision floor worst adjacent #e87ba4↔#eda100 ΔE 19.6
[WARN] Contrast vs surface #1baf7a 2.69, #eda100 2.07, #e87ba4 2.58 — 완화책 필수
```

**슬롯 순서 자체가 색각 안전장치다.** 카테고리를 추가하거나 순서를 바꿀 때는 반드시 검증기를 다시 돌리고 통과하는 배열 중에서 고른다.

contrast WARN에 대한 완화책(relief): 이 색들은 항상 **텍스트 라벨과 함께** 등장한다 — 도넛에는 범례, 비교 표에는 카테고리 이름 컬럼. 색만으로 정보를 전달하는 지점은 없다.

### 1.2 확정 색상값

| 카테고리 | slug | mark (도넛·막대·점) | tint (태그 배경) | ink (태그 텍스트) | ink/tint 대비 |
|---|---|---|---|---|---|
| 숙박 | `lodging` | `#2a78d6` | `#e5f1ff` | `#0052ac` | 6.55 |
| 식비 | `food` | `#eb6834` | `#ffeae2` | `#9e1c00` | 6.92 |
| 장보기 | `grocery` | `#1baf7a` | `#e4f5ec` | `#006b3c` | 5.86 |
| 교통비 | `transport` | `#eda100` | `#fbeede` | `#864100` | 6.64 |
| 놀이 | `play` | `#e87ba4` | `#feeaf0` | `#8e2956` | 7.01 |
| 기타 | `etc` | `#4a3aa7` | `#edeeff` | `#4e3fad` | 6.93 |

tint/ink는 각 mark 색상의 OKLCH 색상각을 유지한 채 명도만 옮긴 값이다 (tint: L 0.955 / 채도 0.16배, ink: L 0.45에서 시작해 tint 대비 4.5:1을 넘길 때까지 하강). 전 조합이 WCAG AA(4.5:1)를 통과한다.

태그를 원색으로 칠하지 않고 틴트+잉크로 가는 이유는 두 가지다. 하나는 원색 배경 위 텍스트가 대비를 못 맞추는 색(`#eda100` 등)이 있다는 것, 다른 하나는 종이 질감의 기존 디자인에 원색 블록이 6개 깔리면 시각적으로 과하다는 것이다. 원색은 데이터 마크(도넛 세그먼트, 편차 막대, 범례 점)에만 쓴다.

### 1.3 공용 모듈 — `public/categories.js` (신규)

현재 `CATEGORIES` 배열이 `views/member.js`와 `views/admin.js`에 중복 선언돼 있고 색상은 `views/report.js`에만 있다. 한 모듈로 모은다.

```js
export const CATEGORIES = ['숙박', '식비', '장보기', '교통비', '놀이', '기타'];
export const CATEGORY_META = {
  숙박:   { slug: 'lodging',   mark: '#2a78d6' },
  // ...
};
export function categorySlug(category)  // 미등록 카테고리는 'etc'
export function categoryMark(category)  // 미등록 카테고리는 기타 색
export function categoryTag(category)   // '<span class="tag" data-cat="food">식비</span>'
export function categoryDot(category)   // '<span class="cat-dot" style="background:...">'
```

`categoryTag`는 카테고리명을 이스케이프해서 넣는다. 카테고리는 서버가 검증하는 고정 목록이지만, 과거 데이터에 목록 밖 값이 들어 있어도 안전하게 렌더링돼야 한다 (미등록 값은 `etc` 슬롯으로 폴백).

백엔드 `functions/src/lib/categories.js`의 `CATEGORIES`는 그대로 둔다. 프론트/백엔드는 빌드 파이프라인 없이 각각 ESM/CJS로 돌아가므로 물리적 공유가 불가능하다. 대신 두 목록이 어긋나면 잡히도록 프론트 테스트에 목록 상수를 하드코딩한 검증을 둔다.

### 1.4 적용 지점

| 위치 | 현재 | 변경 |
|---|---|---|
| `views/report.js` 지출 표 | `<span class="tag">${e.category}</span>` | `categoryTag(e.category)` |
| `views/report.js` 정산 상세 모달 | 동일 | 동일 |
| `views/member.js` 경비 카드 | 동일 | 동일 |
| `views/admin.js` 경비 카드 | 동일 | 동일 |
| 카테고리 선택 칩 (`renderChipGroup`) | 텍스트만 | 앞에 색 점 추가 |

`renderChipGroup`은 `ui.js`의 범용 함수다. 카테고리 전용 로직을 넣지 않고, 5번째 인자로 선택적 옵션 객체 `{ dotColor }`를 받도록 확장한다. `dotColor`는 **옵션 하나를 받아 색 문자열(또는 null)을 돌려주는 함수**이며, 호출부(member.js, admin.js)가 `categoryMark`를 그대로 넘긴다. 생략하면 기존과 동일하게 텍스트만 렌더한다 — 기존 호출부는 수정 없이 동작한다.

`views/index.js:43`의 `<span class="tag">${t.group}</span>`은 여행 그룹명이지 카테고리가 아니므로 그대로 둔다.

### 1.5 CSS

```css
.tag { /* 기존 유지 — data-cat 없는 태그의 기본값 */ }
.tag[data-cat="lodging"]   { background: #e5f1ff; color: #0052ac; }
/* ... 6종 */
.cat-dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex:none; }
```

---

## 2. 날짜 표기

### 2.1 `public/format.js` (신규)

```js
export function formatDate(iso)  // '2026-07-30' -> '7.30'
```

- `YYYY-MM-DD` 형태가 아니면 입력을 그대로 반환한다 (과거 데이터 방어).
- 월/일의 선행 0을 제거한다: `2026-07-05` → `7.5`.
- falsy 입력은 빈 문자열.

### 2.2 적용 지점

- `views/report.js:234` — 지출 표 날짜 셀
- `views/member.js:86` — 경비 카드
- `views/admin.js:246` — 경비 카드

`<input type="date">`의 value(member.js:214, admin.js:427 등)는 ISO 형식이어야 하므로 건드리지 않는다.

---

## 3. 전체 지출 내역 표 — 밀도/줄바꿈

### 3.1 문제

현재 표는 전부 인라인 style이고 셀에 줄바꿈 제어가 없다. 모바일 폭에서:
- 결제자 이름이 2~3글자여도 컬럼이 좁아 접힌다
- `1,234,567원`에서 `원`만 다음 줄로 떨어진다

### 3.2 해결 — `.expense-table` 클래스

```css
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

핵심은 날짜·결제자·금액 세 컬럼에 `nowrap`을 걸고 **내용 컬럼만 유연하게 두는 것**이다. 브라우저 자동 테이블 레이아웃이 nowrap 컬럼에 최소 콘텐츠 폭을 배정하고 남은 폭을 내용 컬럼이 흡수하므로, 이름 길이와 무관하게 결제자는 한 줄로 남는다.

결제자에 `max-width` + ellipsis를 쓰지 않는다: 4글자 이름이 `홍길동…`으로 잘리는 것이 2줄로 접히는 것보다 나쁘다.

`overflow-x:auto` 래퍼는 유지한다 — 초협소 화면에서 최후의 안전망.

---

## 4. 여행사진

### 4.1 다중 선택 업로드

`views/report.js`의 사진 섹션을 `views/tripPhotos.js`로 분리하면서 구현한다.

- `<input type="file" multiple accept="image/jpeg,image/png">`
- 선택된 파일을 **순차** 처리 (병렬이면 모바일에서 메모리·네트워크가 터진다). 파일마다: 리사이즈 → `addTripPhoto` 호출.
- 진행 표시: 버튼 텍스트 `올리는 중 3/8...`
- **개별 실패가 전체를 중단시키지 않는다.** 실패를 카운트하고 나머지를 계속 올린다.
- 종료 후 결과 토스트:
  - 전부 성공 → `8장이 추가되었습니다` (success)
  - 일부 실패 → `8장 중 6장 업로드 (2장 실패)` (error)
  - 전부 실패 → 마지막 에러 메시지 (error)
- 갤러리 새로고침은 루프가 끝난 뒤 **한 번만**. 매 장마다 `listTripPhotos`를 부르면 N번 왕복한다.
- 완료 후 `input.value = ''` — 같은 파일 재선택이 가능해야 한다.

### 4.2 클라이언트 리사이즈 — `public/imageResize.js` (신규)

```js
export function fitWithin(width, height, maxEdge)  // 순수 함수 — 테스트 대상
export async function resizeImageFile(file, maxEdge = 1024)  // -> { base64, mimeType }
```

`fitWithin`:
- 긴 변이 `maxEdge` 이하면 원본 치수를 그대로 반환 (확대하지 않는다)
- 아니면 비율 유지 축소, 결과는 `Math.round`, 최소 1px 보장

`resizeImageFile`:
- `createImageBitmap(file, { imageOrientation: 'from-image' })` — EXIF 회전을 반영한다. 세로로 찍은 폰 사진이 눕는 문제를 여기서 막는다.
- canvas에 그린 뒤 `toBlob('image/jpeg', 0.85)`
- 출력 MIME은 **항상 `image/jpeg`**. PNG 사진은 용량이 과하고, 백엔드 `ALLOWED_MIME_TYPES`가 jpeg/png 둘 다 허용하므로 jpeg 고정이 안전하다.
- 크기가 이미 1024 이하여도 동일 경로를 탄다. 분기를 늘리지 않고 출력을 예측 가능하게 유지하기 위함이며, 작은 JPEG의 q0.85 재인코딩 손실은 눈에 띄지 않는다.
- `createImageBitmap`이 없는 환경에서는 `Image` + `URL.createObjectURL` 폴백을 쓴다.

**테스트 전략**: canvas/ImageBitmap은 jsdom에 없다. `fitWithin`(순수 계산)만 단위 테스트하고, `resizeImageFile`은 얇은 어댑터로 유지해 테스트 대상에서 제외한다.

리사이즈 실패 시 원본으로 폴백하지 **않는다** — 원본 업로드는 사용자가 요청한 1024 상한을 어기는 것이므로 해당 파일을 실패로 집계한다.

### 4.3 고정 프레임 라이트박스

```css
.tp-frame {
  aspect-ratio: 1 / 1; width: 100%;
  background: var(--paper-2); border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.tp-frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
```

정사각을 고른 근거 — 모달 폭 440px(패딩 제외 약 390px) 기준:

| 프레임 | 가로 4:3 사진 | 세로 3:4 사진 |
|---|---|---|
| `4/3` | 390×293 | 220×293 |
| `1/1` | 390×293 | 293×390 |

세로 사진의 최악 케이스가 크게 개선된다. 이미지 높이가 항상 프레임 높이로 고정되므로 아래의 이전/다음/삭제 버튼은 사진 방향에 관계없이 같은 위치에 머문다 — 요청의 핵심.

썸네일 그리드도 인라인 style에서 CSS 클래스로 옮긴다 (`.tp-grid`, `.tp-thumb` — 90px 정사각 `object-fit: cover`, 현재 동작 유지).

### 4.4 `views/tripPhotos.js` (신규)

`views/report.js`에서 사진 관련 코드(약 70줄)와 모듈 스코프 `tripPhotosCache`를 옮긴다.

```js
export function renderTripPhotosInto(container, tripId)
```

컨테이너 마크업 생성 + 업로드 핸들러 바인딩 + 갤러리 로드까지 담당한다. report.js는 섹션 자리만 만들고 이 함수를 호출한다.

캐시는 모듈 스코프 대신 `renderTripPhotosInto` 클로저 안으로 넣는다 — 현재 구조는 두 화면이 동시에 렌더될 경우 캐시가 섞인다.

---

## 5. 카테고리 분석 재설계

### 5.1 백엔드 — 1인·하루 기준 정규화

`functions/src/functions/report.js`

```js
function tripDays(period)  // end - start + 1, 유효하지 않으면 null
```

- `period.start` / `period.end`가 `YYYY-MM-DD`가 아니거나 `end < start`면 `null`
- UTC 기준으로 일수를 계산한다 (타임존에 따라 하루가 밀리면 안 된다)

`getReportData` 반환값 변경:

| 필드 | 상태 | 의미 |
|---|---|---|
| `tripDays` | 신규 | 이번 여행 일수, 기간 미설정 시 `null` |
| `currentCategoryPerDay` | 신규 | 카테고리별 1인·하루 분담액 |
| `groupCategoryPerDayAverages` | 신규 | 과거 완료 여행들의 같은 값 평균 |
| `tripsInComparison` | 의미 변경 | **유효한 기간을 가진** 비교 대상 여행 수 |
| `currentCategoryAverages` | 제거 | 하루 기준으로 대체됨 |
| `groupCategoryAverages` | 제거 | 하루 기준으로 대체됨 |

여행 전체 ±금액은 `하루 편차 × tripDays`로 프론트에서 유도되므로 총액 필드를 따로 보낼 필요가 없다. 두 필드 모두 페이로드에서 뺀다.

계산:
- `currentCategoryPerDay[c] = (1인 카테고리 총 분담액) / tripDays`
- 과거 여행 각각에 대해 `perPersonCategoryAverage(...)[c] / tripDays(그 여행의 period)`를 구하고, 카테고리별로 평균낸다
- 기간이 유효하지 않은 과거 여행은 **비교에서 완전히 제외**한다 (합계에도, `tripsInComparison`에도 안 들어감)
- 현재 여행의 `tripDays`가 `null`이면 `currentCategoryPerDay`는 빈 객체, `tripsInComparison`은 0

`perPersonCategoryAverage`는 시그니처를 바꾸지 않는다 (기존 테스트가 직접 호출한다). 하루 나눗셈은 `getReportData`에서 수행한다.

### 5.2 프론트 — 비교 표

`public/charts.js` (신규)로 `renderDonutChart` + 신규 `renderCategoryComparison`을 옮긴다.

```
카테고리 비교                              하루 · 1인 기준
──────────────────────────────────────────────────────────
 카테고리     이번      그룹평균      편차        여행 전체
──────────────────────────────────────────────────────────
 ● 숙박     42,000    35,000   ███▶ +20%     +21,000원
 ● 식비     28,000    31,000  ◀██     -10%     -9,000원
 ● 장보기    9,000     8,000     █▶ +13%      +3,000원
 ● 교통비   12,000    18,000 ◀████   -33%    -18,000원
                              │
                            0 기준
```

- **모든 금액은 `Math.round()`** 후 `toLocaleString()`. 소수점 노출 제거.
- `편차 %` = `round((이번 − 그룹평균) / 그룹평균 × 100)`
- `여행 전체 ±금액` = `round((이번 하루 − 그룹평균 하루) × tripDays)` — 1인 기준
- 그룹 평균이 `0`이거나 없는 카테고리는 % 계산이 불가하므로 편차/±금액 셀에 `—`를 넣고 막대를 그리지 않는다.
- 모바일(≤480px)에서 `그룹평균` 컬럼을 `display:none`으로 숨긴다. 이번 값과 편차만으로 판단이 되고, 4컬럼이면 폭이 확보된다.

**편차 막대의 색 규칙** — 방향을 색으로 표시하지 않는다.

| 후보 | 검증 결과 |
|---|---|
| 초록↔빨강 (`--receive`/`--pay`) | CVD ΔE 5.5 — FAIL |
| 상태색 good↔critical | CVD ΔE 4.1 — FAIL |
| 파랑↔빨강 (레퍼런스 표준쌍) | 통과하나 파랑이 숙박 카테고리 색과 충돌 |

채택: **막대 색 = 해당 카테고리의 mark 색** (점·도넛과 동일), **중앙 0선 기준 방향 = 초과/절감**, **부호 붙은 숫자 = 크기**. 색은 정체성만 담당하고 극성은 위치가 담당하는 구조라 색각이상과 무관하게 읽힌다. `+20%` / `−9,000원` 텍스트에는 기존 `--receive`/`--pay` 색을 유지한다 (부호가 이미 붙어 있으므로 색은 보조 채널).

막대 구현은 SVG 없이 CSS로 한다 — 폭 50% 지점에 0선을 두고, 절대값 비율만큼 좌/우로 뻗는 `div`. 정규화 기준은 **표에 표시되는 행들의 편차 % 절대값 중 최대값**이며(금액이 아니라 %), 그 행이 반쪽 폭을 꽉 채운다. 편차가 0이 아닌데 반올림으로 폭이 0이 되는 행은 최소 2px를 그려 "변화 없음"과 구분한다.

### 5.3 도넛

유지하되 다음을 적용한다.
- 새 팔레트 사용
- 세그먼트 사이 2px surface gap (dataviz 마크 규격)
- 범례에 정수 % 추가: `숙박 · 420,000원 · 34%`
- 범례 점은 `categoryDot` 재사용

### 5.4 기간 미설정 폴백

`tripDays === null`이면 비교 표 대신 안내 문구를 띄운다:

> 여행 기간이 설정되지 않아 하루 기준 비교를 계산할 수 없습니다.

도넛은 기간과 무관하므로 그대로 표시한다.

`tripsInComparison === 0`이면 기존 문구 유지: `비교할 과거 여행이 아직 없습니다.`

---

## 6. 파일 구조

`views/report.js`가 18KB에 리포트 조합·지출 표·도넛·비교·결제자 요약·정산·여행사진을 모두 담고 있다. 이번에 손대는 범위에 맞춰 분리한다.

| 파일 | 상태 | 책임 |
|---|---|---|
| `public/categories.js` | 신규 | 카테고리 목록/색상/태그·점 렌더 |
| `public/format.js` | 신규 | `formatDate` |
| `public/imageResize.js` | 신규 | `fitWithin`, `resizeImageFile` |
| `public/charts.js` | 신규 | `renderDonutChart`, `renderCategoryComparison` |
| `public/views/tripPhotos.js` | 신규 | 갤러리 + 다중 업로드 + 라이트박스 |
| `public/views/report.js` | 축소 | 리포트 조합, 지출 표, 결제자 요약, 정산 |
| `public/ui.js` | 수정 | `renderChipGroup`에 `dotColor` 옵션 |
| `public/style.css` | 수정 | 태그 색상, `.expense-table`, `.tp-*`, `.cmp-*` |

관련 없는 리팩터링(정산 로직 분리 등)은 하지 않는다.

---

## 7. 테스트

### 신규

| 파일 | 대상 |
|---|---|
| `public/test/format.test.js` | `formatDate` — 정상/선행 0/빈 값/비ISO 폴백 |
| `public/test/categories.test.js` | slug·mark 매핑, 미등록 카테고리 폴백, `categoryTag` 이스케이프, 백엔드 목록과의 일치 |
| `public/test/imageResize.test.js` | `fitWithin` — 축소/확대 안 함/정사각/극단 비율/0 방어 |

### 수정

| 파일 | 추가 검증 |
|---|---|
| `functions/test/functions/report.test.js` | `tripDays` 계산, 하루 기준 정규화, 기간 없는 과거 여행 제외, 현재 여행 기간 없을 때 `tripDays: null`, 기존 `groupCategoryAverages` 참조 제거 |
| `public/test/ui.test.js` | `renderChipGroup`의 `dotColor` 옵션 |

라이트박스 프레임과 표 줄바꿈은 CSS이므로 단위 테스트 대상이 아니다. 구현 후 실제 브라우저에서 가로/세로 사진 혼재 및 모바일 폭(375px)으로 육안 확인한다.

---

## 8. 리스크

| 리스크 | 대응 |
|---|---|
| `createImageBitmap` 미지원 브라우저 | `Image` + objectURL 폴백 |
| 다중 업로드 중 세션 만료 | 개별 실패로 집계되고 나머지는 계속 시도, 결과 토스트에 실패 수 표시 |
| 과거 데이터에 목록 밖 카테고리 존재 | `categorySlug`/`categoryMark`가 `etc`로 폴백 |
| 과거 여행 다수가 기간 미설정 | 비교 대상에서 빠져 `tripsInComparison`이 0이 되고 기존 안내 문구로 처리됨 |
| 프론트/백엔드 카테고리 목록 불일치 | 프론트 테스트가 목록을 하드코딩해 검증 |
