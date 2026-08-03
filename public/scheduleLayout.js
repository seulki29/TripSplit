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
