import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { minToLabel, labelToMin, mapLinkFor, assignLanes, timeRangeFor, groupByDate } from '../scheduleLayout.js';

describe('minToLabel', () => {
  test('자정 기준 분을 HH:MM으로 바꾼다', () => {
    assert.equal(minToLabel(0), '00:00');
    assert.equal(minToLabel(660), '11:00');
    assert.equal(minToLabel(795), '13:15');
  });

  test('한 자리 시/분에 0을 채운다', () => {
    assert.equal(minToLabel(65), '01:05');
  });

  // 시간축의 마지막 눈금이 1440까지 올라갈 수 있다. '00:00'으로 적으면
  // 축이 자정으로 되감긴 것처럼 보인다.
  test('1440은 24:00으로 표시한다', () => {
    assert.equal(minToLabel(1440), '24:00');
  });

  test('null과 undefined는 빈 문자열', () => {
    assert.equal(minToLabel(null), '');
    assert.equal(minToLabel(undefined), '');
  });
});

describe('labelToMin', () => {
  test('HH:MM을 분으로 바꾼다', () => {
    assert.equal(labelToMin('11:00'), 660);
    assert.equal(labelToMin('00:00'), 0);
    assert.equal(labelToMin('13:15'), 795);
  });

  test('minToLabel과 왕복한다', () => {
    for (const m of [0, 65, 660, 795, 1439]) {
      assert.equal(labelToMin(minToLabel(m)), m);
    }
  });

  test('형식에 맞지 않으면 null', () => {
    assert.equal(labelToMin(''), null);
    assert.equal(labelToMin('11'), null);
    assert.equal(labelToMin('abc'), null);
    assert.equal(labelToMin(null), null);
  });

  test('범위를 벗어난 시/분은 null', () => {
    assert.equal(labelToMin('25:00'), null);
    assert.equal(labelToMin('11:70'), null);
  });
});

describe('mapLinkFor', () => {
  test('장소명을 카카오맵 검색 링크로 만든다', () => {
    assert.equal(
      mapLinkFor('켄싱턴리조트평창'),
      'https://map.kakao.com/?q=%EC%BC%84%EC%8B%B1%ED%84%B4%EB%A6%AC%EC%A1%B0%ED%8A%B8%ED%8F%89%EC%B0%BD',
    );
  });

  test('공백을 인코딩한다', () => {
    assert.equal(mapLinkFor('제주 공항'), 'https://map.kakao.com/?q=%EC%A0%9C%EC%A3%BC%20%EA%B3%B5%ED%95%AD');
  });

  test('http(s) URL은 그대로 통과시킨다', () => {
    assert.equal(mapLinkFor('https://map.kakao.com/?itemId=123'), 'https://map.kakao.com/?itemId=123');
    assert.equal(mapLinkFor('http://naver.me/abc'), 'http://naver.me/abc');
  });

  // 사용자가 붙여넣은 문자열이 그대로 href가 되므로, 스킴 검사를 통과하지
  // 못한 것은 전부 검색어로 취급되어야 한다.
  test('위험한 스킴은 URL로 취급하지 않는다', () => {
    const link = mapLinkFor('javascript:alert(1)');
    assert.ok(link.startsWith('https://map.kakao.com/?q='));
    assert.ok(!link.startsWith('javascript:'));
  });

  test('빈 값은 null', () => {
    assert.equal(mapLinkFor(''), null);
    assert.equal(mapLinkFor('   '), null);
    assert.equal(mapLinkFor(null), null);
    assert.equal(mapLinkFor(undefined), null);
  });

  test('앞뒤 공백을 없앤다', () => {
    assert.equal(mapLinkFor('  성산  '), mapLinkFor('성산'));
  });
});

// 테스트를 읽기 쉽게 하는 헬퍼. id는 결과를 지목할 때만 쓴다.
function e(id, startMin, endMin) {
  return { id, startMin, endMin };
}

function laneOf(result, id) {
  return result.find((r) => r.entry.id === id);
}

