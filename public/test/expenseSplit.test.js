import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { excludedFrom } from '../views/expenseSplit.js';

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
