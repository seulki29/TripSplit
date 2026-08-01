import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDonutChart, renderCategoryComparison } from '../charts.js';

// charts.js only imports escapeHtml (pure) from ui.js and helpers from
// categories.js -- neither touches the DOM at module scope, so this runs as
// a plain Node test, same as public/test/categories.test.js.

function theadCellCount(html) {
  const thead = html.match(/<thead>([\s\S]*?)<\/thead>/)[1];
  return (thead.match(/<th/g) || []).length;
}

function bodyRows(html) {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  return (tbody.match(/<tr>([\s\S]*?)<\/tr>/g) || []);
}

// The category name renders as plain text after the dot span (e.g.
// `<span class="cat-dot" ...></span> 숙박</td>`), so a substring match on the
// Korean label is sufficient and simpler than matching surrounding markup --
// none of the category labels can appear anywhere else in a row.
function rowFor(html, category) {
  return bodyRows(html).find((row) => row.includes(category));
}

describe('charts.js renderCategoryComparison', () => {
  // Mirrors the design spec's own worked example (§5.2): 숙박 +20%/+21,000원,
  // 식비 -10%/-9,000원, 장보기 +13%/+3,000원, 교통비 -33%/-18,000원.
  const currentPerDay = {
    숙박: 42000, 식비: 28000, 장보기: 9000, 교통비: 12000,
  };
  const groupPerDay = {
    숙박: 35000, 식비: 31000, 장보기: 8000, 교통비: 18000,
  };
  const tripDays = 3;

  test('percentage is round(((current - group) / group) * 100)', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays);
    assert.match(rowFor(html, '숙박'), />\+20%</);
    assert.match(rowFor(html, '식비'), />-10%</);
    assert.match(rowFor(html, '장보기'), />\+13%</);
    assert.match(rowFor(html, '교통비'), />-33%</);
  });

  test('the trip-total +/- amount is round((current - group) * tripDays)', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays);
    assert.match(rowFor(html, '숙박'), />\+21,000원</);
    assert.match(rowFor(html, '식비'), />-9,000원</);
    assert.match(rowFor(html, '장보기'), />\+3,000원</);
    assert.match(rowFor(html, '교통비'), />-18,000원</);
  });

  test('rows are ordered by 이번 (current) per-day descending', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays);
    const order = bodyRows(html).map((row) => (
      ['숙박', '식비', '장보기', '교통비'].find((c) => row.includes(c))
    ));
    assert.deepEqual(order, ['숙박', '식비', '교통비', '장보기']); // 42000 > 28000 > 12000 > 9000
  });

  test('every body row emits the same number of cells as the header', () => {
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays);
    const headCount = theadCellCount(html);
    assert.ok(headCount > 0);
    for (const row of bodyRows(html)) {
      assert.equal((row.match(/<td/g) || []).length, headCount);
    }
  });

  test('bar width is normalised on the largest ABSOLUTE PERCENTAGE, not the largest amount', () => {
    // 숙박 has the largest 이번 amount (42000) but only +20%. 교통비 has a
    // smaller amount (12000) but the largest |%| (-33%), so if the bars were
    // normalised on amount instead of %, 숙박 would wrongly get the widest bar.
    const html = renderCategoryComparison(currentPerDay, groupPerDay, tripDays);
    const widthOf = (category) => {
      const match = rowFor(html, category).match(/width:([\d.]+)%/);
      return match ? parseFloat(match[1]) : null;
    };
    const widthLodging = widthOf('숙박');
    const widthTransport = widthOf('교통비');
    assert.equal(widthTransport, 50); // the max |%| row fills the half-width
    assert.ok(widthTransport > widthLodging, `expected 교통비 (${widthTransport}) wider than 숙박 (${widthLodging})`);
  });

  test('no rendered number contains a decimal point, given non-integer inputs', () => {
    const html = renderCategoryComparison(
      { 식비: 12345.678 },
      { 식비: 9999.111 },
      4.5,
    );
    // Check visible text nodes only (content between `>` and `<`), not raw
    // markup -- static inline CSS such as `style="margin-bottom:0.4rem"`
    // legitimately contains a decimal and is unrelated to the rendered data.
    const textNodes = html.match(/>([^<>]+)</g) || [];
    const withDecimal = textNodes.filter((t) => /\d\.\d/.test(t));
    assert.deepEqual(withDecimal, []);
    assert.match(html, />12,346</); // Math.round(12345.678)
    assert.match(html, />9,999</); // Math.round(9999.111)
    assert.match(html, />\+23%</); // round(((12345.678-9999.111)/9999.111)*100)
    assert.match(html, />\+10,560원</); // round((12345.678-9999.111)*4.5)
  });

  test('a category with no group baseline (absent or <= 0) still produces a row, showing --', () => {
    const html = renderCategoryComparison(
      { 식비: 20000, 놀이: 5000, 기타: 4000 },
      { 식비: 18000, 기타: 0 }, // 놀이 absent entirely, 기타 present but zero
      4,
    );
    const play = rowFor(html, '놀이');
    const etc = rowFor(html, '기타');
    assert.ok(play, '놀이 row must still be rendered');
    assert.ok(etc, '기타 row must still be rendered');
    // current (이번) still renders normally
    assert.match(play, />5,000</);
    assert.match(etc, />4,000</);
    // group / deviation / trip-total cells all show the em dash placeholder
    assert.equal((play.match(/—/g) || []).length, 3);
    assert.equal((etc.match(/—/g) || []).length, 3);
    // no bar is drawn for a row without a percentage
    assert.equal(play.includes('cmp-bar-fill'), false);
    assert.equal(etc.includes('cmp-bar-fill'), false);
  });

  test('shows the Korean empty message when currentPerDay has no categories at all', () => {
    const html = renderCategoryComparison({}, {}, 3);
    assert.equal(html, '<p class="muted">비교할 수 있는 카테고리가 없습니다.</p>');
  });
});

describe('charts.js renderDonutChart', () => {
  test('returns the Korean empty message when every total is zero', () => {
    assert.equal(
      renderDonutChart({ 숙박: 0, 식비: 0 }),
      '<p class="muted">지출 내역이 없습니다.</p>',
    );
    assert.equal(
      renderDonutChart({}),
      '<p class="muted">지출 내역이 없습니다.</p>',
    );
  });
});