describe('assignLanes', () => {
  test('빈 입력은 빈 배열', () => {
    assert.deepEqual(assignLanes([]), []);
  });

  test('겹치지 않으면 전부 lane 0, laneCount 1', () => {
    const result = assignLanes([e('a', 600, 660), e('b', 700, 760)]);
    assert.equal(result.length, 2);
    for (const r of result) {
      assert.equal(r.lane, 0);
      assert.equal(r.laneCount, 1);
    }
  });

  test('두 개가 겹치면 lane 0과 1, laneCount 2', () => {
    const result = assignLanes([e('a', 600, 720), e('b', 660, 780)]);
    assert.equal(laneOf(result, 'a').lane, 0);
    assert.equal(laneOf(result, 'b').lane, 1);
    assert.equal(laneOf(result, 'a').laneCount, 2);
    assert.equal(laneOf(result, 'b').laneCount, 2);
  });

  test('결과는 startMin 오름차순으로 나온다', () => {
    const result = assignLanes([e('late', 700, 760), e('early', 600, 660)]);
    assert.deepEqual(result.map((r) => r.entry.id), ['early', 'late']);
  });

  // 경계: 11:00-12:00과 12:00-13:00은 겹치지 않는다. 판정은
  // aStart < bEnd && bStart < aEnd 이므로 660 < 720 && 720 < 720 은 거짓.
  test('끝나는 시각과 시작하는 시각이 같으면 겹치지 않는다', () => {
    const result = assignLanes([e('a', 660, 720), e('b', 720, 780)]);
    assert.equal(laneOf(result, 'a').laneCount, 1);
    assert.equal(laneOf(result, 'b').laneCount, 1);
  });

  // 이게 핵심이다. 하루 전체의 최대 레인 수로 나누면, 오후에 3개가 겹쳤다는
  // 이유로 아침의 단독 일정까지 1/3 폭이 된다.
  test('클러스터마다 laneCount를 따로 센다', () => {
    const result = assignLanes([
      e('morning', 540, 600),                                  // 단독
      e('pm1', 800, 900), e('pm2', 810, 910), e('pm3', 820, 920), // 3중첩
    ]);
    assert.equal(laneOf(result, 'morning').laneCount, 1);
    assert.equal(laneOf(result, 'pm1').laneCount, 3);
    assert.equal(laneOf(result, 'pm2').laneCount, 3);
    assert.equal(laneOf(result, 'pm3').laneCount, 3);
  });

  test('비어난 레인을 재사용한다', () => {
    // a와 b가 겹치고, c는 a가 끝난 뒤 시작하지만 b와는 겹친다.
    // c는 새 레인이 아니라 a가 비운 레인 0으로 들어가야 한다.
    const result = assignLanes([e('a', 600, 660), e('b', 620, 800), e('c', 700, 780)]);
    assert.equal(laneOf(result, 'a').lane, 0);
    assert.equal(laneOf(result, 'b').lane, 1);
    assert.equal(laneOf(result, 'c').lane, 0);
    assert.equal(laneOf(result, 'c').laneCount, 2);
  });

  // 셋이 사슬처럼 이어지면 (a-b 겹침, b-c 겹침, a-c 안 겹침) 하나의
  // 클러스터이고 레인은 2개면 충분하다.
  test('사슬처럼 이어진 겹침은 한 클러스터', () => {
    const result = assignLanes([e('a', 600, 700), e('b', 650, 750), e('c', 720, 800)]);
    assert.equal(laneOf(result, 'a').laneCount, 2);
    assert.equal(laneOf(result, 'c').laneCount, 2);
    assert.equal(laneOf(result, 'c').lane, 0);
  });

  test('시작 시각이 같으면 긴 것이 먼저(lane 0)', () => {
    const result = assignLanes([e('short', 600, 630), e('long', 600, 720)]);
    assert.equal(laneOf(result, 'long').lane, 0);
    assert.equal(laneOf(result, 'short').lane, 1);
  });
});

