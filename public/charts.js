import { escapeHtml } from './ui.js';
import { categoryMark, categoryDot } from './categories.js';

const RADIUS = 40;
const SEGMENT_GAP = 2; // surface gap between donut segments, in path units

function renderDonutChart(categoryTotals) {
  const entries = Object.entries(categoryTotals).filter(([, amount]) => amount > 0);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (total <= 0) return '<p class="muted">지출 내역이 없습니다.</p>';

  const circumference = 2 * Math.PI * RADIUS;
  let offset = 0;
  const circles = entries.map(([category, amount]) => {
    const dash = (amount / total) * circumference;
    const visible = Math.max(0, dash - SEGMENT_GAP);
    const circle = `<circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="${categoryMark(category)}" stroke-width="16" stroke-dasharray="${visible} ${circumference - visible}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"></circle>`;
    offset += dash;
    return circle;
  }).join('');

  const legend = entries.map(([category, amount]) => `
    <div class="cmp-legend-row">${categoryDot(category)}
      <span>${escapeHtml(category)} · ${Math.round(amount).toLocaleString()}원 · ${Math.round((amount / total) * 100)}%</span>
    </div>`).join('');

  return `
    <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem">
      <svg viewBox="0 0 100 100" width="140" height="140">${circles}</svg>
      <div>${legend}</div>
    </div>`;
}

function renderCategoryComparison(currentPerDay, groupPerDay, tripDays) {
  const rows = Object.keys(currentPerDay)
    // A category the group has never spent on has no baseline to divide by.
    .filter((category) => groupPerDay[category] > 0)
    .map((category) => {
      const current = currentPerDay[category];
      const group = groupPerDay[category];
      return {
        category,
        current: Math.round(current),
        group: Math.round(group),
        pct: Math.round(((current - group) / group) * 100),
        delta: Math.round((current - group) * tripDays),
      };
    })
    .sort((a, b) => b.current - a.current);

  if (rows.length === 0) return '<p class="muted">비교할 수 있는 카테고리가 없습니다.</p>';

  // Normalised on the largest |percentage| in the table, not on amounts.
  const maxAbsPct = Math.max(...rows.map((r) => Math.abs(r.pct)), 1);

  const body = rows.map((r) => {
    const width = (Math.abs(r.pct) / maxAbsPct) * 50;
    const bar = r.pct === 0 ? '' : `<div class="cmp-bar-fill ${r.pct > 0 ? 'cmp-bar-pos' : 'cmp-bar-neg'}" style="width:${width}%;background:${categoryMark(r.category)}"></div>`;
    const tone = r.pct >= 0 ? 'pay' : 'receive';
    const sign = r.pct >= 0 ? '+' : '';
    return `
      <tr>
        <td class="cmp-cat">${categoryDot(r.category)} ${escapeHtml(r.category)}</td>
        <td class="cmp-num mono">${r.current.toLocaleString()}</td>
        <td class="cmp-num mono cmp-group">${r.group.toLocaleString()}</td>
        <td><div class="cmp-bar">${bar}</div></td>
        <td class="cmp-num mono" style="color:var(--${tone})">${sign}${r.pct}%</td>
        <td class="cmp-num mono" style="color:var(--${tone})">${sign}${r.delta.toLocaleString()}원</td>
      </tr>`;
  }).join('');

  return `
    <p class="label" style="margin-bottom:0.4rem">카테고리 비교 · 하루 · 1인 기준</p>
    <div style="overflow-x:auto">
    <table class="cmp-table">
      <thead><tr>
        <th class="cmp-cat">카테고리</th>
        <th class="cmp-num">이번</th>
        <th class="cmp-num cmp-group">그룹평균</th>
        <th>편차</th>
        <th class="cmp-num">%</th>
        <th class="cmp-num">여행 전체</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
}

export { renderDonutChart, renderCategoryComparison };
