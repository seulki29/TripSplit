import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { minToLabel, labelToMin, mapLinkFor } from '../scheduleLayout.js';

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
