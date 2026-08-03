import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWaypoints, serpentineLayout, NODE_R } from '../routeMap.js';

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

  test('NODE_R을 export한다', () => {
    assert.equal(NODE_R, 14);
  });
});