describe('timeRangeFor', () => {
  test('시간이 있는 일정이 없으면 08:00-22:00', () => {
    assert.deepEqual(timeRangeFor([]), { fromMin: 480, toMin: 1320 });
    assert.deepEqual(
      timeRangeFor([{ startMin: null, endMin: null }]),
      { fromMin: 480, toMin: 1320 },
    );
  });

  test('기본 범위 안에 드는 일정만 있으면 범위가 그대로', () => {
    assert.deepEqual(timeRangeFor([e('a', 600, 720)]), { fromMin: 480, toMin: 1320 });
  });

  test('이른 일정이 있으면 아래로 시간 단위 내림', () => {
    // 06:30 시작 -> 06:00
    assert.equal(timeRangeFor([e('a', 390, 500)]).fromMin, 360);
  });

  test('늦은 일정이 있으면 위로 시간 단위 올림', () => {
    // 23:45 종료 -> 24:00
    assert.equal(timeRangeFor([e('a', 1300, 1425)]).toMin, 1440);
  });

  test('정각에 끝나면 더 올리지 않는다', () => {
    assert.equal(timeRangeFor([e('a', 1300, 1380)]).toMin, 1380);
  });

  test('시간이 null인 항목은 계산에서 빠진다', () => {
    const result = timeRangeFor([e('a', 600, 720), { startMin: null, endMin: null }]);
    assert.deepEqual(result, { fromMin: 480, toMin: 1320 });
  });
});

describe('groupByDate', () => {
  const period = { start: '2026-08-01', end: '2026-08-03' };

  test('기간의 모든 날짜를 일정이 없어도 낸다', () => {
    const result = groupByDate([], period);
    assert.deepEqual(result.dates, ['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  test('시간이 있는 일정은 timed 버킷', () => {
    const entry = { id: 'a', date: '2026-08-02', startMin: 600, endMin: 720 };
    const result = groupByDate([entry], period);
    assert.deepEqual(result.byDate['2026-08-02'].timed, [entry]);
    assert.deepEqual(result.byDate['2026-08-02'].untimed, []);
  });

  test('날짜만 있고 시간이 없으면 untimed 버킷', () => {
    const entry = { id: 'a', date: '2026-08-02', startMin: null, endMin: null };
    const result = groupByDate([entry], period);
    assert.deepEqual(result.byDate['2026-08-02'].untimed, [entry]);
    assert.deepEqual(result.byDate['2026-08-02'].timed, []);
  });

  test('날짜가 없으면 floating', () => {
    const entry = { id: 'a', date: null, startMin: null, endMin: null };
    const result = groupByDate([entry], period);
    assert.deepEqual(result.floating, [entry]);
  });

  // 관리자가 기간을 좁혔을 때 기간 밖으로 밀려난 일정이 화면에서 사라지면
  // 안 된다. 데이터는 남아 있는데 보이지 않는 상태가 최악이다.
  test('기간 밖 날짜의 일정도 날짜 목록에 넣는다', () => {
    const entry = { id: 'a', date: '2026-08-09', startMin: 600, endMin: 720 };
    const result = groupByDate([entry], period);
    assert.ok(result.dates.includes('2026-08-09'));
    assert.deepEqual(result.byDate['2026-08-09'].timed, [entry]);
  });

  test('날짜 목록은 정렬되어 있다', () => {
    const entries = [
      { id: 'a', date: '2026-07-30', startMin: 600, endMin: 720 },
      { id: 'b', date: '2026-08-09', startMin: 600, endMin: 720 },
    ];
    const result = groupByDate(entries, period);
    assert.deepEqual(result.dates, [
      '2026-07-30', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-09',
    ]);
  });

  test('기간이 비어도 일정 날짜만으로 동작한다', () => {
    const entry = { id: 'a', date: '2026-08-02', startMin: 600, endMin: 720 };
    assert.deepEqual(groupByDate([entry], null).dates, ['2026-08-02']);
    assert.deepEqual(groupByDate([entry], { start: null, end: null }).dates, ['2026-08-02']);
  });

  test('기간도 일정도 없으면 날짜 목록이 비어 있다', () => {
    const result = groupByDate([], null);
    assert.deepEqual(result.dates, []);
    assert.deepEqual(result.floating, []);
  });

  test('timed 버킷은 startMin 순으로 정렬된다', () => {
    const entries = [
      { id: 'late', date: '2026-08-01', startMin: 700, endMin: 760 },
      { id: 'early', date: '2026-08-01', startMin: 600, endMin: 660 },
    ];
    const result = groupByDate(entries, period);
    assert.deepEqual(result.byDate['2026-08-01'].timed.map((x) => x.id), ['early', 'late']);
  });
});
