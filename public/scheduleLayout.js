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
