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

  test('캔버스 폭은 336으로 고정', () => {
    assert.equal(serpentineLayout(waypoints(5)).width, 336);
  });

  test('0행은 좌에서 우로, 한 행에 4개', () => {
    const { nodes } = serpentineLayout(waypoints(4));
    assert.deepEqual(nodes.map((n) => n.cx), [48, 128, 208, 288]);
    assert.deepEqual(nodes.map((n) => n.cy), [52, 52, 52, 52]);
  });

  // 지그재그의 핵심. 1행은 방향이 뒤집혀 오른쪽 끝에서 시작한다.
  test('1행은 우에서 좌로', () => {
    const { nodes } = serpentineLayout(waypoints(8));
    assert.deepEqual(nodes.slice(4).map((n) => n.cx), [288, 208, 128, 48]);
    assert.deepEqual(nodes.slice(4).map((n) => n.cy), [140, 140, 140, 140]);
  });

  test('5번째 노드는 1행 오른쪽 끝, 4번째 바로 아래', () => {
    const { nodes } = serpentineLayout(waypoints(5));
    assert.equal(nodes[4].cx, 288);
    assert.equal(nodes[3].cx, 288);
    assert.equal(nodes[4].row, 1);
  });

  test('9번째 노드는 2행 왼쪽 끝, 8번째 바로 아래', () => {
    const { nodes } = serpentineLayout(waypoints(9));
    assert.equal(nodes[8].cx, 48);
    assert.equal(nodes[7].cx, 48);
    assert.equal(nodes[8].cy, 228);
  });

  // 높이는 마지막 행의 앵커에서 라벨 두 줄 아래까지만 잡는다. 한 행짜리
  // 지도 밑에 빈 행 하나만큼의 여백이 남지 않도록.
  test('높이는 행 수에 비례하되 마지막 행은 라벨까지만', () => {
    assert.equal(serpentineLayout(waypoints(1)).height, 84);
    assert.equal(serpentineLayout(waypoints(4)).height, 84);
    assert.equal(serpentineLayout(waypoints(5)).height, 172);
    assert.equal(serpentineLayout(waypoints(9)).height, 260);
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
    assert.ok(html.includes('viewBox="0 0 336 84"'));
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

  // 예전엔 카테고리 색을 테두리로만 썼다. 핀 안에 흰 번호가 있었고, 그 색으로
  // 채우면 6색 중 5색이 4.5:1에 미달했기 때문이다. 번호가 없어지면서 그 제약이
  // 풀렸고, 이제 색이 면적을 갖는다.
  test('카테고리 색이 핀의 채움(fill)이다', () => {
    const html = renderRouteMap(one, opts);
    assert.ok(html.includes('fill="#e87ba4"'), '놀이 색으로 채워야 한다');
    assert.ok(!html.includes('stroke="#e87ba4"'), '테두리로 쓰면 안 된다');
  });

  test('뚫린 구멍의 색은 attribute가 아니라 CSS에서 온다', () => {
    // var()는 SVG presentation attribute 문법에서 유효한 paint 값이 아니다.
    // fill="var(--paper)" 로 넣으면 무시되고 SVG 초기값인 검정으로 떨어져서,
    // 구멍이 뚫린 게 아니라 검은 점이 찍힌 것처럼 보인다.
    const html = renderRouteMap(one, opts);
    assert.ok(html.includes('class="rm-hole"'), '구멍 요소가 있어야 한다');
    assert.ok(!html.includes('fill="var('), 'var()를 attribute로 넣으면 안 된다');
  });

  // 번호는 뺐다. 선이 이미 무엇과 무엇이 이어지는지 보여준다.
  test('핀에 번호를 넣지 않는다', () => {
    const html = renderRouteMap([
      { label: 'A', category: '기타', date: '2026-08-10' },
      { label: 'B', category: '기타', date: '2026-08-10' },
    ], opts);
    assert.ok(!html.includes('>1</text>'));
    assert.ok(!html.includes('>2</text>'));
    assert.ok(!html.includes('rm-num'));
  });

  test('장소명을 이스케이프한다', () => {
    const html = renderRouteMap([{ label: '<script>x</script>', category: '기타', date: '2026-08-10' }], opts);
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  // 셀 폭이 80단위라 3개씩 놓던 때보다 라벨이 일찍 접힌다.
  test('6자 이하는 한 줄', () => {
    const html = renderRouteMap([{ label: '성산일출봉', category: '기타', date: '2026-08-10' }], opts);
    assert.ok(html.includes('>성산일출봉</tspan>'));
  });

  test('7~12자는 두 줄로 쪼갠다', () => {
    const html = renderRouteMap([{ label: '켄싱턴리조트평창', category: '기타', date: '2026-08-10' }], opts);
    assert.ok(html.includes('>켄싱턴리조트</tspan>'));
    assert.ok(html.includes('>평창</tspan>'));
  });

  test('12자를 넘으면 말줄임표', () => {
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

  // 마커마다 선을 끊었다 다시 시작하면 "핀과 핀을 잇는 선"으로 읽힌다. 앵커를
  // 전부 통과하는 path 하나를 먼저 깔고 그 위에 핀을 얹어야 "선 위에 핀이
  // 꽂힌" 그림이 된다. 그래서 연결선 요소는 노드 수와 무관하게 항상 하나다.
  const routePath = (html) => (html.match(/<path class="rm-link" d="([^"]*)"/) || [])[1];

  test('연결선은 노드가 몇 개든 path 하나다', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `P${i}`, category: '기타', date: '2026-08-10' }));
    const html = renderRouteMap(many, opts);
    assert.equal((html.match(/class="rm-link"/g) || []).length, 1);
  });

  test('노드가 하나면 연결선이 없다', () => {
    const html = renderRouteMap(one, opts);
    assert.equal((html.match(/class="rm-link"/g) || []).length, 0);
  });

  test('연결선이 모든 앵커를 지난다', () => {
    // 한 행에 4개이므로 5개면 0행 넷 + 1행 하나. 같은 행 안은 L, 행이 바뀔 때만 C.
    const html = renderRouteMap(
      Array.from({ length: 5 }, (_, i) => ({ label: `P${i}`, category: '기타', date: '2026-08-10' })),
      opts,
    );
    assert.equal(routePath(html), 'M48 52 L128 52 L208 52 L288 52 C347 52, 347 140, 288 140');
  });

  test('행이 바뀌는 구간은 캔버스 중심에서 먼 쪽으로 부푼다', () => {
    // 9개면 행 변경이 둘 일어난다: 3→4는 cx=288(오른쪽 끝)이라 오른쪽으로,
    // 7→8은 cx=48(왼쪽 끝)이라 왼쪽으로 부풀어야 다음 행 핀을 비껴간다.
    // 제어점 x는 캔버스 밖(-11)까지 나가지만 곡선 자체는 3.75까지만 간다 --
    // 단일 3차 베지어는 현에서 0.75*k 만큼만 부푼다.
    const html = renderRouteMap(
      Array.from({ length: 9 }, (_, i) => ({ label: `P${i}`, category: '기타', date: '2026-08-10' })),
      opts,
    );
    const d = routePath(html);
    assert.ok(d.includes('C347 52, 347 140, 288 140'), '오른쪽 끝은 오른쪽으로 부풀어야 한다');
    assert.ok(d.includes('C-11 140, -11 228, 48 228'), '왼쪽 끝은 왼쪽으로 부풀어야 한다');
  });

  // 핀 끝이 앵커에 놓이고 풍선이 그 위로 뜬다 -- 선이 앵커를 지나가므로
  // "선에 꽂힌 핀"으로 읽힌다. 원이 선 위에 얹혀 있던 이전 모양과 다르다.
  test('마커는 원이 아니라 끝점이 앵커에 놓인 핀이다', () => {
    const html = renderRouteMap(one, opts);
    const pin = (html.match(/<path class="rm-node" d="([^"]*)"/) || [])[1];
    assert.ok(pin, '핀 path가 있어야 한다');
    assert.ok(pin.startsWith('M48 52'), `핀이 앵커(48,52)에서 시작해야 한다: ${pin}`);
    assert.ok(pin.includes('A12 12'), '풍선이 반지름 12 호여야 한다');
    assert.ok(pin.trim().endsWith('Z'), '닫힌 도형이어야 한다');
  });

  // 옆면이 풍선의 가장 넓은 지점(cx±R, 풍선 중심 높이)에서 수직으로 내려와야
  // 배가 생긴다. 접선을 중간에 걸면 몸통이 홀쭉해진다.
  test('핀 옆면이 풍선의 가장 넓은 지점에서 시작한다', () => {
    const html = renderRouteMap(one, opts);
    const pin = (html.match(/<path class="rm-node" d="([^"]*)"/) || [])[1];
    // 풍선 중심 y = 52 - 21.6 = 30.4, 좌우 끝은 x = 48 ∓ 12
    assert.ok(pin.includes('36 30.4'), `왼쪽 끝이 (36, 30.4)여야 한다: ${pin}`);
    assert.ok(pin.includes('60 30.4'), `오른쪽 끝이 (60, 30.4)여야 한다: ${pin}`);
  });

  test('구멍은 풍선 중심에 놓인다', () => {
    const html = renderRouteMap(one, opts);
    // 앵커 52에서 PIN_H(21.6)만큼 위 -> 30.4. 반지름은 0.45 * 12 = 5.4.
    assert.ok(html.includes('<circle class="rm-hole" cx="48" cy="30.4" r="5.4">'), html);
  });
});
