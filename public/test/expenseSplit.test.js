import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { excludedFrom, groupSchedulesForPicker } from '../views/expenseSplit.js';

const members = [
  { id: 'm1', name: '가온' }, { id: 'm2', name: '나린' },
  { id: 'm3', name: '다솜' }, { id: 'm4', name: '라온' },
];

describe('excludedFrom', () => {
  test('전원 포함이면 제외가 없다', () => {
    assert.deepEqual(excludedFrom(members, ['m1', 'm2', 'm3', 'm4']), []);
  });

  test('아무도 포함하지 않으면 전원 제외', () => {
    assert.deepEqual(excludedFrom(members, []), ['m1', 'm2', 'm3', 'm4']);
  });

  test('일부만 포함하면 나머지가 제외된다', () => {
    assert.deepEqual(excludedFrom(members, ['m1', 'm3']), ['m2', 'm4']);
  });

  // 순서를 members 기준으로 고정한다. 체크한 순서에 따라 저장값이 달라지면
  // 같은 선택이 매번 다른 배열로 저장돼 diff가 무의미해진다.
  test('결과 순서는 members 순서를 따른다', () => {
    assert.deepEqual(excludedFrom(members, ['m4', 'm1']), ['m2', 'm3']);
  });

  // 구성원이 삭제된 뒤에도 옛 id가 남아 있을 수 있다.
  test('members에 없는 id가 들어와도 결과에 영향이 없다', () => {
    assert.deepEqual(excludedFrom(members, ['m1', 'ghost']), ['m2', 'm3', 'm4']);
  });

  test('빈 members는 빈 배열', () => {
    assert.deepEqual(excludedFrom([], ['m1']), []);
  });
});

function sched(over = {}) {
  return {
    id: 's1', title: '성산일출봉', category: '놀이',
    date: '2026-08-11', startMin: 660, participants: ['m1'], ...over,
  };
}

describe('groupSchedulesForPicker', () => {
  test('빈 입력은 빈 배열', () => {
    assert.deepEqual(groupSchedulesForPicker([]), []);
  });

  // 경비에는 날짜가 필요한데 "언젠가 갈 곳"에는 채울 날짜가 없다.
  test('date가 없는 일정은 빠진다', () => {
    assert.deepEqual(groupSchedulesForPicker([sched({ date: null })]), []);
  });

  test('날짜 오름차순으로 묶인다', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'b', date: '2026-08-12' }),
      sched({ id: 'a', date: '2026-08-10' }),
      sched({ id: 'c', date: '2026-08-11' }),
    ]);
    assert.deepEqual(groups.map((g) => g.date), ['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  test('같은 날짜는 한 그룹으로 모인다', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'a', startMin: 480 }),
      sched({ id: 'b', startMin: 660 }),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['a', 'b']);
  });

  test('그룹 안은 startMin 오름차순', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'late', startMin: 900 }),
      sched({ id: 'early', startMin: 480 }),
    ]);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['early', 'late']);
  });

  test('시간 미정은 그 날의 맨 뒤', () => {
    const groups = groupSchedulesForPicker([
      sched({ id: 'none', startMin: null }),
      sched({ id: 'timed', startMin: 900 }),
    ]);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['timed', 'none']);
  });

  test('라벨은 시각과 제목을 붙인다', () => {
    const groups = groupSchedulesForPicker([sched({ startMin: 660, title: '성산일출봉' })]);
    assert.equal(groups[0].items[0].label, '11:00 성산일출봉');
  });

  test('시간 미정 라벨', () => {
    const groups = groupSchedulesForPicker([sched({ startMin: null, title: '기념품' })]);
    assert.equal(groups[0].items[0].label, '시간미정 기념품');
  });

  test('제목이 없으면 시간만 표시', () => {
    const groups = groupSchedulesForPicker([sched({ startMin: 660, title: null })]);
    assert.equal(groups[0].items[0].label, '11:00');
  });

  test('제목과 시간이 없으면 "시간미정"만 표시', () => {
    const groups = groupSchedulesForPicker([sched({ startMin: null, title: null })]);
    assert.equal(groups[0].items[0].label, '시간미정');
  });

  test('제목이 undefined여도 라벨에 "undefined" 문자열이 나타나지 않는다', () => {
    const groups = groupSchedulesForPicker([{ id: 'x', date: '2026-08-11', startMin: 600 }]);
    assert(!groups[0].items[0].label.includes('undefined'));
    assert.equal(groups[0].items[0].label, '10:00');
  });
});
