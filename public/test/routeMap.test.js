import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWaypoints, serpentineLayout, renderRouteMap } from '../routeMap.js';

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
});

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

  test('카테고리 색은 테두리(stroke)로만 쓰이고 채움(fill) 속성으로는 쓰이지 않는다', () => {
    // 카테고리 색으로 채우고 흰 번호를 얹으면 6색 중 5색이 4.5:1에 미달한다.
    // 채움은 style.css의 .rm-node { fill: var(--paper); } 가 담당한다 -- var()는
    // SVG presentation attribute 문법에서 유효한 paint 값이 아니라서 fill 속성으로
    // 직접 넣으면 무시되고 SVG 초기값인 검정으로 떨어진다(그러면 번호가 안 보인다).
    // 그래서 fill 속성 자체가 없어야 한다.
    const html = renderRouteMap(one, opts);
    assert.ok(html.includes('stroke="#e87ba4"'), '놀이 색이 테두리여야 한다');
    assert.ok(!html.includes('fill="#e87ba4"'), '카테고리 색으로 채우면 안 된다');
    assert.ok(!html.includes('fill="var(--paper)"'), '채움을 attribute로 넣으면 안 된다 -- CSS에서 와야 한다');
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

  // 행 변경 연결선을 직선으로 그리면 cx가 양쪽에서 같으므로 위 노드의 라벨과
  // 아래 노드의 날짜 칩을 그대로 관통한다. 곡선(path + C 커맨드)이어야 한다.
  test('행이 바뀌는 연결선은 곡선(path)이고, 같은 행 안 연결선은 직선(line)이다', () => {
    // A-B, B-C는 같은 행(PER_ROW=3)이라 직선, C-D는 다음 행으로 넘어가 곡선이다.
    const html = renderRouteMap([
      { label: 'A', category: '기타', date: '2026-08-10' },
      { label: 'B', category: '기타', date: '2026-08-10' },
      { label: 'C', category: '기타', date: '2026-08-10' },
      { label: 'D', category: '기타', date: '2026-08-10' },
    ], opts);
    const lines = html.match(/<line class="rm-link"/g) || [];
    const curves = html.match(/<path class="rm-link" d="[^"]*\bC\b[^"]*"/g) || [];
    assert.equal(lines.length, 2, 'A-B, B-C는 직선이어야 한다');
    assert.equal(curves.length, 1, 'C-D는 곡선(C 커맨드가 있는 path)이어야 한다');
  });

  test('행이 바뀌는 연결선은 캔버스 중심에서 먼 쪽으로 부푼다', () => {
    // 7개면 0행(왼→오), 1행(오→왼), 2행(왼→오)이 생기고 행 변경이 둘 일어난다:
    // 2→3은 cx=250(오른쪽 끝)이라 오른쪽으로, 5→6은 cx=50(왼쪽 끝)이라 왼쪽으로
    // 부풀어야 한다. 좌표는 리뷰에서 실측한 값과 같다(연결선 y는 59~121).
    const html = renderRouteMap(
      Array.from({ length: 7 }, (_, i) => ({ label: `P${i}`, category: '기타', date: '2026-08-10' })),
      opts,
    );
    const ds = [...html.matchAll(/<path class="rm-link" d="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(ds.length, 2, '행 변경 연결선이 둘이어야 한다');
    assert.equal(ds[0], 'M250 59 C 284 59, 284 121, 250 121', '오른쪽 끝은 오른쪽으로 부풀어야 한다');
    assert.equal(ds[1], 'M50 149 C 16 149, 16 211, 50 211', '왼쪽 끝은 왼쪽으로 부풀어야 한다');
  });
});
